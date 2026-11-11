import assert from "node:assert/strict";
import test from "node:test";
import {
  beginSend,
  bulk,
  conversationKey,
  createView,
  expanded,
  finishSend,
  ingest,
  maySend,
  mayStop,
  messageError,
  prepend,
  resultFor,
  toggle,
} from "./model.js";

const snapshot = (overrides = {}) => ({
  endpointId: "ep",
  associationId: "assoc",
  seq: 1,
  session: { id: "session", cutoff: "a" },
  state: { activity: "idle", pending: false, sendSupported: true },
  provisional: { message: null, tools: [] },
  ...overrides,
});
const entry = (id, parentId = null) => ({
  id,
  parentId,
  type: "message",
  role: "user",
  data: { type: "message", message: { role: "user", content: id } },
});
test("exact capture, double-tap prevention, and Stop independent of pending Send", () => {
  const view = createView(snapshot(), "Coordinator");
  view.draft = " \n/command café 🦉\n  ";
  view.open = true;
  const req = beginSend(view, "one");
  assert.equal(req.text, view.draft);
  assert.equal(view.open, false);
  assert.equal(maySend(view, true, true), false);
  assert.equal(mayStop(view, true, true), true);
  assert.throws(() => beginSend(view, "two"), /outstanding/);
  assert.equal(view.pending, req);
  finishSend(view, "one", { status: "submitted_unconfirmed" });
  assert.equal(view.draft, "");
  assert.equal(view.pending, null);
  assert.equal(view.sendFeedback, null);
  assert.equal("receipts" in view, false);
});
test("lost outcome leaves editable input and inline warning on original conversation, without a review step", () => {
  const view = createView(snapshot(), "First");
  view.draft = "original";
  const req = beginSend(view, "lost");
  const other = createView(snapshot({ associationId: "new" }), "Second");
  other.draft = "new text";
  finishSend(view, "lost", { status: "outcome_unknown" });
  assert.equal(req.associationId, "assoc");
  assert.equal(other.draft, "new text");
  assert.equal(view.draft, "original");
  assert.equal(view.pending, null);
  assert.match(view.sendFeedback.detail, /Delivery unconfirmed/);
  assert.equal(maySend(view, true, true), true);
  assert.equal("needsReview" in view, false);
  view.draft = "edited normally";
  const second = beginSend(view, "second");
  finishSend(view, "lost", { status: "submitted_unconfirmed" });
  assert.equal(view.pending, second);
  assert.equal(view.draft, "edited normally");
});
test("known rejection keeps text in the ordinary input without locking editing or retrying", () => {
  const view = createView(snapshot(), "First");
  view.draft = "keep me";
  beginSend(view, "bad");
  finishSend(view, "bad", { status: "rejected", detail: "stale target" });
  assert.match(view.sendFeedback.detail, /Not sent/);
  assert.equal(view.draft, "keep me");
  assert.equal(view.pending, null);
  assert.equal(maySend(view, true, true), true);
});
test("a later rejection does not erase Stop eligibility from an earlier unconfirmed dispatch", () => {
  for (const status of ["submitted_unconfirmed", "outcome_unknown"]) {
    const view = createView(snapshot(), "A");
    view.draft = "first";
    beginSend(view, "first");
    finishSend(view, "first", { status });
    view.draft = "second";
    beginSend(view, "second");
    finishSend(view, "second", {
      status: "rejected",
      detail: "not dispatched",
    });
    assert.match(view.sendFeedback.detail, /Not sent/);
    assert.equal(mayStop(view, true, true), true);
    assert.equal("receipts" in view, false);
  }
});
test("connected busy targets accept Send; unsupported/offline/unverified targets do not", () => {
  const view = createView(
    snapshot({
      state: { activity: "working", pending: true, sendSupported: true },
    }),
    "Busy",
  );
  view.draft = "x";
  assert.equal(maySend(view, true, true), true);
  assert.equal(maySend(view, false, true), false);
  assert.equal(maySend(view, true, false), false);
  view.snapshot.state.sendSupported = false;
  assert.equal(maySend(view, true, true), false);
  assert.equal(mayStop(view, true, true), true);
  view.stopPending = true;
  assert.equal(mayStop(view, true, true), false);
});
test("ordinary leaf append and endpoint reconnect preserve page-local draft; navigation keys differ", () => {
  const s = snapshot(),
    view = createView(s, "old");
  view.draft = "kept";
  const next = snapshot({
    endpointId: "reconnected",
    seq: 1,
    session: { id: "session", cutoff: "b" },
  });
  ingest(view, {
    observation: { snapshot: next },
    history: { entries: [entry("a"), entry("b", "a")], before: "" },
  });
  assert.equal(conversationKey(next), conversationKey(s));
  assert.equal(view.draft, "kept");
  assert.equal(view.snapshot.endpointId, "reconnected");
  assert.notEqual(
    conversationKey(snapshot({ associationId: "tree" })),
    view.key,
  );
});
test("history and provisional replace together at persisted IDs without text matching", () => {
  const view = createView(snapshot(), "A");
  ingest(view, {
    observation: {
      snapshot: snapshot({
        provisional: {
          message: { role: "assistant", content: "temporary" },
          tools: [],
        },
      }),
    },
    history: { entries: [entry("a")], before: "" },
  });
  const next = snapshot({
    seq: 2,
    session: { id: "session", cutoff: "b" },
    persistedIds: ["b"],
    provisional: { message: null, tools: [] },
  });
  ingest(view, {
    observation: { snapshot: next },
    history: { entries: [entry("a"), entry("b", "a")], before: "" },
  });
  assert.deepEqual(
    view.entries.map((e) => e.id),
    ["a", "b"],
  );
  assert.equal(view.snapshot.provisional.message, null);
  ingest(view, {
    observation: { snapshot: next },
    history: { entries: [entry("a"), entry("b", "a")], before: "" },
  });
  assert.equal(view.entries.length, 2);
});
test("missing-page gap retains older reading view until explicit latest resync", () => {
  const view = createView(snapshot(), "A");
  ingest(view, {
    observation: { snapshot: snapshot() },
    history: { entries: [entry("a")], before: "" },
  });
  const later = snapshot({ seq: 2, session: { id: "session", cutoff: "z" } });
  const payload = {
    observation: { snapshot: later },
    history: { entries: [entry("z", "not-loaded")], before: "z" },
  };
  ingest(view, payload);
  assert.equal(view.needsLatest, true);
  assert.deepEqual(
    view.entries.map((e) => e.id),
    ["a"],
  );
  ingest(view, payload, true);
  assert.equal(view.needsLatest, false);
  assert.deepEqual(
    view.entries.map((e) => e.id),
    ["z"],
  );
});
test("stale responses cannot regress even explicit resync; wrong association never ingests", () => {
  const view = createView(snapshot({ seq: 5 }), "A");
  assert.equal(
    ingest(view, { observation: { snapshot: snapshot({ seq: 4 }) } }, true),
    false,
  );
  assert.equal(
    ingest(view, {
      observation: { snapshot: snapshot({ associationId: "other" }) },
    }),
    false,
  );
  assert.equal(view.snapshot.seq, 5);
});
test("tool/thinking bulk settings are independent and apply to entries loaded later", () => {
  const view = createView(snapshot(), "A");
  bulk(view, "tools", true);
  assert.equal(expanded(view, "tools", "later"), true);
  assert.equal(expanded(view, "thinking", "later"), false);
  toggle(view, "tools", "one", false);
  assert.equal(expanded(view, "tools", "one"), false);
  bulk(view, "thinking", true);
  assert.equal(expanded(view, "tools", "one"), false);
  bulk(view, "tools", false);
  assert.equal(view.tools.overrides.size, 0);
  assert.equal(expanded(view, "thinking", "one"), true);
  prepend(view, { entries: [entry("older")], before: "" });
  assert.equal(expanded(view, "thinking", "older"), true);
});
test("empty/oversized/malformed Unicode rejected without normalization", () => {
  for (const text of [
    "",
    " \n\t",
    "x".repeat(128 * 1024 + 1),
    "\ud800",
    "\udc00",
  ])
    assert.notEqual(messageError(text), "");
  assert.equal(messageError(" \nUnicode 🦉\n "), "");
});
test("dispatch responses must match the request ID and operation", () => {
  const request = { requestId: "one", operation: "send" };
  assert.equal(
    resultFor(request, {
      type: "result",
      version: 1,
      requestId: "two",
      status: "submitted_unconfirmed",
    }).status,
    "outcome_unknown",
  );
  assert.equal(
    resultFor(request, {
      type: "result",
      version: 1,
      requestId: "one",
      status: "stop_requested",
    }).status,
    "outcome_unknown",
  );
  assert.equal(
    resultFor(request, {
      type: "result",
      version: 1,
      requestId: "one",
      status: "submitted_unconfirmed",
    }).status,
    "submitted_unconfirmed",
  );
});
