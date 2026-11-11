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

// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally remove ANSI control sequences from untrusted output.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally remove C0 controls while retaining tabs and newlines.
const CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
export function safeText(value) {
  return String(value ?? "")
    .replace(ANSI, "")
    .replace(CONTROLS, "");
}
function el(doc, tag, text, className) {
  const n = doc.createElement(tag);
  if (text !== undefined) n.textContent = safeText(text);
  if (className) n.className = className;
  return n;
}
export function renderText(doc, target, text) {
  const pieces = safeText(text).split(/```[^\n]*\n([\s\S]*?)(?:```|$)/g);
  pieces.forEach((piece, i) => {
    if (!piece) return;
    if (i % 2) {
      const pre = el(doc, "pre");
      pre.append(el(doc, "code", piece));
      target.append(pre);
    } else
      for (const paragraph of piece.split(/\n\s*\n/)) {
        if (paragraph) target.append(el(doc, "p", paragraph));
      }
  });
}
function disclosure(doc, view, type, key, title, body, changed) {
  const box = el(doc, "div", undefined, "disclosure"),
    button = el(doc, "button", title),
    content = el(doc, "div", undefined, "disclosure-body");
  const open = expanded(view, type, key);
  button.type = "button";
  button.dataset.focusKey = key;
  button.setAttribute("aria-expanded", String(open));
  content.hidden = !open;
  button.addEventListener("click", () => {
    toggle(view, type, key, !expanded(view, type, key));
    changed();
  });
  body(content);
  box.append(button, content);
  return box;
}
function blocks(doc, target, content, view, prefix, helpers) {
  if (typeof content === "string") {
    renderText(doc, target, content);
    return;
  }
  if (!Array.isArray(content)) {
    target.append(el(doc, "p", "Unsupported message content.", "error"));
    return;
  }
  content.forEach((part, i) => {
    if (!part || typeof part !== "object") {
      target.append(el(doc, "p", "Unsupported content block."));
      return;
    }
    if (part.type === "text") renderText(doc, target, part.text);
    else if (part.type === "thinking")
      target.append(
        disclosure(
          doc,
          view,
          "thinking",
          prefix + ":thinking:" + i,
          "Thinking",
          (body) => renderText(doc, body, part.thinking),
          helpers.changed,
        ),
      );
    else if (part.type === "toolCall")
      target.append(
        disclosure(
          doc,
          view,
          "tools",
          "call:" + part.id,
          "Tool call · " + part.name,
          (body) =>
            body.append(
              el(doc, "pre", JSON.stringify(part.arguments, null, 2)),
            ),
          helpers.changed,
        ),
      );
    else
      target.append(
        el(
          doc,
          "p",
          part.type === "image"
            ? "Image content — automatic resource loading disabled."
            : "Unsupported content block: " + part.type,
          "meta",
        ),
      );
  });
}
export function isConversationRecord(view, entry) {
  const raw = view.full.get(entry.id) ?? entry.data;
  const role = entry.role ?? raw?.message?.role;
  return (
    ["user", "assistant", "toolResult"].includes(role) ||
    entry.isError ||
    Boolean(raw?.message?.errorMessage) ||
    ["error", "aborted"].includes(raw?.message?.stopReason) ||
    ["compaction", "branch_summary"].includes(entry.type) ||
    (entry.type === "custom_message" &&
      (entry.display ?? raw?.display) !== false)
  );
}
function recordLabel(entry, raw) {
  if (entry.role === "toolResult")
    return "Tool · " + (entry.toolName ?? "unknown");
  if (entry.type === "model_change")
    return (
      "Model · " + (raw?.provider ?? "") + "/" + (raw?.modelId ?? "unknown")
    );
  if (entry.type === "thinking_level_change")
    return "Thinking · " + (raw?.thinkingLevel ?? "unknown");
  if (entry.type === "compaction")
    return "Compaction · retained originals remain available";
  if (entry.type === "branch_summary")
    return "Branch summary · selected ancestry only";
  if (entry.role === "system" || raw?.message?.role === "system")
    return "System context";
  if (["custom", "custom_message"].includes(entry.type))
    return "Extension · " + (raw?.customType ?? entry.type);
  return "Session record · " + entry.type;
}
export function renderRecord(doc, view, entry, helpers) {
  const article = el(doc, "article");
  const raw = view.full.get(entry.id) ?? entry.data;
  const role = entry.role ?? raw?.message?.role;
  const primary = ["user", "assistant"].includes(role);
  article.dataset.record = entry.id;
  article.dataset.role = role || entry.type;
  article.className = primary
    ? "chat-message"
    : role === "toolResult"
      ? "tool-record"
      : "session-record";
  if (primary)
    article.append(el(doc, "h2", role === "user" ? "You" : "Assistant"));
  if (entry.isError)
    article.append(
      el(
        doc,
        "p",
        entry.role === "toolResult" ? "Tool error" : "Response error",
        "error",
      ),
    );
  if (
    !primary &&
    !entry.isError &&
    (raw?.message?.errorMessage ||
      ["error", "aborted"].includes(raw?.message?.stopReason))
  )
    article.append(
      el(
        doc,
        "p",
        raw.message.errorMessage || "Response " + raw.message.stopReason,
        "error",
      ),
    );
  if (entry.deferred && !raw) {
    if (!primary) article.append(el(doc, "p", recordLabel(entry, raw), "meta"));
    const loading = view.loads.get(entry.id);
    if (loading?.error) article.append(el(doc, "p", loading.error, "error"));
    const button = el(
      doc,
      "button",
      loading?.controller
        ? "Loading retained content… " +
            loading.progress +
            " / " +
            entry.bytes +
            " bytes"
        : "Load full retained entry · " + entry.bytes + " bytes",
    );
    button.disabled = !!loading?.controller;
    button.addEventListener("click", () => helpers.expand(entry));
    article.append(button);
    return article;
  }
  if (!raw || typeof raw !== "object") {
    article.append(el(doc, "p", "Unsupported or unavailable entry.", "error"));
    return article;
  }
  if ((!primary && role !== "toolResult") || raw.type !== "message") {
    if (raw.type === "custom_message" && raw.display !== false) {
      article.append(el(doc, "p", recordLabel(entry, raw), "meta"));
      blocks(doc, article, raw.content, view, entry.id, helpers);
      return article;
    }
    const details = el(doc, "details");
    details.open = view.recordOpen.has(entry.id);
    details.addEventListener("toggle", () => {
      if (details.open) view.recordOpen.add(entry.id);
      else view.recordOpen.delete(entry.id);
    });
    details.append(el(doc, "summary", recordLabel(entry, raw)));
    if (raw.type === "compaction" || raw.type === "branch_summary")
      renderText(doc, details, raw.summary);
    else details.append(el(doc, "pre", JSON.stringify(raw, null, 2)));
    article.append(details);
    return article;
  }
  if (raw.type === "message") {
    const message = raw.message;
    if (!message || typeof message !== "object") {
      article.append(el(doc, "p", "Unsupported message.", "error"));
      return article;
    }
    if (
      message.errorMessage ||
      message.stopReason === "error" ||
      message.stopReason === "aborted"
    )
      article.append(
        el(
          doc,
          "p",
          message.errorMessage ||
            (message.stopReason === "aborted"
              ? "Response aborted"
              : "Response error"),
          "error",
        ),
      );
    if (message.role === "toolResult") {
      if (message.parentToolCallId)
        article.append(
          el(doc, "p", "Nested under " + message.parentToolCallId, "meta"),
        );
      article.append(
        disclosure(
          doc,
          view,
          "tools",
          "result:" + message.toolCallId,
          (message.isError ? "Error result" : "Tool result") +
            " · " +
            (message.toolName || "unknown"),
          (body) => blocks(doc, body, message.content, view, entry.id, helpers),
          helpers.changed,
        ),
      );
    } else blocks(doc, article, message.content, view, entry.id, helpers);
  }
  return article;
}

export async function boot(doc = globalThis.document) {
  const $ = (id) => doc.getElementById(id),
    views = new Map();
  let active = null,
    selected = null,
    rows = [],
    online = false,
    unavailable = false,
    csrf = "",
    listAt = 0,
    stopped = false,
    loadingOlder = false;
  let notice = "",
    discoveryError = "",
    connection = "",
    lastAnnouncement = "",
    lastSignature = "";
  let polling = false,
    pollTimer,
    lastVerifiedAt = 0;
  const requestId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
  const history = $("history");
  const announce = (text) => {
    if (text !== lastAnnouncement) {
      $("announcements").textContent = text;
      lastAnnouncement = text;
    }
  };
  const atBottom = () =>
    history.scrollHeight - history.clientHeight - history.scrollTop < 60;
  function anchored(change, follow = false) {
    const before = history.getBoundingClientRect().top;
    const focus = doc.activeElement?.dataset?.focusKey;
    const focused =
      focus && history.contains(doc.activeElement) ? doc.activeElement : null;
    const anchor =
      focused ||
      [
        ...history.querySelectorAll(
          "[data-anchor]:not(article):not(.disclosure-body)",
        ),
      ].find((n) => {
        const rect = n.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > before;
      });
    const key = anchor?.dataset.anchor,
      offset = anchor ? anchor.getBoundingClientRect().top - before : 0,
      top = history.scrollTop;
    const header = anchor?.closest(".disclosure")?.querySelector("button");
    const fallback = header?.dataset.focusKey,
      fallbackOffset = header
        ? Math.max(0, header.getBoundingClientRect().top - before)
        : 0;
    const article = anchor?.closest("article")?.dataset.record;
    change();
    for (const record of history.querySelectorAll("article[data-record]")) {
      record.dataset.anchor = record.dataset.record + ":article";
      [
        ...record.querySelectorAll("p,pre,button,summary,.disclosure-body"),
      ].forEach((block, i) => {
        block.dataset.anchor = record.dataset.record + ":block:" + i;
      });
    }
    if (follow) history.scrollTop = history.scrollHeight;
    else {
      let desiredOffset = offset;
      let found = [...history.querySelectorAll("[data-anchor]")].find(
        (n) => n.dataset.anchor === key,
      );
      if (!found || found.getBoundingClientRect().height === 0) {
        found = [...history.querySelectorAll("[data-focus-key]")].find(
          (n) => n.dataset.focusKey === fallback,
        );
        desiredOffset = fallbackOffset;
      }
      if (!found)
        found = [...history.querySelectorAll("article[data-record]")].find(
          (n) => n.dataset.record === article,
        );
      if (found)
        history.scrollTop +=
          found.getBoundingClientRect().top -
          history.getBoundingClientRect().top -
          desiredOffset;
      else history.scrollTop = top;
    }
    if (focus) {
      const button = [...doc.querySelectorAll("[data-focus-key]")].find(
        (n) => n.dataset.focusKey === focus,
      );
      button?.focus({ preventScroll: true });
    }
  }
  async function request(path, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8000);
    const cancel = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(path, {
        ...options,
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
      if (!response.ok) {
        const error = new Error(await response.text());
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
  const verified = () =>
    !!active?.verified &&
    !unavailable &&
    Date.now() - lastVerifiedAt < 10000 &&
    selected?.ownership === "single-context";
  const targetURL = (view, suffix = "") =>
    "/conversation/" +
    encodeURIComponent(view.snapshot.endpointId) +
    suffix +
    "?association=" +
    encodeURIComponent(view.snapshot.associationId);
  function dialogs() {
    if (!$("sessions").open) $("sessions").showModal();
    $("sessions-button").setAttribute("aria-expanded", "true");
  }
  function renderList() {
    const list = $("session-list");
    const focusedSession = doc.activeElement?.dataset?.sessionKey;
    const connected = discoveryError
      ? []
      : rows.filter(
          (row) =>
            row.integration === "connected" &&
            row.endpointId &&
            row.observation?.connected,
        );
    const summary =
      discoveryError ||
      (connected.length
        ? `${connected.length} connected ${connected.length === 1 ? "session" : "sessions"}`
        : "No connected sessions.");
    if ($("session-summary").textContent !== summary)
      $("session-summary").textContent = summary;
    list.replaceChildren();
    for (const row of connected) {
      const button = el(doc, "button", undefined, "session session-connected");
      button.dataset.sessionKey = row.endpointId;
      if (row.endpointId === selected?.endpointId)
        button.setAttribute("aria-current", "true");
      const badge = el(doc, "span", "Connected", "session-status");
      badge.dataset.state = "connected";
      const activity =
        {
          idle: "Idle",
          working: "Working",
          waiting: "Waiting for input",
          unknown: "Activity unknown",
        }[row.observation.snapshot.state.activity] ?? "Activity unknown";
      button.append(
        el(doc, "strong", row.label),
        badge,
        el(doc, "small", row.context),
        el(
          doc,
          "small",
          activity +
            (row.ownership === "single-context"
              ? ""
              : " · Read-only; controls unavailable"),
        ),
      );
      button.addEventListener("click", () => {
        choose(row);
        $("sessions").close();
        $("sessions-button").setAttribute("aria-expanded", "false");
        history.focus({ preventScroll: true });
      });
      list.append(button);
    }
    if (!connected.length && !discoveryError)
      list.append(
        el(
          doc,
          "p",
          "Load the RAI extension in the Pi session you want to use. If it is already loaded, check its socket path and terminal notices.",
          "empty-state",
        ),
      );
    if (focusedSession && $("sessions").open) {
      const restored = [...list.children].find(
        (n) => n.dataset.sessionKey === focusedSession,
      );
      (restored ?? $("sessions-close")).focus({ preventScroll: true });
    }
  }
  function choose(row) {
    for (const load of active?.loads.values() ?? []) load.controller?.abort();
    selected = row;
    $("latest").hidden = true;
    unavailable = !row.endpointId;
    notice = "";
    lastSignature = "";
    if (row.observation) {
      const snapshot = row.observation.snapshot,
        key = conversationKey(snapshot);
      if (
        active &&
        active.snapshot.endpointId === snapshot.endpointId &&
        active.key !== key
      )
        notice = "Conversation changed.";
      if (!views.has(key)) views.set(key, createView(snapshot, row.label));
      active = views.get(key);
      active.label = row.label;
      active.open = false;
      active.verified = false;
      active.rendered = false;
    } else active = null;
    renderFrame(true);
    renderList();
    listAt = 0;
  }
  function renderFooter() {
    $("composer").hidden = !active;
    $("draft").rows = active?.open ? 3 : 1;
    $("composer").dataset.expanded = String(!!active?.open);
    $("draft").readOnly = !active || !!active.pending;
    if ($("draft").value !== (active?.draft ?? ""))
      $("draft").value = active?.draft ?? "";
    $("send-button").disabled = !maySend(active, online && !!csrf, verified());
    $("send-button").textContent = active?.pending ? "Sending…" : "Send";
    $("stop-button").disabled = !mayStop(active, online && !!csrf, verified());
    $("draft-error").textContent =
      active?.draft && !active.pending ? messageError(active.draft) : "";
    const state = active?.snapshot.state;
    const limitation =
      state?.controlUnavailable ||
      (state?.manualCompaction
        ? "Send unavailable after manual compaction; terminal action or explicit reload is required."
        : state?.prompt
          ? "Waiting for terminal interaction; Send is unavailable while the dialog is open."
          : active && selected?.ownership !== "single-context"
            ? "Controls unavailable: this session's multiplexer context could not be verified."
            : "");
    const feedback = [
      limitation,
      active?.sendFeedback?.detail,
      active?.stopReceipt?.detail,
    ]
      .filter(Boolean)
      .join("\n");
    if ($("feedback").textContent !== feedback)
      $("feedback").textContent = feedback;
    $("records-button").setAttribute(
      "aria-pressed",
      String(!!active?.showRecords),
    );
    $("records-button").textContent = active?.showRecords
      ? "Hide session records"
      : "Show session records";
  }
  function renderFrame(force = false, preserve = false) {
    $("recipient").textContent =
      active?.label ?? selected?.label ?? "Choose a session";
    const s = active?.snapshot;
    $("activity").textContent = s
      ? (unavailable
          ? "Unavailable · "
          : !online || !active?.verified
            ? "Stale · "
            : "") +
        (s.state.activity === "idle"
          ? "Idle — not a task-completion verdict"
          : s.state.activity) +
        (s.state.pending ? " · queued input observed" : "") +
        " · " +
        new Date(s.observedAt).toLocaleTimeString()
      : "No connected session";
    const staleSource = active && !active.verified;
    $("connection").hidden = online && !unavailable && !staleSource;
    const connectionText = unavailable
      ? "Selected target unavailable. Choose a session explicitly; losing RAI does not stop Pi."
      : connection ||
        (staleSource
          ? "Refreshing or stale session observation; controls remain disabled until verified. Pi continues independently."
          : "Connecting…");
    if ($("connection").textContent !== connectionText)
      $("connection").textContent = connectionText;
    $("conversation-notice").hidden = !notice;
    if ($("conversation-notice").textContent !== notice)
      $("conversation-notice").textContent = notice;
    renderFooter();
    if (!active) {
      $("messages").replaceChildren();
      $("provisional").replaceChildren();
      $("older").hidden = true;
      $("history-health").textContent = selected
        ? "Integration unavailable; no terminal fallback."
        : "Choose a running Pi session to catch up.";
      return;
    }
    const view = active;
    const entries = view.entries.filter(
      (entry) => view.showRecords || isConversationRecord(view, entry),
    );
    $("history-health").textContent =
      view.historyError ||
      (!view.ready
        ? "Loading retained history…"
        : view.needsLatest
          ? "More than one page arrived. The old view is retained; Go to latest to resynchronize."
          : !entries.length &&
              !view.snapshot.turnOpen &&
              !view.snapshot.provisional?.message &&
              !view.snapshot.provisional?.tools?.length
            ? view.before
              ? "No conversation messages on this page. Load older messages or show session records in View."
              : "No messages yet. Write a message below."
            : "Retained history · " +
              (view.snapshot.turnOpen
                ? "current turn is provisional"
                : "completed boundary"));
    $("history-health").className = view.historyError ? "error" : "meta";
    $("older").hidden = !view.before || view.needsLatest;
    $("older").disabled = loadingOlder;
    const signature = JSON.stringify([
      view.key,
      view.entries.map((e) => e.id),
      view.snapshot.provisional,
      view.snapshot.liveUnavailable,
      view.needsLatest,
      view.showRecords,
    ]);
    if (!force && signature === lastSignature) return;
    const contentArrived = signature !== lastSignature;
    const follow =
      !preserve && (!view.rendered || atBottom()) && !view.needsLatest;
    const helpers = {
      changed: () => renderFrame(true, true),
      expand: (entry) => expandEntry(view, entry, true),
    };
    anchored(() => {
      $("messages").replaceChildren(
        ...entries.map((entry) => renderRecord(doc, view, entry, helpers)),
      );
      $("provisional").replaceChildren();
      if (view.snapshot.liveUnavailable)
        $("provisional").append(
          el(doc, "p", view.snapshot.liveUnavailable, "error"),
        );
      if (!view.needsLatest) {
        const provisional = view.snapshot.provisional;
        if (provisional?.message)
          $("provisional").append(
            renderRecord(
              doc,
              view,
              {
                id: "live-assistant",
                type: "message",
                role: "assistant",
                data: { type: "message", message: provisional.message },
              },
              helpers,
            ),
          );
        for (const tool of provisional?.tools ?? []) {
          const box = el(doc, "article");
          box.dataset.record = "live-tool:" + tool.toolCallId;
          box.dataset.role = "toolResult";
          box.className = "tool-record";
          box.append(
            el(
              doc,
              "h2",
              (tool.parentToolCallId ? "Nested tool" : "Tool") +
                " · " +
                tool.toolName,
            ),
          );
          if (tool.parentToolCallId)
            box.append(
              el(doc, "p", "Parent: " + tool.parentToolCallId, "meta"),
            );
          if (tool.isError) box.append(el(doc, "p", "Tool error", "error"));
          box.append(
            disclosure(
              doc,
              view,
              "tools",
              "result:" + tool.toolCallId,
              tool.type === "tool_execution_end" ? "Result" : "In progress",
              (body) => {
                const result = tool.result ?? tool.partialResult;
                if (result && typeof result === "object" && "content" in result)
                  blocks(
                    doc,
                    body,
                    result.content,
                    view,
                    "live:" + tool.toolCallId,
                    helpers,
                  );
                else if (result !== undefined && result !== null) {
                  body.append(
                    el(
                      doc,
                      "p",
                      "Unsupported tool result format; retained data follows.",
                      "meta",
                    ),
                  );
                  body.append(el(doc, "pre", JSON.stringify(result, null, 2)));
                } else
                  body.append(
                    el(doc, "pre", JSON.stringify(tool.args ?? {}, null, 2)),
                  );
              },
              helpers.changed,
            ),
          );
          $("provisional").append(box);
        }
      }
    }, follow);
    view.rendered = true;
    lastSignature = signature;
    if (!follow && !preserve && (contentArrived || view.needsLatest))
      $("latest").hidden = false;
    void expandBulk(view);
  }
  async function expandBulk(view) {
    if (view.autoExpanding) return;
    view.autoExpanding = true;
    try {
      while (active === view) {
        const entry = view.entries.find(
          (e) =>
            e.deferred &&
            !view.full.has(e.id) &&
            !view.loads.has(e.id) &&
            ((e.role === "toolResult" && view.tools.all) ||
              (e.role === "assistant" &&
                (view.thinking.all || view.tools.all))),
        );
        if (!entry) break;
        await expandEntry(view, entry);
      }
    } finally {
      view.autoExpanding = false;
    }
  }
  async function expandEntry(view, entry, openRequested = false) {
    if (view.loads.get(entry.id)?.controller) return;
    const controller = new AbortController();
    view.loads.set(entry.id, { controller, progress: 0 });
    renderFrame(true, true);
    try {
      let text = "",
        offset = 0;
      for (;;) {
        const chunk = await request(
          targetURL(view, "/entries/" + encodeURIComponent(entry.id)) +
            "&offset=" +
            offset,
          { signal: controller.signal },
        );
        text += chunk.data;
        if (chunk.done) break;
        if (!(chunk.next > offset)) throw Error("Invalid expansion progress");
        offset = chunk.next;
        view.loads.get(entry.id).progress = offset;
        if (active === view) renderFrame(true, true);
      }
      const raw = JSON.parse(text);
      if (raw.id !== entry.id) throw Error("Entry association changed");
      view.full.set(entry.id, raw);
      view.loads.delete(entry.id);
      if (openRequested && raw.message?.role === "toolResult")
        toggle(view, "tools", "result:" + raw.message.toolCallId, true);
    } catch (error) {
      view.loads.set(entry.id, {
        error: controller.signal.aborted
          ? "Expansion cancelled."
          : error.message,
      });
    }
    if (active === view) renderFrame(true, true);
  }
  async function post(req) {
    try {
      return resultFor(
        req,
        await request("/control", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-RAI-CSRF": csrf },
          body: JSON.stringify(req),
        }),
      );
    } catch (error) {
      if (error.status === 403) csrf = "";
      if ([400, 403, 404, 405, 409, 413, 415].includes(error.status))
        return { status: "rejected", detail: error.message };
      return {
        status: "outcome_unknown",
        detail: "Check the conversation or terminal before sending again.",
      };
    }
  }
  async function send() {
    const view = active;
    if (!maySend(view, online && !!csrf, verified())) return;
    const req = beginSend(view, requestId());
    view.stopReceipt = null;
    $("draft").blur();
    renderFooter();
    announce("Sending");
    const result = await post(req);
    finishSend(view, req.requestId, result);
    announce(
      view.label + ": " + (view.sendFeedback?.detail || "Request submitted"),
    );
    if (active === view) renderFooter();
  }
  async function stop() {
    const view = active;
    if (!mayStop(view, online && !!csrf, verified())) return;
    view.stopPending = true;
    view.stopReceipt = { detail: "Requesting stop…" };
    renderFooter();
    const result = await post({
      type: "control",
      version: 1,
      requestId: requestId(),
      operation: "stop",
      endpointId: view.snapshot.endpointId,
      associationId: view.snapshot.associationId,
    });
    view.stopPending = false;
    view.stopReceipt = {
      detail:
        result.status === "stop_requested"
          ? "Stop requested"
          : result.status === "rejected"
            ? "Stop not requested: " + result.detail
            : "Stop outcome unknown",
    };
    announce(view.label + ": " + view.stopReceipt.detail);
    if (active === view) renderFooter();
  }
  async function poll() {
    if (stopped || polling) return;
    polling = true;
    let refreshingList = false;
    try {
      if (!csrf) {
        refreshingList = true;
        const bootstrap = await request("/api/bootstrap");
        if (!/^[a-f0-9]{64}$/.test(bootstrap.csrf))
          throw Error("Invalid bootstrap");
        csrf = bootstrap.csrf;
      }
      if (Date.now() - listAt > 4000 || !online) {
        refreshingList = true;
        const list = await request("/sessions");
        rows = list.rows;
        discoveryError = "";
        listAt = Date.now();
        renderList();
        if (selected?.endpointId) {
          let row = rows.find((r) => r.endpointId === selected.endpointId);
          if (!row && active) {
            const candidates = rows.filter(
              (r) =>
                r.observation &&
                conversationKey(r.observation.snapshot) === active.key &&
                r.observation.snapshot.host.pid === active.snapshot.host.pid,
            );
            if (candidates.length === 1) row = candidates[0];
          }
          if (row) {
            if (
              active &&
              conversationKey(row.observation.snapshot) !== active.key
            )
              choose(row);
            else {
              selected = row;
              if (active) active.label = row.label;
            }
            unavailable = false;
          } else {
            unavailable = true;
            if (active) active.verified = false;
          }
        }
      }
      refreshingList = false;
      online = true;
      connection = "";
      if (active && selected?.endpointId && !unavailable) {
        const view = active;
        const result = await request(
          "/conversation/" +
            encodeURIComponent(selected.endpointId) +
            "?association=" +
            encodeURIComponent(view.snapshot.associationId),
        );
        if (active === view && ingest(view, result)) {
          view.verified = result.observation.connected;
          lastVerifiedAt = Date.now();
        }
      }
    } catch (error) {
      if (refreshingList) {
        discoveryError = "Could not load sessions. " + safeText(error.message);
        renderList();
      }
      if ([404, 409].includes(error.status)) {
        unavailable = true;
        listAt = 0;
        if (active) active.verified = false;
      } else {
        online = false;
        connection =
          "Connection unavailable. Retained content is stale; Pi continues independently. " +
          error.message;
      }
    }
    renderFrame();
    const health = online
      ? unavailable
        ? "Selected target unavailable"
        : "Connected"
      : "Connection unavailable";
    if (health !== lastAnnouncement && (!online || unavailable))
      announce(health);
    polling = false;
    if (!stopped) pollTimer = setTimeout(poll, 1000);
  }
  $("sessions-button").addEventListener("click", () => {
    dialogs();
    $("sessions-button").setAttribute("aria-expanded", "true");
  });
  $("sessions").addEventListener("close", () =>
    $("sessions-button").setAttribute("aria-expanded", "false"),
  );
  $("sessions-close").addEventListener("click", () => {
    $("sessions").close();
    $("sessions-button").setAttribute("aria-expanded", "false");
  });
  $("records-button").addEventListener("click", () => {
    if (!active) return;
    active.showRecords = !active.showRecords;
    renderFrame(true, true);
  });
  $("view-button").addEventListener("click", () => {
    $("view-menu").hidden = !$("view-menu").hidden;
    $("view-button").setAttribute(
      "aria-expanded",
      String(!$("view-menu").hidden),
    );
  });
  for (const button of doc.querySelectorAll("[data-bulk]"))
    button.addEventListener("click", async () => {
      if (!active) return;
      const view = active,
        [type, value] = button.dataset.bulk.split(":");
      bulk(view, type, value === "true");
      renderFrame(true, true);
      if (value === "true") await expandBulk(view);
    });
  $("draft").addEventListener("focus", () => {
    if (active) {
      active.open = true;
      renderFooter();
    }
  });
  $("draft").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active) {
      active.open = false;
      $("draft").blur();
      renderFooter();
    }
  });
  $("draft").addEventListener("input", () => {
    if (active && !active.pending) {
      active.draft = $("draft").value;
      renderFooter();
    }
  });
  $("send-button").addEventListener("click", send);
  $("stop-button").addEventListener("click", stop);
  $("older").addEventListener("click", async () => {
    const view = active;
    if (!view?.before || loadingOlder) return;
    loadingOlder = true;
    renderFrame();
    try {
      const page = await request(
        targetURL(view) + "&before=" + encodeURIComponent(view.before),
      );
      if (active === view && page.history) prepend(view, page.history);
      else if (page.historyError) view.historyError = page.historyError;
    } catch (error) {
      view.historyError = error.message;
    } finally {
      loadingOlder = false;
      if (active === view) renderFrame(true, true);
    }
  });
  $("latest").addEventListener("click", async () => {
    if (active?.needsLatest) {
      try {
        const view = active,
          result = await request(targetURL(view));
        if (active === view) ingest(view, result, true);
      } catch (error) {
        connection = error.message;
      }
    }
    lastSignature = "";
    if (active) active.rendered = false;
    renderFrame(true);
    history.scrollTop = history.scrollHeight;
    $("latest").hidden = true;
  });
  history.addEventListener(
    "scroll",
    () => {
      if (atBottom() && !active?.needsLatest) $("latest").hidden = true;
    },
    { passive: true },
  );
  globalThis.addEventListener?.("pagehide", () => {
    stopped = true;
    clearTimeout(pollTimer);
    for (const view of views.values())
      for (const load of view.loads.values()) load.controller?.abort();
  });
  globalThis.addEventListener?.("pageshow", (event) => {
    if (event.persisted) {
      stopped = false;
      clearTimeout(pollTimer);
      if (active) active.verified = false;
      listAt = 0;
      void poll();
    }
  });
  doc.addEventListener("visibilitychange", () => {
    if (active) active.verified = false;
    listAt = 0;
    renderFooter();
  });
  const resize = () =>
    doc.documentElement.style.setProperty(
      "--viewport-height",
      (globalThis.visualViewport?.height ?? globalThis.innerHeight) + "px",
    );
  globalThis.visualViewport?.addEventListener("resize", resize);
  resize();
  dialogs();
  await poll();
  return {
    views,
    select: choose,
    stopPolling: () => {
      stopped = true;
      clearTimeout(pollTimer);
    },
  };
}
if (typeof document !== "undefined" && document.getElementById("app"))
  void boot();
