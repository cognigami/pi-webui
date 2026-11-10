import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import type { Result, Snapshot } from "./protocol.ts";
import { Transport, Writer } from "./transport.ts";

function snapshot(seq = 1): Snapshot {
  const value = JSON.parse(
    readFileSync(new URL("../testdata/snapshot.json", import.meta.url), "utf8"),
  ) as Snapshot;
  value.seq = seq;
  return value;
}
const response: Result = {
  type: "result",
  version: 1,
  requestId: "stop-1",
  status: "stop_requested",
  detail: "Stop requested",
};
test("slow readers coalesce snapshots, mark gap, prioritize control responses", () => {
  const lines: string[] = [];
  let blocked = true,
    destroyed = false;
  const writer = new Writer({
    write: (line: unknown) => {
      lines.push(String(line));
      return !blocked;
    },
    destroy: () => {
      destroyed = true;
      return undefined as never;
    },
  });
  writer.snapshot(snapshot(1));
  writer.snapshot(snapshot(2));
  writer.snapshot(snapshot(3));
  writer.reply(response);
  assert.equal(lines.length, 1);
  blocked = false;
  writer.drain();
  assert.equal(JSON.parse(lines[1]).type, "result");
  assert.equal(JSON.parse(lines[2]).seq, 3);
  assert.equal(JSON.parse(lines[2]).gap, true);
  assert.equal(destroyed, false);
});
test("reply buffering is bounded, overflow disconnects rather than replaying", () => {
  let destroyed = false;
  const writer = new Writer({
    write: () => false,
    destroy: () => {
      destroyed = true;
      return undefined as never;
    },
  });
  writer.snapshot(snapshot());
  for (let n = 0; n < 17; n++) writer.reply(response);
  assert.equal(destroyed, true);
});
test("transport connects to a private fake service, frames UTF-8, and stops idempotently", async (t) => {
  const root = join(process.cwd(), ".rai-investigation");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "node-"));
  chmodSync(dir, 0o700);
  // Relative socket path avoids macOS's small Unix socket path limit.
  const path = join(".rai-investigation", dir.split("/").at(-1) ?? "", "s");
  const server = createServer();
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  chmodSync(path, 0o600);
  let connected = 0,
    received = 0;
  const result = new Promise<void>((resolve, reject) => {
    server.once("connection", (socket) => {
      t.after(() => socket.destroy());
      let input = "";
      socket.on("data", (data) => {
        input += data.toString("utf8");
        if (!input.includes("\n")) return;
        const first = JSON.parse(input.slice(0, input.indexOf("\n")));
        if (first.type === "snapshot") {
          input = input.slice(input.indexOf("\n") + 1);
          const request = Buffer.from(
            JSON.stringify({ type: "control", text: "café 🦉" }) + "\n",
          );
          const split = request.indexOf(Buffer.from("🦉")) + 1;
          socket.write(request.subarray(0, split));
          socket.write(request.subarray(split));
        } else if (first.type === "result") {
          resolve();
        }
      });
      socket.on("error", reject);
    });
  });
  const errors: Error[] = [];
  const client = new Transport(path, {
    connected: () => {
      connected++;
      return snapshot();
    },
    receive: (value) => {
      received++;
      assert.equal((value as { text: string }).text, "café 🦉");
      return response;
    },
    error: (error) => errors.push(error),
  });
  t.after(() => client.stop());
  client.start();
  client.start();
  await result;
  client.stop();
  client.stop();
  assert.equal(connected, 1);
  assert.equal(received, 1);
  assert.deepEqual(errors, []);
});
test("absent service never prevents startup and shutdown cancels reconnect", () => {
  const client = new Transport(
    join(process.cwd(), ".rai-investigation", "missing", "s"),
    {
      connected: () => {
        throw new Error("must not connect");
      },
      receive: () => {
        throw new Error("must not dispatch");
      },
      error: () => {
        throw new Error("absence is ordinary");
      },
    },
  );
  client.start();
  client.stop();
  client.stop();
});
