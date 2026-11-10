export const VERSION = 1;
export const MAX_FRAME = 1 << 20;
export interface Target {
  endpointId: string;
  associationId: string;
}
export interface Snapshot extends Target {
  type: "snapshot";
  version: 1;
  seq: number;
  observedAt: string;
  host: {
    pid: number;
    cwd: string;
    mode: string;
    herdrPane?: string;
    herdrSocket?: string;
    tmuxPane?: string;
    tmuxSocket?: string;
  };
  session: {
    id: string;
    file: string | null;
    leaf: string | null;
    cutoff: string | null;
    sample: { id: string; parentId: string | null }[];
  };
  state: {
    activity: "working" | "idle" | "waiting" | "unknown";
    pending: boolean;
    prompt?: string;
    manualCompaction: boolean;
    sendSupported: boolean;
    controlUnavailable?: string;
  };
  provisional: { message: unknown; tools: unknown[] };
  persistedIds: string[];
  gap: boolean;
  liveUnavailable?: string;
}
export interface Control extends Target {
  type: "control";
  version: 1;
  requestId: string;
  operation: "send" | "stop";
  text?: string;
}
export interface Result {
  type: "result";
  version: 1;
  requestId: string;
  status:
    | "submitted_unconfirmed"
    | "stop_requested"
    | "rejected"
    | "outcome_unknown";
  detail: string;
}
export function parseControl(value: unknown): Control | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (
    v.type !== "control" ||
    v.version !== VERSION ||
    typeof v.endpointId !== "string" ||
    typeof v.associationId !== "string" ||
    typeof v.requestId !== "string" ||
    !v.requestId ||
    v.requestId.length > 128 ||
    (v.operation !== "send" && v.operation !== "stop")
  )
    return;
  if (
    v.operation === "send" &&
    (typeof v.text !== "string" ||
      !v.text.trim() ||
      Buffer.byteLength(v.text) > 128 * 1024)
  )
    return;
  return v as unknown as Control;
}
