import { lstatSync, realpathSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { MAX_FRAME, type Result, type Snapshot } from "./protocol.ts";

// Only one pending snapshot is retained; replies have a small separate bound.
export class Writer {
  private blocked = false;
  private pending?: Snapshot;
  private replies: Result[] = [];
  private readonly socket: Pick<Socket, "write" | "destroy">;
  constructor(socket: Pick<Socket, "write" | "destroy">) {
    this.socket = socket;
  }
  snapshot(value: Snapshot) {
    if (this.blocked) {
      value.gap = true;
      this.pending = value;
      return;
    }
    this.blocked = !this.socket.write(JSON.stringify(value) + "\n");
  }
  reply(value: Result) {
    if (!this.blocked) {
      this.blocked = !this.socket.write(JSON.stringify(value) + "\n");
    } else if (this.replies.length < 16) {
      this.replies.push(value);
    } else {
      this.socket.destroy(); // Result loss is uncertain, never replayed.
    }
  }
  drain() {
    this.blocked = false;
    while (this.replies.length && !this.blocked) {
      const reply = this.replies.shift();
      this.blocked = !this.socket.write(JSON.stringify(reply) + "\n");
    }
    if (this.pending && !this.blocked) {
      const pending = this.pending;
      this.pending = undefined;
      this.snapshot(pending);
    }
  }
}

export interface TransportHooks {
  connected(): Snapshot;
  receive(value: unknown): Result;
  error(error: Error): void;
}
export class Transport {
  private socket?: Socket;
  private writer?: Writer;
  private retry?: ReturnType<typeof setTimeout>;
  private active = false;
  private readonly path: string;
  private readonly hooks: TransportHooks;
  constructor(path: string, hooks: TransportHooks) {
    this.path = path;
    this.hooks = hooks;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.connect();
  }
  stop() {
    this.active = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.writer = undefined;
    this.socket?.destroy();
    this.socket = undefined;
  }
  publish(snapshot: Snapshot) {
    this.writer?.snapshot(snapshot);
  }
  private later() {
    if (!this.active || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, 1000);
    this.retry.unref();
  }
  private connect() {
    if (!this.active) return;
    // Service absence is ordinary. An unsafe configured path is an explicit error.
    try {
      const dir = lstatSync(dirname(this.path));
      const file = lstatSync(this.path);
      if (
        !dir.isDirectory() ||
        dir.uid !== process.getuid?.() ||
        (dir.mode & 0o777) !== 0o700 ||
        realpathSync(dirname(this.path)) !== resolve(dirname(this.path)) ||
        !file.isSocket() ||
        file.uid !== process.getuid?.() ||
        (file.mode & 0o777) !== 0o600
      ) {
        this.hooks.error(
          new Error("RAI socket must be user-owned, private, and non-symlink."),
        );
        return; // Misconfiguration requires intervention, not a retry loop.
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.later();
        return;
      }
      this.hooks.error(error as Error);
      return;
    }
    const socket = createConnection(this.path);
    this.socket = socket;
    socket.unref();
    let input = Buffer.alloc(0);
    socket.on("connect", () => {
      if (!this.active || this.socket !== socket) {
        socket.destroy();
        return;
      }
      this.writer = new Writer(socket);
      this.writer.snapshot(this.hooks.connected());
    });
    socket.on("drain", () => this.writer?.drain());
    socket.on("data", (data: Buffer) => {
      input = Buffer.concat([input, data]);
      for (;;) {
        const lf = input.indexOf(10);
        if (lf < 0) break;
        if (lf >= MAX_FRAME) {
          socket.destroy();
          return;
        }
        const frame = input.subarray(0, lf);
        input = input.subarray(lf + 1);
        let value: unknown;
        try {
          value = JSON.parse(frame.toString("utf8"));
        } catch {
          socket.destroy();
          return;
        }
        this.writer?.reply(this.hooks.receive(value));
      }
      if (input.length >= MAX_FRAME) socket.destroy();
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (
        !["ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE"].includes(
          error.code ?? "",
        )
      )
        this.hooks.error(error);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.writer = undefined; // No observations/replies/controls survive reconnection.
      this.later();
    });
  }
}
