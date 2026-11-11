import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
} from "@earendil-works/pi-coding-agent";
import rai, { Observation } from "./index.ts";
import { parseControl, type Snapshot } from "./protocol.ts";

function host() {
  let leaf: string | null = "entry-1";
  let idle = true;
  let conversationStarted = true;
  let editor = "desktop draft";
  let aborted = 0;
  const calls: { text: unknown; options: unknown }[] = [];
  const ctx = {
    cwd: "/synthetic",
    mode: "tui",
    hasUI: true,
    sessionManager: {
      getLeafId: () => leaf,
      getEntries: () =>
        conversationStarted
          ? [
              {
                type: "message",
                id: "user",
                parentId: null,
                message: { role: "user", content: "prior" },
              },
            ]
          : [{ type: "model_change", id: "setup", parentId: null }],
      getSessionId: () => "fixture-session",
      getSessionFile: () => "/synthetic/session.jsonl",
      getEntry: (id: string) => ({ id, parentId: null }),
    },
    isIdle: () => idle,
    hasPendingMessages: () => !idle,
    abort: () => {
      aborted++;
    },
    ui: {
      setEditorText: (text: string) => {
        editor = text;
      },
      notify: () => {},
    },
  } as unknown as ExtensionContext;
  const pi = {
    sendUserMessage: (text: unknown, options: unknown) => {
      calls.push({ text, options });
    },
  };
  return {
    ctx,
    pi,
    calls,
    setLeaf: (id: string) => {
      leaf = id;
    },
    setConversation: (value: boolean) => {
      conversationStarted = value;
    },
    setIdle: (value: boolean) => {
      idle = value;
    },
    editor: () => editor,
    aborted: () => aborted,
  };
}
function req(
  o: Observation,
  operation: "send" | "stop" = "send",
  text = " \n/command café 🦉\n  ",
) {
  return {
    type: "control",
    version: 1,
    endpointId: o.endpointId,
    associationId: o.associationId,
    requestId: "fixture-request",
    operation,
    text,
  };
}
test("setup-only in-memory leaf is not a persisted cutoff before the first conversation message", () => {
  const h = host();
  h.setConversation(false);
  h.setLeaf("setup");
  const o = new Observation(h.ctx, h.pi);
  assert.equal(o.snapshot().session.leaf, "setup");
  assert.equal(o.snapshot().session.cutoff, null);
  assert.equal(o.snapshot().historyReady, true);
  h.setIdle(false);
  o.beginTurn();
  h.setConversation(true);
  h.setLeaf("saved-first-user");
  o.observeMessage({
    type: "message_start",
    message: { role: "assistant", content: [] },
  } as never);
  assert.equal(o.snapshot().session.cutoff, "saved-first-user");
});
test("shared wire fixture and validation", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../testdata/snapshot.json", import.meta.url), "utf8"),
  ) as Snapshot;
  assert.equal(fixture.version, 1);
  assert.equal(fixture.session.sample[0].parentId, null);
  assert.equal(fixture.provisional.message, null);
  assert.equal(
    parseControl({ ...fixture, type: "control", operation: "send", text: "x" }),
    undefined,
  );
});
test("exact ordinary Send preserves desktop draft and reports dispatch only", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  const request = req(o);
  assert.equal(o.control(request).status, "submitted_unconfirmed");
  assert.deepEqual(h.calls, [
    {
      text: request.text,
      options: { deliverAs: "steer", expandPromptTemplates: false },
    },
  ]);
  assert.equal(h.editor(), "desktop draft");
  h.setIdle(false);
  assert.equal(
    o.control({ ...request, requestId: "busy" }).status,
    "submitted_unconfirmed",
  );
  assert.equal(o.control(req(o, "stop")).status, "stop_requested");
  assert.equal(h.aborted(), 1);
  assert.equal(h.editor(), "");
});
test("identity changes on navigation/reconnect, not ordinary leaf append", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  const before = req(o),
    id = o.associationId;
  h.setLeaf("entry-2");
  assert.equal(o.snapshot().associationId, id);
  assert.equal(o.control(before).status, "submitted_unconfirmed");
  o.navigate();
  assert.equal(o.control(before).status, "rejected");
  const connected = req(o);
  o.reconnect();
  assert.equal(o.control(connected).status, "rejected");
  assert.equal(o.seq, 0);
});
test("navigation pre-hook invalidates before the leaf moves or post-hooks finish", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  const old = req(o);
  o.beginNavigation();
  assert.equal(o.control(old).status, "rejected");
  const pending = req(o);
  h.setLeaf("new-branch"); // Earlier session_tree handler can still be awaiting here.
  assert.equal(o.control(pending).status, "rejected");
  assert.equal(o.control({ ...pending, operation: "stop" }).status, "rejected");
  assert.match(o.snapshot().state.controlUnavailable ?? "", /Navigation/);
  o.navigate();
  assert.equal(o.control(pending).status, "rejected");
  assert.equal(o.control(req(o)).status, "submitted_unconfirmed");
  assert.equal(h.calls.length, 1);
});
test("unsupported states and invalid text reject before effects", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  o.manualCompaction = true;
  assert.equal(o.control(req(o)).status, "rejected");
  assert.equal(o.control(req(o, "stop")).status, "stop_requested");
  o.manualCompaction = false;
  o.prompt = "confirm";
  assert.equal(o.control(req(o)).status, "rejected");
  o.prompt = "";
  for (const text of ["", " \n\t", "x".repeat(128 * 1024 + 1)])
    assert.equal(o.control(req(o, "send", text)).status, "rejected");
  assert.equal(h.calls.length, 0);
});
test("errors after entering void API are uncertain, never known-not-sent", () => {
  const h = host();
  const o = new Observation(h.ctx, {
    sendUserMessage: () => {
      throw new Error("synthetic");
    },
  });
  assert.equal(o.control(req(o)).status, "outcome_unknown");
});
test("current-turn bound is explicit and does not recover by silently dropping early content", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  o.observeMessage({
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "x".repeat(300 * 1024) }],
    },
  } as never);
  assert.equal(o.snapshot().gap, true);
  assert.match(o.snapshot().liveUnavailable ?? "", /bound/);
  o.observeMessage({
    type: "message_end",
    message: { role: "assistant", content: [] },
  } as never);
  assert.equal(o.message, null);
  o.reset();
  assert.equal(o.snapshot().gap, false);
});
test("message_end stays provisional; confirmed turn replaces it with persisted IDs", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  o.observeMessage({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "before later transforms" }],
    },
  } as never);
  assert.equal(o.snapshot().session.cutoff, "entry-1");
  assert.notEqual(o.snapshot().provisional.message, null);
  h.setLeaf("saved-tool");
  o.completeTurn("saved-assistant", ["saved-tool"]);
  const v = o.snapshot();
  assert.equal(v.session.cutoff, "saved-tool");
  assert.deepEqual(v.persistedIds, ["saved-assistant", "saved-tool"]);
  assert.deepEqual(v.provisional, { message: null, tools: [] });
});
test("pending navigation withholds old history and provisional output", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  o.observeMessage({
    type: "message_start",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "old branch" }],
    },
  } as never);
  o.beginNavigation();
  const pending = o.snapshot();
  assert.equal(pending.historyReady, false);
  assert.equal(pending.session.cutoff, null);
  assert.deepEqual(pending.provisional, { message: null, tools: [] });
  h.setLeaf("new-branch");
  o.navigate();
  assert.equal(o.snapshot().historyReady, true);
  assert.equal(o.snapshot().session.cutoff, "new-branch");
});
test("safe cutoff includes user before assistant, holds back persisted tool turn, then refreshes later proposals", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  h.setIdle(false);
  o.beginTurn();
  h.setLeaf("saved-user");
  o.observeMessage({
    type: "message_start",
    message: { role: "assistant", content: [] },
  } as never);
  h.setLeaf("early-saved-assistant");
  o.observeMessage({
    type: "message_end",
    message: { role: "assistant", content: [] },
  } as never);
  assert.equal(o.snapshot().session.cutoff, "saved-user");
  assert.equal(o.snapshot().turnOpen, true);
  o.completeTurn("early-saved-assistant", []);
  assert.equal(o.snapshot().session.cutoff, "early-saved-assistant");
  h.setLeaf("later-boundary-context-edit");
  h.setIdle(true);
  assert.equal(o.snapshot().session.cutoff, "later-boundary-context-edit");
  o.settled();
  assert.equal(o.snapshot().turnOpen, false);
});
test("extension loaded midturn admits missing state until confirmed resynchronization", () => {
  const h = host();
  h.setIdle(false);
  const o = new Observation(h.ctx, h.pi);
  assert.equal(o.snapshot().historyReady, false);
  assert.equal(o.snapshot().session.cutoff, null);
  h.setLeaf("completed");
  o.completeTurn("completed", []);
  assert.equal(o.snapshot().historyReady, true);
});
test("oversized persisted-ID samples require explicit resynchronization", () => {
  const h = host(),
    o = new Observation(h.ctx, h.pi);
  o.completeTurn(
    "assistant",
    Array.from({ length: 129 }, (_, i) => "tool-" + i),
  );
  assert.equal(o.snapshot().gap, true);
  assert.deepEqual(o.snapshot().persistedIds, []);
  assert.match(o.snapshot().liveUnavailable ?? "", /persisted IDs/);
});
test("factory/lifecycle tolerate absent service and repeated shutdown", async () => {
  const h = host();
  const handlers = new Map<
    string,
    (event: ExtensionEvent, ctx: ExtensionContext) => unknown
  >();
  const pi = {
    ...h.pi,
    on: (
      type: string,
      handler: (event: ExtensionEvent, ctx: ExtensionContext) => unknown,
    ) => handlers.set(type, handler),
  } as unknown as ExtensionAPI;
  rai(pi);
  assert.equal(handlers.size > 0, true); // Factory creates no transport/resources.
  const emit = async (type: string, event: unknown = {}) => {
    await handlers.get(type)?.(event as ExtensionEvent, h.ctx);
  };
  const original = process.env.RAI_SOCKET;
  process.env.RAI_SOCKET = "/nonexistent-rai-fixture/bridge.sock";
  try {
    await emit("session_start");
    await emit("message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "provisional" }],
      },
    });
    await emit("turn_end", {
      type: "turn_end",
      messageEntryId: "saved-assistant",
      toolResultEntryIds: ["saved-tool"],
    });
    await emit("session_shutdown");
    await emit("session_shutdown");
  } finally {
    await emit("session_shutdown");
    if (original === undefined) delete process.env.RAI_SOCKET;
    else process.env.RAI_SOCKET = original;
  }
});
