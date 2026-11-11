import {
  beginSend,
  bulk,
  conversationKey,
  createView,
  dismiss,
  expanded,
  finishSend,
  ingest,
  maySend,
  mayStop,
  messageError,
  prepend,
  resultFor,
  reuse,
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
export function renderRecord(doc, view, entry, helpers) {
  const article = el(doc, "article");
  article.dataset.record = entry.id;
  article.dataset.role = entry.role || entry.type;
  const raw = view.full.get(entry.id) ?? entry.data;
  const label =
    entry.role === "toolResult"
      ? "Tool · " + (entry.toolName || "unknown")
      : entry.role || entry.type;
  article.append(el(doc, "h2", label));
  if (entry.isError)
    article.append(
      el(
        doc,
        "p",
        entry.role === "toolResult" ? "Tool error" : "Response error",
        "error",
      ),
    );
  if (entry.deferred && !raw) {
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
    } else if (message.role === "system") {
      const details = el(doc, "details");
      details.append(
        el(doc, "summary", "System context updated"),
        el(doc, "pre", JSON.stringify(message, null, 2)),
      );
      article.append(details);
    } else if (["user", "assistant"].includes(message.role))
      blocks(doc, article, message.content, view, entry.id, helpers);
    else {
      article.append(
        el(doc, "p", "Unsupported message role: " + message.role, "meta"),
      );
      article.append(el(doc, "pre", JSON.stringify(message, null, 2)));
    }
  } else if (raw.type === "compaction" || raw.type === "branch_summary") {
    article.append(
      el(
        doc,
        "p",
        raw.type === "compaction"
          ? "Compaction boundary · retained originals remain above."
          : "Branch summary · only selected ancestry is shown.",
        "meta",
      ),
    );
    renderText(doc, article, raw.summary);
  } else if (raw.type === "context_edit")
    article.append(
      el(
        doc,
        "p",
        "Model context edited for " +
          raw.targetId +
          "; the retained original is unchanged.",
        "meta",
      ),
    );
  else if (raw.type === "custom_message") {
    article.append(
      el(doc, "p", "Extension message · " + raw.customType, "meta"),
    );
    blocks(doc, article, raw.content, view, entry.id, helpers);
  } else {
    const details = el(doc, "details");
    details.append(
      el(doc, "summary", "Entry metadata · " + raw.type),
      el(doc, "pre", JSON.stringify(raw, null, 2)),
    );
    article.append(details);
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
    discovery = "",
    discoveryIncomplete = false,
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
    $("discovery-health").textContent = discoveryError
      ? discoveryError + "\n" + discovery
      : discovery;
    const list = $("session-list");
    const focusedSession = doc.activeElement?.dataset?.sessionKey;
    const othersOpen =
      list.querySelector(".unavailable-sessions")?.open ?? false;
    const summaryFocused = doc.activeElement?.matches(
      ".unavailable-sessions > summary",
    );
    const integrated = rows.filter((row) => row.integration === "connected");
    const connected = integrated.filter((row) => row.observation?.connected);
    const disconnected = integrated.filter(
      (row) => !row.observation?.connected,
    );
    const others = rows.filter((row) => row.integration !== "connected");
    const summary =
      discoveryError ||
      (connected.length
        ? `${connected.length} connected ${connected.length === 1 ? "session" : "sessions"}. Choose one to read or send a message.`
        : "No sessions connected to RAI yet.") +
        (discoveryIncomplete
          ? " Discovery incomplete; see details below."
          : "");
    if ($("session-summary").textContent !== summary)
      $("session-summary").textContent = summary;
    list.replaceChildren();
    function group(title, items, parent, state) {
      if (!items.length) return;
      const section = el(doc, "section", undefined, "session-section");
      section.append(el(doc, "h3", title));
      for (const row of items) {
        const button = el(
          doc,
          "button",
          undefined,
          "session " +
            (state === "unavailable"
              ? "session-unavailable"
              : "session-connected"),
        );
        button.dataset.sessionKey =
          row.endpointId ??
          JSON.stringify(row.panes?.map((p) => [p.backend, p.scope, p.id]));
        if (row.endpointId && row.endpointId === selected?.endpointId)
          button.setAttribute("aria-current", "true");
        const badge = el(
          doc,
          "span",
          discoveryError && state !== "unavailable"
            ? "Connection unverified"
            : state === "connected"
              ? "Connected"
              : state === "disconnected"
                ? "Connection lost"
                : "Not connected",
          "session-status",
        );
        badge.dataset.state =
          discoveryError && state !== "unavailable" ? "disconnected" : state;
        button.append(
          el(doc, "strong", row.label),
          badge,
          el(doc, "small", row.context),
        );
        if (state !== "unavailable") {
          const activity =
            {
              idle: "Idle",
              working: "Working",
              waiting: "Waiting for input",
              unknown: "Activity unknown",
            }[row.observation?.snapshot.state.activity] ?? "Activity unknown";
          button.append(
            el(
              doc,
              "small",
              (discoveryError ? "Last observed: " : "") +
                activity +
                (row.ownership === "single-context"
                  ? ""
                  : " · Multiplexer ownership unresolved"),
            ),
          );
        }
        button.addEventListener("click", () => {
          choose(row);
          $("sessions").close();
          $("sessions-button").setAttribute("aria-expanded", "false");
          history.focus({ preventScroll: true });
        });
        section.append(button);
      }
      parent.append(section);
    }
    group(
      discoveryError ? "Last known connections" : "Connected",
      connected,
      list,
      "connected",
    );
    group("Reconnecting", disconnected, list, "disconnected");
    if (!integrated.length && !discoveryError)
      list.append(
        el(
          doc,
          "p",
          "Keep RAI running, then load the RAI extension in the Pi session you want. If it is already loaded, check its socket path and terminal notices.",
          "empty-state",
        ),
      );
    if (others.length) {
      const other = el(doc, "details", undefined, "unavailable-sessions");
      other.open = othersOpen;
      other.append(
        el(
          doc,
          "summary",
          `Other Pi sessions (${others.length}) · not connected`,
        ),
      );
      other.append(
        el(
          doc,
          "p",
          "Discovered Pi processes without an active RAI connection. They are separate from the connected sessions above.",
          "context",
        ),
      );
      group("Other sessions", others, other, "unavailable");
      list.append(other);
    }
    if (focusedSession && $("sessions").open) {
      const restored = [...list.querySelectorAll("[data-session-key]")].find(
        (n) => n.dataset.sessionKey === focusedSession,
      );
      const hidden = restored?.closest("details");
      (restored && (!hidden || hidden.open)
        ? restored
        : $("sessions-close")
      ).focus({ preventScroll: true });
    } else if (summaryFocused && $("sessions").open)
      list
        .querySelector(".unavailable-sessions > summary")
        ?.focus({ preventScroll: true });
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
        notice =
          "Conversation changed. Earlier drafts and receipts are retained under their original conversation; review before reuse.";
      if (!views.has(key)) views.set(key, createView(snapshot, row.label));
      active = views.get(key);
      active.label = row.label;
      active.open = false;
      active.verified = false;
      active.rendered = false;
    } else active = null;
    $("draft-actions").open = false;
    renderFrame(true);
    renderList();
    listAt = 0;
  }
  function renderFooter() {
    $("composer").hidden = !active;
    $("draft").rows = active?.open ? 3 : 1;
    $("composer").dataset.expanded = String(!!active?.open);
    $("draft-actions").hidden =
      !active || !!active.pending || active.needsReview;
    if ($("draft-actions").hidden) $("draft-actions").open = false;
    $("draft").readOnly = !active || !!active.pending || active.needsReview;
    if ($("draft").value !== (active?.draft ?? ""))
      $("draft").value = active?.draft ?? "";
    $("clear-button").disabled =
      !active?.draft || !!active.pending || active.needsReview;
    $("close-button").disabled = !active?.open || !!active.pending;
    $("send-button").disabled = !maySend(active, online && !!csrf, verified());
    $("stop-button").disabled = !mayStop(active, online && !!csrf, verified());
    $("draft-error").textContent =
      active?.draft && !active.pending ? messageError(active.draft) : "";
    const receipt = active?.receipts.at(-1);
    const state = active?.snapshot.state;
    const limitation =
      state?.controlUnavailable ||
      (state?.manualCompaction
        ? "Send unavailable after manual compaction; terminal action or explicit reload is required."
        : state?.prompt
          ? "Waiting for terminal interaction; Send is unavailable while the dialog is open."
          : active && selected?.ownership !== "single-context"
            ? "Controls unavailable: multiplexer ownership is unresolved. See Details."
            : "");
    const feedback = [
      limitation,
      receipt?.detail,
      active?.stopReceipt?.detail,
      active?.needsReview ? "Review the previous submission before reuse." : "",
    ]
      .filter(Boolean)
      .join("\n");
    if ($("feedback").textContent !== feedback)
      $("feedback").textContent = feedback;
    $("review-button").hidden = ![...views.values()].some(
      (v) => v.receipts.length || v.draft,
    );
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
    $("details").textContent = s
      ? JSON.stringify(
          {
            host: s.host,
            session: s.session,
            panes: selected?.panes,
            observedAt: s.observedAt,
            liveGap: s.gap,
          },
          null,
          2,
        )
      : "No direct integration available.";
    $("details").style.whiteSpace = "pre-wrap";
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
    $("history-health").textContent =
      view.historyError ||
      (!view.ready
        ? "Loading retained history…"
        : view.needsLatest
          ? "More than one page arrived. The old view is retained; Go to latest to resynchronize."
          : !view.entries.length &&
              !view.snapshot.turnOpen &&
              !view.snapshot.provisional?.message &&
              !view.snapshot.provisional?.tools?.length
            ? "No messages yet. Write a message below."
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
        ...view.entries.map((entry) => renderRecord(doc, view, entry, helpers)),
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
  function review() {
    const recipient = active;
    $("review-content").replaceChildren();
    for (const view of views.values()) {
      const items = [...view.receipts];
      if (view.draft && !items.some((r) => r.text === view.draft))
        items.push({ text: view.draft, detail: "Unsent draft", id: "draft" });
      for (const receipt of items) {
        const box = el(doc, "section", undefined, "receipt");
        box.append(
          el(doc, "h3", view.label),
          el(doc, "p", receipt.detail),
          el(doc, "pre", receipt.text),
        );
        const use = el(
          doc,
          "button",
          view === recipient
            ? "Use as draft"
            : "Use in " + (recipient?.label ?? "selected conversation"),
        );
        use.disabled =
          !active || !!active.pending || receipt.status === "sending";
        use.addEventListener("click", () => {
          if (!recipient || active !== recipient) {
            announce(
              "Conversation changed; reopen review before reusing a draft.",
            );
            $("review").close();
            return;
          }
          reuse(recipient, receipt);
          $("review").close();
          renderFooter();
          $("draft").focus();
        });
        box.append(use);
        if (receipt.id !== "draft") {
          const close = el(doc, "button", "Dismiss notice");
          close.disabled = receipt.status === "sending";
          close.addEventListener("click", () => {
            dismiss(view, receipt.id);
            review();
            renderFooter();
          });
          box.append(close);
        }
        $("review-content").append(box);
      }
    }
    if (!$("review").open) $("review").showModal();
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
      view.label +
        ": " +
        view.receipts.find((r) => r.id === req.requestId)?.detail,
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
        const failures = Object.entries(list.failures ?? {}).map(
          ([backend, error]) => backend + ": " + error,
        );
        discoveryIncomplete = failures.length > 0;
        discovery =
          (failures.length
            ? "Partially available · " + failures.join(" · ")
            : rows.length
              ? "Choose a session"
              : "No Pi candidates found in available discovery coverage") +
          "\n" +
          (list.coverage ?? []).join(" ");
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
        discoveryError =
          "Could not refresh the session list. " +
          (rows.length
            ? "Showing last known sessions; connections are unverified. "
            : "Check that RAI is running. ") +
          safeText(error.message);
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
  $("review-close").addEventListener("click", () => $("review").close());
  $("review-button").addEventListener("click", review);
  for (const [button, section] of [
    ["view-button", "view-menu"],
    ["details-button", "details"],
  ])
    $(button).addEventListener("click", () => {
      $(section).hidden = !$(section).hidden;
      $(button).setAttribute("aria-expanded", String(!$(section).hidden));
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
      $("draft-actions").open = false;
      $("draft").blur();
      renderFooter();
    }
  });
  $("draft").addEventListener("input", () => {
    if (active && !active.pending && !active.needsReview) {
      active.draft = $("draft").value;
      renderFooter();
    }
  });
  $("clear-button").addEventListener("click", () => {
    if (active && !active.pending) {
      active.draft = "";
      $("draft-actions").open = false;
      renderFooter();
      $("draft").focus();
    }
  });
  $("close-button").addEventListener("click", () => {
    if (active) {
      active.open = false;
      $("draft-actions").open = false;
      $("draft").blur();
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
