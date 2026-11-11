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
    receipts: [],
    needsReview: false,
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
    !view.needsReview &&
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
    view.receipts.some(
      (r) =>
        r.status === "submitted_unconfirmed" || r.status === "outcome_unknown",
    ) ||
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
  view.receipts.push({
    id,
    text: view.draft,
    target: { ...request, text: undefined },
    status: "sending",
    detail: "Sending",
  });
  view.pending = id;
  view.open = false;
  return request;
}
export function finishSend(view, id, result) {
  const receipt = view.receipts.find((r) => r.id === id);
  if (!receipt) return;
  receipt.status = [
    "submitted_unconfirmed",
    "rejected",
    "outcome_unknown",
  ].includes(result.status)
    ? result.status
    : "outcome_unknown";
  receipt.detail =
    receipt.status === "submitted_unconfirmed"
      ? "Submitted; acceptance unconfirmed"
      : receipt.status === "rejected"
        ? "Not sent: " + result.detail
        : "Outcome unknown. Check the conversation or terminal before sending again.";
  if (view.pending === id) {
    view.pending = null;
    if (receipt.status === "submitted_unconfirmed") {
      view.draft = "";
      view.needsReview = false;
    } else {
      view.draft = receipt.text;
      view.needsReview = true;
    }
  }
}
export function reuse(view, receipt) {
  if (view.pending) return false;
  view.draft = receipt.text;
  view.needsReview = false;
  view.open = true;
  return true;
}
export function dismiss(view, id) {
  const receipt = view.receipts.find((r) => r.id === id);
  if (receipt?.status === "sending") return;
  const clearsReview = view.receipts.at(-1)?.id === id;
  view.receipts = view.receipts.filter((r) => r.id !== id);
  if (clearsReview) view.needsReview = false;
}
