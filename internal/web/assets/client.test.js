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
    focused = this;
  };
  window.HTMLElement.prototype.blur = function () {
    if (focused === this) focused = null;
  };
  for (const id of ["sessions", "review"]) {
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
test("session chooser foregrounds connected sessions with native modal focus; other sessions stay folded", {
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
  let rows = [other, row("z")],
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
  assert.equal(
    $("session-list").querySelector(".session strong").textContent,
    "Session z",
  );
  assert.equal(
    $("session-list").querySelector(".session-status").dataset.state,
    "connected",
  );
  const others = $("session-list").querySelector(".unavailable-sessions");
  assert.equal(others.open, false);
  assert.equal($("discovery-details").hasAttribute("open"), false);
  assert.equal(
    $("session-list").textContent.includes("explicit extension load required"),
    false,
  );
  others.open = true;
  const summary = others.querySelector("summary");
  summary.focus();
  rows = [other, row("z"), row("a")];
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("2 connected sessions"),
  );
  const refreshed = $("session-list").querySelector(".unavailable-sessions");
  assert.equal(refreshed.open, true);
  assert.equal(doc.activeElement, refreshed.querySelector("summary"));
  rows = [other];
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("No sessions connected"),
  );
  assert.match(
    $("session-list").querySelector(".empty-state").textContent,
    /socket path and terminal notices/,
  );
});
test("chooser reports bootstrap failure and stale list inside the sheet, then clears on recovery", {
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
    /Could not refresh.*fixture offline/,
  );
  assert.equal($("session-list").querySelector(".empty-state"), null);
  assert.match($("discovery-health").textContent, /fixture offline/);
  failing = false;
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("1 connected session"),
  );
  failing = true;
  doc.dispatchEvent(new window.Event("visibilitychange"));
  await until(() =>
    $("session-summary").textContent.includes("last known sessions"),
  );
  assert.equal(
    $("session-list").querySelector(".session-status").textContent,
    "Connection unverified",
  );
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
test("DOM composer/Stop/uncertain receipt remains on original conversation; drafts and newest selection survive switching", {
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
  $("message-button").click();
  const literal = " \n/command café 🦉\n  ";
  $("draft").value = literal;
  $("draft").dispatchEvent(new window.Event("input"));
  assert.equal($("send-button").disabled, false);
  $("send-button").click();
  $("send-button").click();
  await until(() => calls.length === 1);
  assert.equal(calls[0].text, literal);
  assert.equal($("composer").hidden, true);
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
  assert.equal($("feedback").textContent.includes("Outcome unknown"), false);
  app.select(rows[0]);
  assert.match($("feedback").textContent, /Outcome unknown/);
  assert.match($("feedback").textContent, /Stop requested/);
  $("review-button").click();
  assert.ok(
    [...$("review-content").querySelectorAll("pre")].some(
      (n) => n.textContent === literal,
    ),
  );
  [...$("review-content").querySelectorAll("button")]
    .find((b) => b.textContent === "Use as draft")
    .click();
  assert.equal($("draft").value, literal);
  assert.equal($("composer").hidden, false);
  assert.equal(calls.length, 2);
  app.select(rows[1]);
  await until(
    () => app.views.get(conversationKey(rows[1].observation.snapshot)).verified,
  );
  $("message-button").click();
  $("draft").value = "second draft";
  $("draft").dispatchEvent(new window.Event("input"));
  $("close-button").click();
  app.select(rows[0]);
  history.scrollTop = 150;
  app.select(rows[1]);
  assert.equal(
    history.scrollTop,
    1000,
    "revisited session opens at newest, not prior recipient scroll offset",
  );
  assert.equal($("draft").value, "second draft");
  assert.equal($("composer").hidden, true);
  assert.equal(calls.length, 2);
  $("review-button").click();
  const staleUse = [...$("review-content").querySelectorAll("button")].find(
    (b) => b.textContent === "Use in Session b",
  );
  assert.ok(staleUse);
  app.select(rows[0]);
  staleUse.click();
  assert.match($("announcements").textContent, /Conversation changed/);
  assert.equal(a.draft, literal);
  assert.equal(
    app.views.get(conversationKey(rows[1].observation.snapshot)).draft,
    "second draft",
  );
  assert.equal(calls.length, 2);
});
