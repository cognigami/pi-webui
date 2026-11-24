// Synthetic DOM coverage; native modal focus/Escape and alignment need a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { boot } from "./app.js";

function fixture() {
  return parseHTML(
    readFileSync(new URL("./index.html", import.meta.url), "utf8"),
  );
}

test("session and view controls have accessible icon-only affordances", () => {
  const { document } = fixture();
  const $ = (id) => document.getElementById(id);
  assert.equal($("sessions-button").textContent, "☰");
  assert.equal($("sessions-button").getAttribute("aria-label"), "Sessions");
  assert.equal($("sessions").localName, "dialog");
  assert.equal($("sessions").getAttribute("aria-labelledby"), "sessions-title");
  assert.equal(
    $("sessions-close").parentElement.firstElementChild,
    $("sessions-close"),
  );
  assert.equal(
    $("sessions-close").getAttribute("aria-label"),
    "Close sessions",
  );
  assert.equal($("sessions-close").hasAttribute("autofocus"), true);
  assert.equal($("view-button").getAttribute("aria-label"), "View options");
  assert.equal($("view-button").getAttribute("title"), "View options");
  for (const id of ["sessions-close", "view-button"]) {
    assert.equal($(id).textContent, "");
    assert.equal(
      $(id).querySelector("svg").getAttribute("aria-hidden"),
      "true",
    );
    assert.equal($(id).querySelector("svg").getAttribute("focusable"), "false");
  }
  assert.equal($("messages").nextElementSibling, $("provisional"));
  assert.equal($("provisional").nextElementSibling, $("outgoing"));
});

test("header keeps mux label and adds safe Pi name to directory context", async (t) => {
  const { document, window } = fixture();
  const $ = (id) => document.getElementById(id);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, bottom: 20, height: this.hidden ? 0 : 20 };
  };
  window.HTMLElement.prototype.focus = () => {};
  const dialog = $("sessions");
  dialog.open = false;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(new window.Event("close"));
  };
  const history = $("history");
  history.scrollTop = 0;
  Object.defineProperty(history, "scrollHeight", { get: () => 1000 });
  Object.defineProperty(history, "clientHeight", { get: () => 300 });
  const snapshot = {
    type: "snapshot",
    version: 1,
    endpointId: "ui-controls",
    associationId: "assoc",
    seq: 1,
    observedAt: new Date().toISOString(),
    host: { pid: 1, cwd: "/work/project/ui", mode: "tui" },
    session: {
      id: "pi-session",
      name: "\u001b[31mReview <layout>\u001b[0m",
      leaf: null,
      cutoff: null,
    },
    state: { activity: "idle", pending: false, sendSupported: true },
    provisional: { message: null, tools: [] },
    historyReady: true,
  };
  const row = {
    endpointId: snapshot.endpointId,
    label: "Herdr mux name",
    integration: "connected",
    ownership: "single-context",
    panes: [],
    observation: { snapshot, connected: true },
  };
  const response = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const original = globalThis.fetch;
  let app;
  globalThis.fetch = async (url) => {
    if (url === "/api/bootstrap") return response({ csrf: "a".repeat(64) });
    if (url === "/sessions")
      return response({ rows: [row], failures: {}, coverage: [] });
    if (String(url).startsWith("/conversation/"))
      return response({
        observation: row.observation,
        history: { entries: [], before: "" },
      });
    throw Error("Unexpected UI request " + url);
  };
  t.after(() => {
    app?.stopPolling();
    globalThis.fetch = original;
  });
  app = await boot(document);
  assert.equal(dialog.open, true);
  $("sessions-close").click();
  assert.equal(dialog.open, false);
  assert.equal($("sessions-button").getAttribute("aria-expanded"), "false");
  $("sessions-button").click();
  assert.equal(dialog.open, true);
  assert.equal($("sessions-button").getAttribute("aria-expanded"), "true");
  // Simulate native Escape's close event; linkedom cannot exercise browser modality.
  dialog.close();
  assert.equal($("sessions-button").getAttribute("aria-expanded"), "false");
  app.select(row);
  const deadline = Date.now() + 5000;
  while (!$("recipient-context").textContent.includes("Review <layout>")) {
    if (Date.now() > deadline)
      throw Error("Header did not receive session context");
    await delay(10);
  }
  assert.equal($("recipient").textContent, "Herdr mux name");
  assert.equal(
    $("recipient-context").textContent,
    "project/ui · Review <layout>",
  );
  assert.equal($("recipient-context").hidden, false);
  assert.equal($("recipient-context").children.length, 0);
  $("view-button").click();
  assert.equal($("view-menu").hidden, false);
  assert.equal($("view-button").getAttribute("aria-expanded"), "true");
});
