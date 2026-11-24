// Synthetic interaction tests, not a real touchscreen/native-dialog check.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { boot, onLongPress } from "./app.js";

function pointer(window, target, type, values = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(
    event,
    { button: 0, isPrimary: true, clientX: 5, clientY: 5 },
    values,
  );
  target.dispatchEvent(event);
}
async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("Rename condition timed out");
    await delay(10);
  }
}
test("long press opens directly, consumes the click, and leaves taps/scrolls/cancellation alone", async () => {
  const { document, window } = parseHTML(
    "<html><body><button>session</button></body></html>",
  );
  const target = document.querySelector("button");
  let held = 0,
    clicked = 0;
  onLongPress(target, () => held++);
  target.addEventListener("click", () => clicked++);
  pointer(window, target, "pointerdown");
  pointer(window, target, "pointerup");
  target.click();
  assert.equal(clicked, 1);
  pointer(window, target, "pointerdown");
  pointer(window, target, "pointermove", { clientY: 30 });
  await delay(580);
  assert.equal(held, 0);
  pointer(window, target, "pointerdown");
  pointer(window, target, "pointercancel");
  await delay(580);
  assert.equal(held, 0);
  pointer(window, target, "pointerdown");
  await delay(580);
  assert.equal(held, 1);
  pointer(window, target, "pointerup");
  pointer(window, target, "click", { detail: 1 });
  assert.equal(clicked, 1);
  pointer(window, target, "pointerdown");
  pointer(window, target, "pointerup");
  target.click();
  assert.equal(clicked, 2);
});

function row(id) {
  return {
    endpointId: id,
    label: "Original " + id,
    integration: "connected",
    ownership: "single-context",
    panes: [{ backend: "herdr", id: "pane-" + id, tabId: "tab-" + id }],
    observation: {
      connected: true,
      snapshot: {
        endpointId: id,
        associationId: "assoc-" + id,
        seq: 1,
        host: { cwd: "/project" },
        session: { id: "session-" + id, cutoff: null },
        state: { activity: "idle", sendSupported: true },
        provisional: { message: null, tools: [] },
      },
    },
  };
}
async function setup(t) {
  const { document: doc, window } = parseHTML(
    readFileSync(new URL("./index.html", import.meta.url), "utf8"),
  );
  const $ = (id) => doc.getElementById(id);
  let focused = null;
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  window.HTMLElement.prototype.select = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, bottom: 20, height: this.hidden ? 0 : 20 };
  };
  for (const dialog of doc.querySelectorAll("dialog")) {
    dialog.open = false;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
      dialog.dispatchEvent(new window.Event("close"));
    };
  }
  $("history").scrollTop = 0;
  Object.defineProperty($("history"), "scrollHeight", { get: () => 1000 });
  Object.defineProperty($("history"), "clientHeight", { get: () => 300 });
  const rows = [row("a"), row("b")],
    requests = [];
  let fail = false,
    app;
  const response = (value) =>
    new Response(JSON.stringify(value), { status: 200 });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows, failures: {}, coverage: [] });
    if (String(url).startsWith("/conversation/")) {
      const id = String(url).split("/")[2].split("?")[0];
      return response({
        observation: rows.find((r) => r.endpointId === id).observation,
        history: { entries: [], before: "" },
      });
    }
    if (url === "/rename") {
      requests.push({ body: JSON.parse(options.body), options });
      if (fail)
        return new Response("Tab changed; open rename again.", { status: 409 });
      const req = requests.at(-1).body;
      rows.find((r) => r.endpointId === req.endpointId).label = req.name;
      return response({});
    }
    throw Error("Unexpected rename request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(doc);
  return {
    app,
    doc,
    window,
    $,
    rows,
    requests,
    fail: () => {
      fail = true;
    },
  };
}
test("selector hold renames its own tab without selecting it; Save refreshes real labels and Cancel has no effect", async (t) => {
  const { app, doc, window, $, rows, requests } = await setup(t);
  app.select(rows[0]);
  await until(() => !$("rename-button").disabled);
  $("sessions-button").click();
  const button = [...$("session-list").children].find(
    (node) => node.dataset.sessionKey === "b",
  );
  pointer(window, button, "pointerdown");
  // An unchanged chooser redraw must preserve the hold target.
  app.select(rows[0]);
  assert.equal(button.isConnected, true);
  await until(() => $("rename").open);
  pointer(window, button, "pointerup");
  pointer(window, button, "click", { detail: 1 });
  assert.equal($("recipient").textContent, "Original a");
  assert.equal($("sessions").open, true);
  assert.equal($("rename-name").value, "Original b");
  $("rename-cancel").click();
  assert.equal(requests.length, 0);
  $("sessions-close").click();
  $("rename-button").click();
  assert.equal($("rename-name").value, "Original a");
  $("rename-name").value = " ";
  $("rename-form").dispatchEvent(
    new window.Event("submit", { cancelable: true }),
  );
  assert.equal(requests.length, 0);
  assert.match($("rename-error").textContent, /Enter a tab name/);
  $("rename-name").value = "🦉".repeat(65);
  $("rename-form").dispatchEvent(
    new window.Event("submit", { cancelable: true }),
  );
  assert.equal(requests.length, 0);
  assert.match($("rename-error").textContent, /256 UTF-8 bytes/);
  $("rename-name").value = "A café / arbitrary <name>";
  $("rename-form").dispatchEvent(
    new window.Event("submit", { cancelable: true }),
  );
  await until(() => !$("rename").open);
  assert.deepEqual(requests[0].body, {
    endpointId: "a",
    associationId: "assoc-a",
    tabId: "tab-a",
    name: "A café / arbitrary <name>",
  });
  assert.equal(requests[0].options.headers["X-RAI-CSRF"], "a".repeat(64));
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() => $("recipient").textContent === "A café / arbitrary <name>");
  assert.equal($("recipient").children.length, 0);
  assert.equal(requests.length, 1);
});
test("header hold opens rename directly; stale failure stays visible without inventing a label or retrying", async (t) => {
  const { app, window, $, rows, requests, fail } = await setup(t);
  app.select(rows[0]);
  await until(() => !$("rename-button").disabled);
  pointer(window, $("recipient"), "pointerdown");
  await until(() => $("rename").open);
  pointer(window, $("recipient"), "pointerup");
  fail();
  $("rename-name").value = "No phantom alias";
  $("rename-form").dispatchEvent(
    new window.Event("submit", { cancelable: true }),
  );
  await until(() => $("rename-error").textContent.includes("Tab changed"));
  assert.equal($("rename").open, true);
  assert.equal($("recipient").textContent, "Original a");
  assert.equal($("rename-name").value, "No phantom alias");
  assert.equal(requests.length, 1);
  assert.equal($("rename-save").disabled, false);
});
test("a hold with no pointer click does not swallow the next keyboard activation", async (t) => {
  const { app, window, $, rows } = await setup(t);
  app.select(rows[0]);
  $("sessions-button").click();
  const button = [...$("session-list").children].find(
    (node) => node.dataset.sessionKey === "b",
  );
  pointer(window, button, "pointerdown");
  await until(() => $("rename").open);
  pointer(window, button, "pointerleave");
  $("rename-cancel").click();
  pointer(window, button, "click", { detail: 0 });
  assert.equal($("recipient").textContent, "Original b");
});
test("a disappeared selector origin restores focus inside the remaining Sessions modal", async (t) => {
  const { doc, window, $, rows } = await setup(t);
  const button = [...$("session-list").children].find(
    (node) => node.dataset.sessionKey === "b",
  );
  const key = new window.Event("keydown", { cancelable: true });
  key.key = "F2";
  button.dispatchEvent(key);
  rows.splice(1, 1);
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() => !button.isConnected);
  $("rename-cancel").click();
  assert.equal($("sessions").open, true);
  assert.equal(doc.activeElement, $("sessions-close"));
});
test("F2 is a direct keyboard path; unavailable/missing tab targets cannot rename", async (t) => {
  const { app, window, $, rows, requests } = await setup(t);
  const button = [...$("session-list").children].find(
    (node) => node.dataset.sessionKey === "b",
  );
  const key = new window.Event("keydown", { cancelable: true });
  key.key = "F2";
  button.dispatchEvent(key);
  assert.equal($("rename").open, true);
  $("rename-cancel").click();
  rows[0].panes = [];
  app.select(rows[0]);
  assert.equal($("rename-button").disabled, true);
  pointer(window, $("recipient"), "pointerdown");
  await delay(580);
  assert.equal($("rename").open, false);
  assert.equal(requests.length, 0);
});
