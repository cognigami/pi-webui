export function conversationKey(snapshot) {
  return JSON.stringify([snapshot.session.id, snapshot.associationId]);
}
export function createView(snapshot, label) {
  return {
    key: conversationKey(snapshot),
    snapshot,
    label,
    entries: [],
    before: "",
    historyError: "",
    ready: false,
    draft: "",
    open: false,
    pending: null,
    outgoing: [],
    matchedOutgoing: new Set(),
    sendFeedback: null,
    unconfirmedSend: false,
    showRecords: false,
    recordOpen: new Set(),
    stopPending: false,
    stopReceipt: null,
    tools: { all: false, overrides: new Map() },
    thinking: { all: false, overrides: new Map() },
    needsLatest: false,
    full: new Map(),
    loads: new Map(),
    signature: "",
  };
}
export function ingest(view, payload, reset = false) {
  const s = payload.observation.snapshot;
  if (conversationKey(s) !== view.key) return false;
  if (s.endpointId === view.snapshot.endpointId && s.seq < view.snapshot.seq)
    return false;
  view.snapshot = s;
  view.historyError = payload.historyError ?? "";
  const page = payload.history;
  if (page) {
    if (reset || !view.ready || !view.entries.length) {
      view.entries = page.entries;
      view.before = page.before;
      view.needsLatest = false;
    } else {
      const known = new Set(view.entries.map((e) => e.id));
      const overlap = page.entries.some((e) => known.has(e.id));
      const linked = page.entries.length && known.has(page.entries[0].parentId);
      if (
        page.entries.length &&
        !overlap &&
        !linked &&
        s.session.cutoff !== view.entries.at(-1)?.id
      ) {
        view.needsLatest = true; // Keep an older reader anchored; don't conceal a missing page.
      } else if (!view.needsLatest) {
        view.entries.push(...page.entries.filter((e) => !known.has(e.id)));
      }
    }
    view.ready = true;
    reconcileOutgoing(view);
  }
  return true;
}
export function prepend(view, page) {
  const known = new Set(view.entries.map((e) => e.id));
  view.entries = [
    ...page.entries.filter((e) => !known.has(e.id)),
    ...view.entries,
  ];
  view.before = page.before;
  reconcileOutgoing(view);
}
// This only removes a local duplicate when matching retained content appears.
// It is not a delivery receipt or evidence linking a Pi message to a request.
export function reconcileOutgoing(view) {
  if (view.needsLatest) return;
  view.outgoing = view.outgoing.filter((item) => {
    if (item.status === "sending" || item.status === "rejected") return true;
    const cutoff =
      item.afterId == null
        ? -1
        : view.entries.findIndex((entry) => entry.id === item.afterId);
    if (item.afterId != null && cutoff < 0) return true;
    const candidates = [];
    let parentId = item.afterId ?? null;
    for (const entry of view.entries.slice(cutoff + 1)) {
      if ((entry.parentId ?? null) !== parentId) break;
      candidates.push(entry);
      parentId = entry.id;
    }
    const match = candidates.find((entry) => {
      if (view.matchedOutgoing.has(entry.id)) return false;
      const message = (view.full.get(entry.id) ?? entry.data)?.message;
      if (message?.role !== "user") return false;
      const content = message.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content) &&
              content.every((part) => part.type === "text")
            ? content.map((part) => part.text).join("")
            : null;
      return text === item.text;
    });
    if (!match) return true;
    view.matchedOutgoing.add(match.id);
    return false;
  });
}
export function expanded(view, type, key) {
  const prefs = view[type];
  return prefs.overrides.has(key) ? prefs.overrides.get(key) : prefs.all;
}
export function toggle(view, type, key, value) {
  view[type].overrides.set(key, value);
}
export function bulk(view, type, value) {
  view[type].all = value;
  view[type].overrides.clear();
}
export function messageError(text) {
  if (!text.trim()) return "Enter a message.";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        return "Message contains invalid Unicode.";
    } else if (c >= 0xdc00 && c <= 0xdfff)
      return "Message contains invalid Unicode.";
  }
  if (new TextEncoder().encode(text).length > 128 * 1024)
    return "Message exceeds 128 KiB.";
  return "";
}
export function maySend(view, online, verified) {
  return (
    !!view &&
    online &&
    verified &&
    !view.pending &&
    view.snapshot.state.sendSupported &&
    !view.snapshot.state.controlUnavailable &&
    !messageError(view.draft)
  );
}
export function mayStop(view, online, verified) {
  if (
    !view ||
    !online ||
    !verified ||
    view.stopPending ||
    view.snapshot.state.controlUnavailable
  )
    return false;
  return (
    !!view.pending ||
    view.unconfirmedSend ||
    view.snapshot.state.activity !== "idle" ||
    view.snapshot.state.pending
  );
}
export function resultFor(request, result) {
  const allowed =
    request.operation === "send"
      ? ["submitted_unconfirmed", "rejected", "outcome_unknown"]
      : ["stop_requested", "rejected", "outcome_unknown"];
  if (
    result?.type !== "result" ||
    result.version !== 1 ||
    result.requestId !== request.requestId ||
    !allowed.includes(result.status)
  )
    return {
      status: "outcome_unknown",
      detail:
        "Invalid or unrelated dispatch response; check Pi before sending again.",
    };
  return result;
}
export function beginSend(view, id) {
  if (view.pending) throw Error("A submission is already outstanding.");
  if (messageError(view.draft)) throw Error(messageError(view.draft));
  const request = {
    type: "control",
    version: 1,
    requestId: id,
    operation: "send",
    endpointId: view.snapshot.endpointId,
    associationId: view.snapshot.associationId,
    text: view.draft,
  };
  view.sendFeedback = null;
  view.outgoing.push({
    id,
    text: request.text,
    afterId: view.snapshot.session.cutoff,
    status: "sending",
  });
  view.pending = request;
  view.open = false;
  return request;
}
export function finishSend(view, id, result) {
  if (view.pending?.requestId !== id) return;
  const status = [
    "submitted_unconfirmed",
    "rejected",
    "outcome_unknown",
  ].includes(result.status)
    ? result.status
    : "outcome_unknown";
  const outgoing = view.outgoing.find((item) => item.id === id);
  if (outgoing) outgoing.status = status;
  reconcileOutgoing(view);
  view.sendFeedback =
    status === "submitted_unconfirmed"
      ? null
      : {
          status,
          detail:
            status === "rejected"
              ? "Not sent: " + result.detail
              : "Delivery unconfirmed. Check the conversation before sending again.",
        };
  // A later rejected request does not settle an earlier unconfirmed dispatch.
  if (status !== "rejected") view.unconfirmedSend = true;
  if (status === "submitted_unconfirmed") view.draft = "";
  view.pending = null;
}
