import assert from "node:assert/strict";
import test from "node:test";
import {
  beginSend,
  createView,
  finishSend,
  ingest,
  prepend,
  reconcileOutgoing,
} from "./model.js";

const snapshot = (cutoff = "old", seq = 1) => ({
  endpointId: "ep",
  associationId: "assoc",
  seq,
  session: { id: "session", cutoff },
  state: { activity: "idle", sendSupported: true },
});
const entry = (id, text, parentId = null, role = "user") => ({
  id,
  parentId,
  type: "message",
  role,
  data: {
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  },
});
function update(view, entries, cutoff = entries.at(-1)?.id, reset = false) {
  ingest(
    view,
    {
      observation: { snapshot: snapshot(cutoff, view.snapshot.seq + 1) },
      history: { entries, before: "" },
    },
    reset,
  );
}
function send(view, id, text) {
  view.draft = text;
  beginSend(view, id);
}
test("local outgoing copy exists immediately; retained user content replaces it, not a dispatch response", () => {
  const view = createView(snapshot(), "A");
  update(view, [entry("old", "same")]);
  send(view, "one", "same");
  assert.equal(view.outgoing[0].status, "sending");
  finishSend(view, "one", { status: "submitted_unconfirmed" });
  assert.equal(view.outgoing[0].status, "submitted_unconfirmed");
  update(view, [
    entry("old", "same"),
    entry("assistant", "same", "old", "assistant"),
  ]);
  assert.equal(view.outgoing.length, 1);
  update(view, [
    entry("old", "same"),
    entry("assistant", "same", "old", "assistant"),
    entry("new", "same", "assistant"),
  ]);
  assert.equal(view.outgoing.length, 0);
});
test("poll-before-response reconciles once dispatch settles, not as acceptance proof", () => {
  const view = createView(snapshot(null), "A");
  send(view, "one", " café 🦉\n");
  update(view, [entry("new", " café 🦉\n")]);
  assert.equal(view.outgoing.length, 1);
  finishSend(view, "one", { status: "submitted_unconfirmed" });
  assert.equal(view.outgoing.length, 0);
  assert.equal(view.pending, null);
});
test("matching terminal input before a rejected Send response never erases Not sent", () => {
  const view = createView(snapshot(null), "A");
  send(view, "one", "same");
  update(view, [entry("terminal", "same")]);
  finishSend(view, "one", { status: "rejected", detail: "stale target" });
  assert.equal(view.outgoing[0].status, "rejected");
  assert.equal(view.draft, "same");
  assert.equal(view.matchedOutgoing.size, 0);
});
test("equal sends consume distinct retained messages and never match old history or other conversations", () => {
  const view = createView(snapshot(), "A");
  update(view, [entry("old", "repeat")]);
  send(view, "one", "repeat");
  finishSend(view, "one", { status: "submitted_unconfirmed" });
  send(view, "two", "repeat");
  finishSend(view, "two", { status: "submitted_unconfirmed" });
  const other = createView({ ...snapshot(), associationId: "other" }, "B");
  update(other, [entry("old", "repeat"), entry("new", "repeat", "old")]);
  assert.equal(view.outgoing.length, 2);
  update(view, [entry("old", "repeat"), entry("new", "repeat", "old")]);
  assert.deepEqual(
    view.outgoing.map((item) => item.id),
    ["two"],
  );
  update(view, [entry("old", "repeat"), entry("new", "repeat", "old")]);
  assert.equal(view.outgoing.length, 1);
  update(view, [
    entry("old", "repeat"),
    entry("new", "repeat", "old"),
    entry("newer", "repeat", "new"),
  ]);
  assert.equal(view.outgoing.length, 0);
});
test("rejections remain not-sent and uncertain copies retain the editable draft", () => {
  for (const status of ["rejected", "outcome_unknown"]) {
    const view = createView(snapshot(), "A");
    update(view, [entry("old", "before")]);
    send(view, "one", "literal");
    finishSend(view, "one", { status, detail: "fixture" });
    assert.equal(view.outgoing[0].status, status);
    assert.equal(view.draft, "literal");
    update(view, [entry("old", "before"), entry("new", "literal", "old")]);
    assert.equal(view.outgoing.length, status === "rejected" ? 1 : 0);
  }
});
test("deferred retained user content reconciles only once actually loaded", () => {
  const view = createView(snapshot(), "A");
  update(view, [entry("old", "before")]);
  send(view, "one", "large text");
  finishSend(view, "one", { status: "submitted_unconfirmed" });
  update(view, [
    entry("old", "before"),
    {
      id: "large",
      parentId: "old",
      type: "message",
      role: "user",
      deferred: true,
    },
  ]);
  assert.equal(view.outgoing.length, 1);
  view.full.set("large", entry("large", "large text", "old").data);
  reconcileOutgoing(view);
  assert.equal(view.outgoing.length, 0);
});
test("a missing cutoff/gap does not deduplicate against arbitrary matching history", () => {
  const view = createView(snapshot(), "A");
  send(view, "one", "repeat");
  finishSend(view, "one", { status: "submitted_unconfirmed" });
  update(view, [entry("later", "repeat", "missing")], "later", true);
  assert.equal(view.outgoing.length, 1);
  prepend(view, { entries: [entry("old", "before")], before: "" });
  assert.equal(view.outgoing.length, 1);
  update(
    view,
    [
      entry("old", "before"),
      entry("missing", "bridge", "old"),
      entry("later", "repeat", "missing"),
    ],
    "later",
    true,
  );
  assert.equal(view.outgoing.length, 0);
});
