// Runs the real Go service with a fake Pi context; never launches or controls Pi.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Observation } from "./index.ts";
import { Transport } from "./transport.ts";

test("Go/TS roundtrip, literal controls, restart, fresh identity, and no replay", {
  timeout: 15000,
}, async (t) => {
  mkdirSync(".rai-investigation", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".rai-investigation", "i-"));
  chmodSync(dir, 0o700);
  const socketPath = join(dir, "s"),
    configPath = join(dir, "config.json");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  writeFileSync(
    configPath,
    JSON.stringify({ address: "127.0.0.1", port, socket: socketPath }),
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const start = async () => {
    const child = spawn("./bin/rai", ["serve", "-config", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    });
    await new Promise<void>((resolve, reject) => {
      let log = "";
      child.stderr.on("data", (chunk) => {
        log += String(chunk);
        if (log.includes("RAI on")) resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`fixture service exited ${code}: ${log}`)),
      );
    });
    return child;
  };
  let service = await start();
  let aborted = 0,
    editor = "desktop draft";
  const texts: string[] = [];
  const ctx = {
    mode: "tui",
    cwd: "/synthetic",
    isIdle: () => true,
    hasPendingMessages: () => false,
    abort: () => {
      aborted++;
    },
    ui: {
      setEditorText: (value: string) => {
        editor = value;
      },
    },
    sessionManager: {
      getLeafId: () => null,
      getEntry: () => undefined,
      getSessionId: () => "synthetic-session",
      getSessionFile: () => undefined,
    },
  } as unknown as ExtensionContext;
  const observation = new Observation(ctx, {
    sendUserMessage: (value, options) => {
      assert.deepEqual(options, {
        deliverAs: "steer",
        expandPromptTemplates: false,
      });
      assert.equal(typeof value, "string");
      texts.push(value as string);
    },
  });
  let reconnect: (() => void) | undefined;
  const client = new Transport(socketPath, {
    connected: () => {
      observation.reconnect();
      reconnect?.();
      return observation.snapshot();
    },
    receive: (value) => observation.control(value),
    error: (error) => {
      throw error;
    },
  });
  t.after(() => client.stop());
  const connected = new Promise<void>((resolve) => {
    reconnect = resolve;
  });
  client.start();
  await connected;
  const observed = async () => {
    for (let n = 0; n < 100; n++) {
      const response = await fetch(
        `http://127.0.0.1:${port}/sessions/${observation.endpointId}`,
      );
      if (response.status === 200) return response.json();
    }
    throw new Error("fixture endpoint never registered");
  };
  const first = await observed();
  assert.equal(first.snapshot.associationId, observation.associationId);
  const control = async (
    operation: string,
    endpoint = observation.endpointId,
    text = "",
  ) => {
    const child = spawn(
      "./bin/rai",
      [
        operation,
        "-config",
        configPath,
        "-endpoint",
        endpoint,
        "-association",
        observation.associationId,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (v) => {
      output += String(v);
    });
    child.stderr.on("data", (v) => {
      error += String(v);
    });
    child.stdin.end(text);
    const [code] = await once(child, "exit");
    assert.equal(code, 0, error);
    return JSON.parse(output);
  };
  const text = " \n/command café 🦉\n  ";
  assert.equal(
    (await control("send", undefined, text)).status,
    "submitted_unconfirmed",
  );
  assert.deepEqual(texts, [text]);
  assert.equal(editor, "desktop draft");
  const html = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await html.text(), /Message composer/);
  const bootstrap = await (
    await fetch(`http://127.0.0.1:${port}/api/bootstrap`)
  ).json();
  const browserText = " \nBrowser café 🦉\n  ";
  const browserRequest = {
    type: "control",
    version: 1,
    requestId: "browser-request",
    operation: "send",
    endpointId: observation.endpointId,
    associationId: observation.associationId,
    text: browserText,
  };
  const sendHTTP = (origin: string) =>
    fetch(`http://127.0.0.1:${port}/control`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-RAI-CSRF": bootstrap.csrf,
      },
      body: JSON.stringify(browserRequest),
    });
  assert.equal((await sendHTTP("https://attacker.example")).status, 403);
  assert.equal(
    (await (await sendHTTP(`http://127.0.0.1:${port}`)).json()).status,
    "submitted_unconfirmed",
  );
  assert.equal(
    (await (await sendHTTP(`http://127.0.0.1:${port}`)).json()).status,
    "rejected",
  );
  assert.deepEqual(texts, [text, browserText]);
  assert.equal((await control("stop")).status, "stop_requested");
  assert.equal(aborted, 1);
  assert.equal(editor, "");
  const oldEndpoint = observation.endpointId;
  const reconnected = new Promise<void>((resolve) => {
    reconnect = resolve;
  });
  service.kill("SIGTERM");
  await once(service, "exit");
  service = await start();
  await reconnected;
  await observed();
  assert.notEqual(observation.endpointId, oldEndpoint);
  assert.equal(
    (await control("send", oldEndpoint, "must not dispatch")).status,
    "rejected",
  );
  assert.deepEqual(texts, [text, browserText]);
  assert.equal(aborted, 1);
  client.stop();
  service.kill("SIGTERM");
  await once(service, "exit");
});
