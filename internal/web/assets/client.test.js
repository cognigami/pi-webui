// DOM client behavior with synthetic fetch/geometry; not a real-browser layout test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { boot } from "./app.js";
import { conversationKey } from "./model.js";

async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("DOM condition timed out");
    await delay(10);
  }
}
function fixtureDOM() {
  const { document, window } = parseHTML(
    readFileSync(new URL("./index.html", import.meta.url), "utf8"),
  );
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, bottom: 20, height: this.hidden ? 0 : 20 };
  };
  window.HTMLElement.prototype.focus = function () {
    if (focused !== this) {
      focused = this;
      this.dispatchEvent(new window.Event("focus"));
    }
  };
  window.HTMLElement.prototype.blur = function () {
    if (focused === this) focused = null;
  };
  for (const id of ["sessions"]) {
    const d = document.getElementById(id);
    d.open = false;
    d.showModal = () => {
      d.open = true;
      d.dataset.modal = "true";
    };
    d.show = () => {
      d.open = true;
      d.dataset.modal = "false";
    };
    d.close = () => {
      d.open = false;
    };
  }
  const history = document.getElementById("history");
  history.scrollTop = 0;
  Object.defineProperty(history, "scrollHeight", { get: () => 1000 });
  Object.defineProperty(history, "clientHeight", { get: () => 300 });
  return { document, window, history };
}
function row(id) {
  const snapshot = {
    type: "snapshot",
    version: 1,
    endpointId: id,
    associationId: "association-" + id,
    seq: 1,
    observedAt: new Date().toISOString(),
    host: { pid: id === "a" ? 1 : 2, cwd: "/synthetic", mode: "tui" },
    session: { id: "session-" + id, leaf: "u", cutoff: "u" },
    state: { activity: "idle", pending: false, sendSupported: true },
    provisional: { message: null, tools: [] },
    historyReady: true,
  };
  return {
    endpointId: id,
    label: "Session " + id,
    context: "/synthetic " + id,
    integration: "connected",
    ownership: "single-context",
    panes: [],
    observation: { snapshot, connected: true },
  };
}
const response = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
test("chooser shows only reachable sessions, preserves focus, and has no diagnostics", {
  timeout: 12000,
}, async (t) => {
  const { document: doc, window } = fixtureDOM();
  const $ = (id) => doc.getElementById(id);
  const other = {
    label: "AAA unrelated Pi",
    context: "elsewhere",
    integration: "unavailable",
    panes: [],
  };
  const disconnected = row("offline");
  disconnected.observation.connected = false;
  let rows = [other, disconnected, row("z")],
    app;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows, failures: {}, coverage: ["fixture discovery"] });
    throw Error("Unexpected chooser request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(doc);
  assert.equal($("sessions").dataset.modal, "true");
  assert.match($("session-summary").textContent, /1 connected session/);
  assert.equal($("session-list").querySelectorAll(".session").length, 1);
  const button = $("session-list").querySelector(".session");
  assert.equal(button.querySelector("strong").textContent, "Session z");
  assert.equal($("sessions-button").textContent, "☰");
  assert.equal($("sessions-button").getAttribute("aria-label"), "Sessions");
  for (const id of [
    "details-button",
    "details",
    "discovery-details",
    "discovery-health",
  ])
    assert.equal($(id), null);
  assert.equal(
    $("session-list").textContent.includes("AAA unrelated Pi"),
    false,
  );
  button.focus();
  rows = [other, disconnected, row("z"), row("a")];
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("2 connected sessions"),
  );
  assert.equal(doc.activeElement.dataset.sessionKey, "z");
  rows = [other, disconnected];
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("No connected sessions"),
  );
  assert.equal($("session-list").querySelectorAll(".session").length, 0);
  assert.match(
    $("session-list").querySelector(".empty-state").textContent,
    /socket path and terminal notices/,
  );
});
test("chooser reports lookup failure without showing unreachable cached sessions, then recovers", {
  timeout: 12000,
}, async (t) => {
  const { document: doc, window } = fixtureDOM();
  const $ = (id) => doc.getElementById(id);
  let failing = true,
    app;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (failing) throw Error("fixture offline");
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows: [row("z")], failures: {}, coverage: [] });
    throw Error("Unexpected request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(doc);
  assert.match(
    $("session-summary").textContent,
    /Could not load.*fixture offline/,
  );
  assert.equal($("session-list").querySelector(".empty-state"), null);
  assert.equal($("discovery-health"), null);
  failing = false;
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("1 connected session"),
  );
  failing = true;
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("Could not load"),
  );
  assert.equal($("session-list").querySelectorAll(".session").length, 0);
  failing = false;
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("1 connected session"),
  );
  assert.equal(
    $("session-list").querySelector(".session-status").textContent,
    "Connected",
  );
});
test("untouched conversation has one ordinary editor and no draft-management UI", {
  timeout: 10000,
}, async (t) => {
  const { document: doc, window } = fixtureDOM();
  const $ = (id) => doc.getElementById(id);
  const target = row("empty");
  target.observation.snapshot.session.leaf = "setup";
  target.observation.snapshot.session.cutoff = null;
  const original = globalThis.fetch;
  let app;
  globalThis.fetch = async (url) => {
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows: [target], failures: {}, coverage: [] });
    if (String(url).startsWith("/conversation/"))
      return response({
        observation: target.observation,
        history: { entries: [], before: "" },
      });
    throw Error("Unexpected control request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(doc);
  app.select(target);
  await until(
    () => app.views.get(conversationKey(target.observation.snapshot)).verified,
  );
  assert.match($("history-health").textContent, /No messages yet/);
  assert.equal($("composer").hidden, false);
  assert.equal($("draft").rows, 1);
  assert.equal(doc.querySelectorAll("textarea").length, 1);
  assert.equal($("send-button").disabled, true);
  $("draft").focus();
  $("draft").value = "unsent draft";
  $("draft").dispatchEvent(new window.Event("input"));
  assert.equal($("send-button").disabled, false);
  const escapeKey = new window.Event("keydown");
  escapeKey.key = "Escape";
  $("draft").dispatchEvent(escapeKey);
  assert.equal($("draft").rows, 1);
  assert.equal($("draft").value, "unsent draft");
  for (const id of [
    "review",
    "review-button",
    "draft-actions",
    "clear-button",
    "close-button",
  ])
    assert.equal($(id), null);
  $("draft").value = "";
  $("draft").dispatchEvent(new window.Event("input"));
  assert.equal($("send-button").disabled, true);
});
test("ordinary submission clears input without adding success feedback to the conversation", {
  timeout: 10000,
}, async (t) => {
  const { document: doc, window } = fixtureDOM();
  const $ = (id) => doc.getElementById(id);
  const target = row("success");
  let app,
    calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows: [target], failures: {}, coverage: [] });
    if (String(url).startsWith("/conversation/"))
      return response({
        observation: target.observation,
        history: { entries: [], before: "" },
      });
    if (url === "/control") {
      calls++;
      const req = JSON.parse(options.body);
      return response({
        type: "result",
        version: 1,
        requestId: req.requestId,
        status: "submitted_unconfirmed",
      });
    }
    throw Error("Unexpected fixture request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(doc);
  app.select(target);
  const view = app.views.get(conversationKey(target.observation.snapshot));
  await until(() => view.verified);
  $("draft").value = "hello";
  $("draft").dispatchEvent(new window.Event("input"));
  $("send-button").click();
  await until(() => view.pending === null);
  assert.equal(calls, 1);
  assert.equal($("draft").value, "");
  assert.equal($("feedback").textContent, "");
  assert.equal($("send-button").textContent, "Send");
  assert.equal($("messages").textContent.includes("Submitted"), false);
});
test("normal conversation hides internal session records; View opt-in reveals compact retained details", {
  timeout: 10000,
}, async (t) => {
  const { document: doc, window } = fixtureDOM();
  const $ = (id) => doc.getElementById(id);
  const target = row("chat");
  const entries = [
    {
      id: "model",
      type: "model_change",
      data: { type: "model_change", provider: "test", modelId: "test-model" },
    },
    {
      id: "thinking",
      type: "thinking_level_change",
      data: { type: "thinking_level_change", thinkingLevel: "high" },
    },
    {
      id: "custom",
      type: "custom",
      data: {
        type: "custom",
        customType: "internal-marker",
        data: { html: "<script>inert</script>" },
      },
    },
    {
      id: "system",
      type: "message",
      role: "system",
      data: {
        type: "message",
        message: { role: "system", content: "hidden system setup" },
      },
    },
    {
      id: "u",
      type: "message",
      role: "user",
      data: {
        type: "message",
        message: { role: "user", content: "my actual message" },
      },
    },
    {
      id: "a",
      type: "message",
      role: "assistant",
      data: {
        type: "message",
        message: { role: "assistant", content: "the actual reply" },
      },
    },
  ];
  const original = globalThis.fetch;
  let app;
  globalThis.fetch = async (url) => {
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows: [target], failures: {}, coverage: [] });
    if (String(url).startsWith("/conversation/"))
      return response({
        observation: target.observation,
        history: { entries, before: "" },
      });
    throw Error("Unexpected control request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(doc);
  app.select(target);
  await until(
    () => app.views.get(conversationKey(target.observation.snapshot)).verified,
  );
  assert.equal($("messages").querySelectorAll("article").length, 2);
  assert.equal($("messages").querySelectorAll(".chat-message").length, 2);
  assert.match($("messages").textContent, /my actual message/);
  assert.match($("messages").textContent, /the actual reply/);
  assert.equal($("messages").textContent.includes("internal-marker"), false);
  assert.equal(
    $("messages").textContent.includes("hidden system setup"),
    false,
  );
  $("records-button").click();
  assert.equal($("records-button").getAttribute("aria-pressed"), "true");
  assert.equal($("messages").querySelectorAll(".session-record").length, 4);
  assert.equal($("messages").querySelectorAll(".session-record h2").length, 0);
  assert.equal($("messages").querySelector("script"), null);
  const details = $("messages").querySelector(".session-record details");
  assert.equal(details.open, false);
  details.open = true;
  details.dispatchEvent(new window.Event("toggle"));
  $("records-button").click();
  assert.equal($("messages").querySelectorAll("article").length, 2);
  $("records-button").click();
  assert.equal(
    $("messages").querySelector(".session-record details").open,
    true,
  );
});
test("Send/Stop outcomes stay on original conversation without review UI; editable input survives switching", {
  timeout: 15000,
}, async (t) => {
  const { document: doc, window, history } = fixtureDOM();
  const $ = (id) => doc.getElementById(id);
  const rows = [row("a"), row("b")],
    calls = [];
  rows[0].observation.snapshot.provisional.tools = [
    {
      type: "tool_execution_end",
      toolCallId: "future",
      toolName: "future",
      result: { newFormat: "<script>not active</script>" },
    },
  ];
  let resolveSend, sendRequest;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (path === "/sessions")
      return response({ rows, failures: {}, coverage: [] });
    if (path.startsWith("/conversation/")) {
      const id = path.split("/")[2].split("?")[0],
        source = rows.find((r) => r.endpointId === id);
      return response({
        observation: source.observation,
        history: {
          entries: [
            {
              id: "u",
              parentId: null,
              type: "message",
              role: "user",
              data: {
                type: "message",
                message: { role: "user", content: "hello " + id },
              },
            },
          ],
          before: "",
        },
      });
    }
    if (path === "/control") {
      const request = JSON.parse(options.body);
      calls.push(request);
      if (request.operation === "send") {
        sendRequest = request;
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }
      return response({
        type: "result",
        version: 1,
        requestId: request.requestId,
        status: "stop_requested",
        detail: "Stop requested",
      });
    }
    throw Error("Unexpected fixture request " + path);
  };
  let app;
  t.after(() => {
    app?.stopPolling();
    if (resolveSend)
      resolveSend(
        response({
          type: "result",
          version: 1,
          requestId: sendRequest.requestId,
          status: "outcome_unknown",
        }),
      );
    globalThis.fetch = original;
  });
  app = await boot(doc);
  app.select(rows[0]);
  const a = app.views.get(conversationKey(rows[0].observation.snapshot));
  await until(() => a.verified);
  assert.match($("provisional").textContent, /Unsupported tool result format/);
  assert.equal($("provisional").querySelector("script"), null);
  assert.equal(doc.querySelectorAll("textarea").length, 1);
  assert.equal($("message-button"), null);
  assert.equal($("draft").rows, 1);
  assert.equal($("draft-actions"), null);
  $("draft").focus();
  assert.equal($("draft").rows, 3);
  const literal = " \n/command café 🦉\n  ";
  $("draft").value = literal;
  $("draft").dispatchEvent(new window.Event("input"));
  assert.equal($("send-button").disabled, false);
  $("send-button").click();
  $("send-button").click();
  await until(() => calls.length === 1);
  assert.equal(calls[0].text, literal);
  assert.equal($("composer").hidden, false);
  assert.equal($("draft").rows, 1);
  assert.equal(doc.activeElement, null);
  assert.equal($("stop-button").disabled, false);
  $("stop-button").click();
  await until(() => $("feedback").textContent.includes("Stop requested"));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].operation, "stop");
  app.select(rows[1]);
  resolveSend(
    response({
      type: "result",
      version: 1,
      requestId: sendRequest.requestId,
      status: "outcome_unknown",
    }),
  );
  await until(() => a.pending === null);
  assert.equal(
    $("feedback").textContent.includes("Delivery unconfirmed"),
    false,
  );
  app.select(rows[0]);
  assert.match($("feedback").textContent, /Delivery unconfirmed/);
  assert.match($("feedback").textContent, /Stop requested/);
  assert.equal($("review-button"), null);
  assert.equal($("draft").readOnly, false);
  assert.equal($("draft").value, literal);
  assert.equal($("composer").hidden, false);
  assert.equal(calls.length, 2);
  app.select(rows[1]);
  await until(
    () => app.views.get(conversationKey(rows[1].observation.snapshot)).verified,
  );
  $("draft").focus();
  $("draft").value = "second draft";
  $("draft").dispatchEvent(new window.Event("input"));
  app.select(rows[0]);
  history.scrollTop = 150;
  app.select(rows[1]);
  assert.equal(
    history.scrollTop,
    1000,
    "revisited session opens at newest, not prior recipient scroll offset",
  );
  assert.equal($("draft").value, "second draft");
  assert.equal($("composer").hidden, false);
  assert.equal($("draft").rows, 1);
  assert.equal(calls.length, 2);
  assert.equal(a.draft, literal);
  assert.equal(
    app.views.get(conversationKey(rows[1].observation.snapshot)).draft,
    "second draft",
  );
  assert.equal(calls.length, 2);
});
