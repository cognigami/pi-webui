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
  reconcileOutgoing,
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
function activityLabel(value) {
  return (
    {
      idle: "Idle",
      working: "Working",
      waiting: "Waiting for input",
      unknown: "Activity unknown",
    }[value] ?? "Activity unknown"
  );
}
function projectContext(row) {
  const cwd = safeText(
    row?.observation?.snapshot.host.cwd || row?.panes?.[0]?.cwd,
  );
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || cwd;
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
function disclosureButton(doc, view, type, key, title, changed) {
  const button = el(doc, "button", title);
  button.type = "button";
  button.dataset.focusKey = key;
  button.setAttribute("aria-expanded", String(expanded(view, type, key)));
  button.addEventListener("click", () => {
    toggle(view, type, key, !expanded(view, type, key));
    changed();
  });
  return button;
}
function disclosure(doc, view, type, key, title, body, changed) {
  const box = el(doc, "div", undefined, "disclosure"),
    content = el(doc, "div", undefined, "disclosure-body");
  content.hidden = !expanded(view, type, key);
  body(content);
  box.append(disclosureButton(doc, view, type, key, title, changed), content);
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
function recordArticle(doc, id, role, className) {
  const article = el(doc, "article", undefined, className);
  article.dataset.record = id;
  article.dataset.focusKey = "entry:" + id + ":record";
  article.tabIndex = -1;
  article.dataset.role = role;
  return article;
}
function responseError(message) {
  return (
    message.errorMessage ||
    (message.stopReason === "aborted"
      ? "Response aborted"
      : message.stopReason === "error"
        ? "Response error"
        : "")
  );
}
export function renderRecord(
  doc,
  view,
  entry,
  helpers,
  raw = view.full.get(entry.id) ?? entry.data,
) {
  const role = entry.role ?? raw?.message?.role;
  const primary = ["user", "assistant"].includes(role);
  const article = recordArticle(
    doc,
    entry.id,
    role || entry.type,
    primary
      ? "chat-message"
      : role === "toolResult"
        ? "tool-record"
        : "session-record",
  );
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
    // Keep the initiating keyboard control focusable while its guarded request
    // is in flight; a native disabled button cannot retain browser focus.
    button.setAttribute("aria-disabled", String(!!loading?.controller));
    button.dataset.focusKey = "entry:" + entry.id + ":load";
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
    const summary = el(doc, "summary", recordLabel(entry, raw));
    summary.dataset.focusKey = "entry:" + entry.id + ":summary";
    details.append(summary);
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
    const error = responseError(message);
    if (error) article.append(el(doc, "p", error, "error"));
    if (message.role === "toolResult") {
      article.append(
        disclosure(
          doc,
          view,
          "tools",
          "result:" + message.toolCallId,
          (message.isError ? "Error result" : "Tool result") +
            " · " +
            (message.toolName || "unknown"),
          (body) => {
            if (message.parentToolCallId)
              body.append(
                el(
                  doc,
                  "p",
                  "Nested under " + message.parentToolCallId,
                  "meta",
                ),
              );
            blocks(doc, body, message.content, view, entry.id, helpers);
          },
          helpers.changed,
        ),
      );
    } else blocks(doc, article, message.content, view, entry.id, helpers);
  }
  return article;
}

function renderTimelineTool(doc, view, item, helpers, outputOnly = false) {
  const { call, result, live, resultEntry, split } = item;
  const name = call?.name || result?.toolName || live?.toolName || "unknown";
  const id = call?.id || result?.toolCallId || live?.toolCallId;
  const key = id ? "result:" + id : item.key;
  const open = expanded(view, "tools", key);
  const pending =
    !result && (live ? live.type !== "tool_execution_end" : item.current);
  const error = resultEntry?.isError || result?.isError || live?.isError;
  const errorText = result && responseError(result);
  const parent = result?.parentToolCallId ?? live?.parentToolCallId;
  const record = resultEntry?.id ?? item.key;
  const article = recordArticle(
    doc,
    outputOnly ? record + ":output" : record,
    outputOnly ? "toolOutput" : "toolResult",
    "tool-record",
  );
  const outputId = split
    ? "tool-output:" + encodeURIComponent(record.toWellFormed())
    : "";
  const appendOutput = (body, label) => {
    const output = live?.result ?? live?.partialResult;
    if (!result && output == null) return;
    body.append(el(doc, "p", label, "meta"));
    if (result || (typeof output === "object" && "content" in output)) {
      blocks(
        doc,
        body,
        result ? result.content : output.content,
        view,
        item.key,
        helpers,
      );
    } else {
      body.append(
        el(
          doc,
          "p",
          "Unsupported tool result format; retained data follows.",
          "meta",
        ),
      );
      body.append(el(doc, "pre", JSON.stringify(output, null, 2)));
    }
  };
  const label = pending ? "Partial result" : "Result";
  if (outputOnly) {
    const body = el(doc, "div", undefined, "disclosure-body");
    body.hidden = !open;
    appendOutput(body, label + " · " + name);
    article.id = outputId;
    article.append(body);
  } else {
    const status = pending
      ? " · In progress"
      : call && !result && !live
        ? " · No retained result"
        : "";
    const box = disclosure(
      doc,
      view,
      "tools",
      key,
      (parent ? "Nested tool · " : "Tool · ") + name + status,
      (body) => {
        if (parent) body.append(el(doc, "p", "Nested under " + parent, "meta"));
        const args = call?.arguments ?? live?.args;
        if (args !== undefined) {
          body.append(el(doc, "p", "Arguments", "meta"));
          body.append(el(doc, "pre", JSON.stringify(args, null, 2)));
        }
        if (!split) appendOutput(body, label);
      },
      helpers.changed,
    );
    if (split) {
      box.lastElementChild.id = outputId + ":args";
      box.firstElementChild.setAttribute(
        "aria-controls",
        outputId + ":args " + outputId,
      );
    }
    article.append(box);
  }
  if (!split || outputOnly) {
    if (error) article.append(el(doc, "p", "Tool error", "error"));
    if (errorText) article.append(el(doc, "p", errorText, "error"));
  }
  article.hidden = !(
    open ||
    error ||
    errorText ||
    (!outputOnly && (expanded(view, "thinking", item.group.key) || pending))
  );
  return article;
}

// Work is a single control for ordered activity fragments. Fragments stay on
// their own side of any intervening visible prose, whether Work is open or not.
export function renderTimeline(doc, view, entries, helpers, options = {}) {
  if (view.showRecords && !options.live)
    return {
      nodes: entries.map((entry) => renderRecord(doc, view, entry, helpers)),
    };

  let group = {
    ...(options.continuation ?? {
      key: options.live ? "work:live" : "work:head",
    }),
  };
  let calls = new Map();
  const items = [];
  let lastRecord = -1;
  const recordItem = (fields) => {
    lastRecord = items.length;
    items.push({ kind: "record", ...fields });
  };
  const toolItem = (fields) =>
    items.push({ kind: "tool", group, index: items.length, ...fields });
  const completeTool = (tool, fields) => {
    Object.assign(tool, fields);
    // Keep one trigger without pulling output above intervening visible prose.
    if (tool.index < lastRecord) {
      tool.split = true;
      items.push({ kind: "output", group, tool });
    }
  };
  for (const entry of entries) {
    const raw = view.full.get(entry.id) ?? entry.data;
    const message = raw?.type === "message" ? raw.message : undefined;
    const role = entry.role ?? message?.role;
    if (role === "assistant" && Array.isArray(message?.content)) {
      const content = message.content;
      let firstProse = true;
      let start = 0;
      const prose = (end) => {
        if (
          start === end &&
          !(firstProse && (entry.isError || responseError(message)))
        )
          return;
        recordItem({
          entry: firstProse
            ? entry
            : { ...entry, id: entry.id + ":prose:" + start, isError: false },
          raw: {
            ...raw,
            message: {
              ...message,
              content: content.slice(start, end),
              ...(firstProse
                ? {}
                : { errorMessage: undefined, stopReason: undefined }),
            },
          },
        });
        firstProse = false;
      };
      for (const [i, part] of content.entries()) {
        if (!["thinking", "toolCall"].includes(part?.type)) continue;
        prose(i);
        const key = entry.id + ":work:" + i;
        if (part.type === "thinking") {
          items.push({ kind: "thinking", group, key, entry, part });
        } else {
          toolItem({ key, entry, call: part, current: !!options.live });
          if (typeof part.id === "string" && part.id)
            calls.set(part.id, calls.has(part.id) ? null : items.at(-1));
        }
        start = i + 1;
      }
      if (!content.length && !entry.isError && !responseError(message)) {
        recordItem({ entry, raw });
      } else prose(content.length);
    } else if (
      role === "toolResult" &&
      message?.role === "toolResult" &&
      message.toolCallId
    ) {
      const call = calls.get(message.toolCallId);
      if (call && !call.result)
        completeTool(call, { result: message, resultEntry: entry });
      else toolItem({ key: entry.id, result: message, resultEntry: entry });
    } else {
      recordItem({ entry, raw });
      if (role !== "assistant" && role !== "toolResult") {
        group = { key: "work:after:" + entry.id };
        calls = new Map();
      }
    }
  }
  for (const live of options.tools ?? []) {
    const call = calls.get(live.toolCallId);
    if (call && !call.live) {
      if (live.result != null || live.partialResult != null || live.isError)
        completeTool(call, { live });
      else call.live = live;
    } else toolItem({ key: "live-tool:" + live.toolCallId, live });
  }

  const nodes = [];
  for (const item of items) {
    if (item.kind === "record") {
      nodes.push(renderRecord(doc, view, item.entry, helpers, item.raw));
      continue;
    }
    const work = item.group;
    if (!work.hasWork) {
      const header = recordArticle(doc, work.key, "work", "tool-record");
      const trigger = el(doc, "div", undefined, "disclosure");
      trigger.append(
        disclosureButton(
          doc,
          view,
          "thinking",
          work.key,
          "Work · Thinking and tools",
          helpers.changed,
        ),
      );
      header.append(trigger);
      nodes.push(header);
      work.hasWork = true;
    }
    const article =
      item.kind === "tool"
        ? renderTimelineTool(doc, view, item, helpers)
        : item.kind === "output"
          ? renderTimelineTool(doc, view, item.tool, helpers, true)
          : recordArticle(doc, item.key, "thinking", "tool-record");
    if (item.kind === "thinking") {
      renderText(doc, article, item.part.thinking);
      article.hidden = !expanded(view, "thinking", work.key);
    }
    article.dataset.workKey = work.key;
    if (item.entry) article.dataset.workRecord = item.entry.id;
    nodes.push(article);
  }
  return { nodes, continuation: group };
}

// Recognise a hold, then open on release so it cannot select dialog text.
// Leave normal taps/scrolling alone; a completed hold consumes its click.
export function onLongPress(target, action) {
  let timer,
    start,
    armed = false,
    held = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    armed = false;
  };
  target.addEventListener("pointerdown", (event) => {
    cancel();
    held = false;
    if (event.button !== 0 || event.isPrimary === false) return;
    start = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      timer = undefined;
      armed = target.isConnected;
    }, 550);
  });
  target.addEventListener("pointermove", (event) => {
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
    )
      cancel();
  });
  target.addEventListener("pointerup", () => {
    const activate = armed && target.isConnected;
    cancel();
    if (!activate) return;
    held = true;
    action();
  });
  for (const type of ["pointercancel", "pointerleave"])
    target.addEventListener(type, cancel);
  target.addEventListener("contextmenu", (event) => event.preventDefault());
  target.addEventListener(
    "click",
    (event) => {
      if (!held || !(event.detail > 0)) return;
      held = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
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
    lastSignature = "",
    lastHistorySignature = "",
    retainedWork;
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
      if (button && button !== doc.activeElement)
        button.focus({ preventScroll: true });
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
  const mayRename = (row) =>
    !!(
      row?.observation?.connected &&
      row.ownership === "single-context" &&
      row.panes?.length === 1 &&
      row.panes[0].tabId
    );
  let renameTarget = null,
    renamePending = false,
    renameReturn = null;
  function openRename(row, origin) {
    if (!online || !csrf || !mayRename(row) || $("rename").open) return;
    renameTarget = {
      endpointId: row.endpointId,
      associationId: row.observation.snapshot.associationId,
      tabId: row.panes[0].tabId,
    };
    renameReturn = origin;
    $("rename-name").value = row.label;
    $("rename-error").textContent = "";
    $("rename").showModal();
    $("rename-name").focus();
    $("rename-name").select?.();
  }
  async function saveRename(event) {
    event.preventDefault();
    if (!renameTarget || renamePending) return;
    const name = $("rename-name").value;
    if (!name.trim()) {
      $("rename-error").textContent = "Enter a tab name.";
      return;
    }
    if (new TextEncoder().encode(name).length > 256) {
      $("rename-error").textContent = "Tab name exceeds 256 UTF-8 bytes.";
      return;
    }
    $("rename-error").textContent = "";
    renamePending = true;
    $("rename-save").disabled = true;
    $("rename-cancel").disabled = true;
    $("rename-name").readOnly = true;
    $("rename-save").textContent = "Saving…";
    try {
      await request("/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-RAI-CSRF": csrf },
        body: JSON.stringify({ ...renameTarget, name }),
      });
      // Names remain multiplexer-owned: refresh discovery, don't invent an alias.
      listAt = 0;
      $("rename").close();
      announce("Tab renamed");
    } catch (error) {
      $("rename-error").textContent = error.status
        ? error.message
        : "Rename outcome unknown. Check the terminal before trying again.";
    } finally {
      renamePending = false;
      $("rename-save").disabled = false;
      $("rename-cancel").disabled = false;
      $("rename-name").readOnly = false;
      $("rename-save").textContent = "Save";
    }
  }
  let sessionListSignature = "";
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
    const signature = JSON.stringify([
      discoveryError,
      selected?.endpointId,
      connected.map((row) => [
        row.endpointId,
        row.label,
        projectContext(row),
        row.ownership,
        row.observation.snapshot.associationId,
        row.observation.snapshot.session.id,
        row.observation.snapshot.session.name,
        row.observation.snapshot.state.activity,
        row.panes,
      ]),
    ]);
    // Unchanged discovery must not detach a button during a hold.
    if (signature === sessionListSignature) return;
    sessionListSignature = signature;
    list.replaceChildren();
    for (const row of connected) {
      const button = el(doc, "button", undefined, "session session-connected");
      button.dataset.sessionKey = row.endpointId;
      if (row.endpointId === selected?.endpointId)
        button.setAttribute("aria-current", "true");
      const badge = el(doc, "span", "Connected", "session-status");
      badge.dataset.state = "connected";
      const activity = activityLabel(row.observation.snapshot.state.activity);
      button.append(
        el(doc, "strong", row.label),
        badge,
        el(doc, "small", projectContext(row)),
        el(
          doc,
          "small",
          activity +
            (row.ownership === "single-context"
              ? ""
              : " · Read-only; controls unavailable"),
        ),
      );
      if (mayRename(row)) {
        button.title = "Hold to rename tab; F2 to rename with keyboard";
        button.classList.add("rename-target");
        onLongPress(button, () => openRename(row, button));
        button.addEventListener("keydown", (event) => {
          if (event.key === "F2") {
            event.preventDefault();
            openRename(row, button);
          }
        });
      }
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
    lastHistorySignature = "";
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
  let outgoingSignature = "";
  function renderOutgoing() {
    const items = active?.outgoing ?? [];
    const signature = JSON.stringify([active?.key, items]);
    if (signature === outgoingSignature) return;
    outgoingSignature = signature;
    const follow = atBottom();
    anchored(() => {
      $("outgoing").replaceChildren(
        ...items.map((item) => {
          const article = el(doc, "article", undefined, "chat-message");
          article.dataset.role = "user";
          article.dataset.record = "outgoing:" + item.id;
          article.append(el(doc, "h2", "You"));
          renderText(doc, article, item.text);
          const labels = {
            sending: "Sending…",
            submitted_unconfirmed: "Submitted · waiting to appear in Pi",
            outcome_unknown:
              "Delivery uncertain · check Pi before sending again",
            rejected: "Not sent · text kept in the editor",
          };
          article.append(
            el(
              doc,
              "p",
              labels[item.status],
              item.status === "rejected" || item.status === "outcome_unknown"
                ? "error"
                : "meta",
            ),
          );
          if (item.status !== "sending") {
            const dismiss = el(doc, "button", "Dismiss local copy");
            dismiss.type = "button";
            dismiss.addEventListener("click", () => {
              active.outgoing = active.outgoing.filter(
                (other) => other.id !== item.id,
              );
              renderFooter();
            });
            article.append(dismiss);
          }
          return article;
        }),
      );
    }, follow);
  }
  function renderFooter() {
    renderOutgoing();
    $("composer").hidden = !active;
    $("draft").rows = active?.open ? 3 : 1;
    $("composer").dataset.expanded = String(!!active?.open);
    $("draft").readOnly = !active || !!active.pending;
    if ($("draft").value !== (active?.draft ?? ""))
      $("draft").value = active?.draft ?? "";
    $("send-button").disabled = !maySend(active, online && !!csrf, verified());
    $("send-button").textContent = active?.pending ? "Sending…" : "Send";
    $("stop-button").disabled = !mayStop(active, online && !!csrf, verified());
    $("stop-button").textContent = active?.stopPending ? "Stopping…" : "Stop";
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
    $("recipient").textContent = safeText(
      active?.label ?? selected?.label ?? "Choose a session",
    );
    const canRename = online && !!csrf && mayRename(selected) && !unavailable;
    $("rename-button").disabled = !canRename;
    $("recipient").classList.toggle("rename-target", canRename);
    $("recipient").title = canRename ? "Hold to rename tab" : "";
    const context = [
      projectContext(selected),
      safeText(
        active?.snapshot?.session?.name ??
          selected?.observation?.snapshot?.session?.name,
      ).trim(),
    ]
      .filter(Boolean)
      .join(" · ");
    if ($("recipient-context").textContent !== context)
      $("recipient-context").textContent = context;
    $("recipient-context").hidden = !context;
    const s = active?.snapshot;
    $("activity").textContent = s
      ? (unavailable
          ? "Unavailable · "
          : !online || !active?.verified
            ? "Stale · "
            : "") +
        activityLabel(s.state.activity) +
        (s.state.pending ? " · input queued" : "")
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
      $("history-health").hidden = false;
      lastHistorySignature = "";
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
              !view.outgoing.length &&
              !view.snapshot.turnOpen &&
              !view.snapshot.provisional?.message &&
              !view.snapshot.provisional?.tools?.length
            ? view.before
              ? "No conversation messages on this page. Load older messages or show session records in View."
              : "No messages yet. Write a message below."
            : "");
    $("history-health").hidden = !$("history-health").textContent;
    $("history-health").className = view.historyError ? "error" : "meta";
    $("older").hidden = !view.before || view.needsLatest;
    $("older").disabled = loadingOlder;
    const historySignature = JSON.stringify([
      view.key,
      entries.map((entry) => entry.id),
      view.showRecords,
    ]);
    const continuesRetained =
      view.ready &&
      !view.historyError &&
      !!s.session.cutoff &&
      s.session.cutoff === view.entries.at(-1)?.id;
    const signature = JSON.stringify([
      historySignature,
      view.snapshot.provisional,
      view.snapshot.liveUnavailable,
      view.needsLatest,
      continuesRetained,
    ]);
    if (!force && signature === lastSignature) return;
    const contentArrived = signature !== lastSignature;
    const follow =
      !preserve && (!view.rendered || atBottom()) && !view.needsLatest;
    const helpers = {
      changed: () => renderFrame(true, true),
      expand: (entry) => expandEntry(view, entry, true),
    };
    const focusedPart = doc.activeElement?.closest("[data-work-key]");
    const focusKey = doc.activeElement?.dataset.focusKey;
    anchored(() => {
      // Persisted entries are immutable. Token-only updates must not destroy
      // their DOM nodes, keyboard focus or the reader's text selection.
      if (force || historySignature !== lastHistorySignature) {
        const { nodes, continuation } = renderTimeline(
          doc,
          view,
          entries,
          helpers,
        );
        $("messages").replaceChildren(...nodes);
        retainedWork = continuation;
        lastHistorySignature = historySignature;
      }
      const live = [];
      if (view.snapshot.liveUnavailable)
        live.push(el(doc, "p", view.snapshot.liveUnavailable, "error"));
      if (!view.needsLatest) {
        const provisional = view.snapshot.provisional;
        const liveEntries = provisional?.message
          ? [
              {
                id: "live-assistant",
                type: "message",
                role: "assistant",
                data: { type: "message", message: provisional.message },
              },
            ]
          : [];
        live.push(
          ...renderTimeline(doc, view, liveEntries, helpers, {
            live: true,
            tools: provisional?.tools,
            // Share only the display control, never match live tools to retained calls.
            continuation: continuesRetained ? retainedWork : undefined,
          }).nodes,
        );
      }
      $("provisional").replaceChildren(...live);
    }, follow);
    if (focusedPart && focusKey) {
      // A pending tool can finish and disappear into collapsed Work while its
      // trigger has focus. In that case keep focus on the shared Work control.
      const visible = [...history.querySelectorAll("[data-focus-key]")].filter(
        (node) => !node.closest("[hidden]"),
      );
      if (!visible.some((node) => node.dataset.focusKey === focusKey))
        visible
          .find((node) => node.dataset.focusKey === focusedPart.dataset.workKey)
          ?.focus({ preventScroll: true });
    }
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
      reconcileOutgoing(view);
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
    if (active === view) {
      const loaderOwnsFocus =
        doc.activeElement?.dataset.focusKey === "entry:" + entry.id + ":load";
      renderFrame(true, true);
      if (loaderOwnsFocus && view.full.has(entry.id)) {
        const records = [
          ...$("messages").querySelectorAll("article[data-record]"),
        ];
        const record = records.find((node) => node.dataset.record === entry.id);
        const workKey = records.find(
          (node) => node.dataset.workRecord === entry.id,
        )?.dataset.workKey;
        const work = records.find((node) => node.dataset.record === workKey);
        const visible = record && !record.hidden ? record : work;
        const target = visible?.querySelector("[data-focus-key]") ?? visible;
        target?.focus({ preventScroll: true });
      }
    }
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
    renderFrame();
    announce("Sending");
    const result = await post(req);
    finishSend(view, req.requestId, result);
    announce(
      view.label + ": " + (view.sendFeedback?.detail || "Request submitted"),
    );
    if (active === view) renderFrame();
  }
  async function stop() {
    const view = active;
    if (!mayStop(view, online && !!csrf, verified())) return;
    view.stopPending = true;
    view.stopReceipt = null;
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
    view.stopReceipt =
      result.status === "stop_requested"
        ? null
        : {
            detail:
              result.status === "rejected"
                ? "Stop not requested: " + result.detail
                : "Stop outcome unknown",
          };
    announce(
      view.label + ": " + (view.stopReceipt?.detail || "Stop requested"),
    );
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
  onLongPress($("recipient"), () => openRename(selected, $("view-button")));
  $("rename-button").addEventListener("click", () =>
    openRename(selected, $("rename-button")),
  );
  $("rename-form").addEventListener("submit", saveRename);
  $("rename-cancel").addEventListener("click", () => $("rename").close());
  $("rename").addEventListener("cancel", (event) => {
    if (renamePending) event.preventDefault();
  });
  $("rename").addEventListener("close", () => {
    renameTarget = null;
    const replacement = [...$("session-list").children].find(
      (node) => node.dataset.sessionKey === renameReturn?.dataset.sessionKey,
    );
    const origin = renameReturn?.isConnected ? renameReturn : replacement;
    (
      origin ?? ($("sessions").open ? $("sessions-close") : $("view-button"))
    ).focus({ preventScroll: true });
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
  $("draft").addEventListener("blur", () => {
    if (active) {
      active.open = false;
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
