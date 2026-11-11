import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
} from "@earendil-works/pi-coding-agent";
import {
  MAX_FRAME,
  parseControl,
  type Result,
  type Snapshot,
} from "./protocol.ts";
import { Transport } from "./transport.ts";

const CURRENT_LIMIT = 256 * 1024;
type ToolEvent = Extract<
  ExtensionEvent,
  {
    type:
      | "tool_execution_start"
      | "tool_execution_update"
      | "tool_execution_end";
  }
>;
type MessageEvent = Extract<
  ExtensionEvent,
  { type: "message_start" | "message_update" | "message_end" }
>;

// Owns only a bounded provisional turn. P3's service reader owns retained history.
export class Observation {
  endpointId = randomUUID();
  associationId = randomUUID();
  seq = 0;
  cutoff: string | null = null;
  message: unknown = null;
  tools = new Map<string, ToolEvent>();
  persistedIds: string[] = [];
  unavailable = "";
  prompt = "";
  manualCompaction = false;
  navigating = false;
  historyReady = true;
  turnOpen = false;
  private assistantStarted = false;
  private conversationStarted = false;
  private overflow = false;
  ctx: ExtensionContext;
  private readonly pi: Pick<ExtensionAPI, "sendUserMessage">;
  constructor(
    ctx: ExtensionContext,
    pi: Pick<ExtensionAPI, "sendUserMessage">,
  ) {
    this.ctx = ctx;
    this.pi = pi;
    this.cutoff = this.retainedCutoff();
    if (!ctx.isIdle()) {
      this.turnOpen = true;
      this.historyReady = false;
      this.cutoff = null;
      this.unavailable =
        "Live output before extension load unavailable; history resynchronizes at a confirmed turn boundary.";
    }
  }
  private retainedCutoff(): string | null {
    // Pi keeps setup/name entries in memory until the first user/assistant
    // message. A planned file path and in-memory leaf aren't persisted history.
    // Entries are append-only within this runtime's session; latch once true.
    this.conversationStarted ||= this.ctx.sessionManager
      .getEntries()
      .some(
        (entry) =>
          entry.type === "message" &&
          (entry.message.role === "user" || entry.message.role === "assistant"),
      );
    return this.conversationStarted
      ? this.ctx.sessionManager.getLeafId()
      : null;
  }
  reconnect() {
    this.endpointId = randomUUID();
    this.seq = 0;
  }
  beginNavigation() {
    this.associationId = randomUUID();
    this.navigating = true;
    this.historyReady = false;
    this.cutoff = null;
    this.reset();
    this.unavailable =
      "Conversation navigation pending; old branch content is not current.";
  }
  navigate() {
    this.navigating = false;
    this.associationId = randomUUID();
    this.cutoff = this.retainedCutoff();
    this.turnOpen = false;
    this.historyReady = true;
    this.reset();
  }
  beginTurn() {
    this.reset();
    this.turnOpen = true;
    this.assistantStarted = false;
    if (this.historyReady) this.cutoff = this.retainedCutoff();
  }
  settled() {
    this.reset();
    this.turnOpen = false;
    this.historyReady = true;
    this.cutoff = this.retainedCutoff();
  }
  reset() {
    this.message = null;
    this.tools.clear();
    this.persistedIds = [];
    this.unavailable = "";
    this.overflow = false;
  }
  completeTurn(messageEntryId: string, toolResultEntryIds: string[]) {
    this.reset();
    this.turnOpen = false;
    this.historyReady = true;
    this.cutoff = this.retainedCutoff();
    if (toolResultEntryIds.length > 128) {
      this.overflow = true;
      this.unavailable =
        "Turn has too many persisted IDs for the bridge sample; history resynchronization required.";
      return;
    }
    this.persistedIds = [messageEntryId, ...toolResultEntryIds];
  }
  observeMessage(event: MessageEvent) {
    // At assistant start, earlier user/system messages are already persisted.
    // Never advance into this assistant/tool turn from message_end.
    if (
      event.type === "message_start" &&
      event.message.role === "assistant" &&
      !this.assistantStarted
    ) {
      this.assistantStarted = true;
      this.historyReady = true;
      this.cutoff = this.retainedCutoff();
    }
    if (!this.overflow && event.message.role === "assistant") {
      this.message = event.message;
      this.bound();
    }
  }
  observeTool(event: ToolEvent) {
    if (!this.overflow) {
      this.tools.set(event.toolCallId, event);
      this.bound();
    }
  }
  private bound() {
    if (
      this.tools.size > 64 ||
      Buffer.byteLength(
        JSON.stringify({
          message: this.message,
          tools: [...this.tools.values()],
        }),
      ) > CURRENT_LIMIT
    ) {
      this.message = null;
      this.tools.clear();
      this.unavailable =
        "Current turn exceeds live display bound; use retained history after settlement.";
      this.overflow = true;
    }
  }
  snapshot(): Snapshot {
    const sm = this.ctx.sessionManager;
    // Authoritative idle reads include entries committed by later boundary hooks.
    // Elapsed time and message_end are never used as persistence evidence.
    if (
      this.historyReady &&
      !this.turnOpen &&
      !this.navigating &&
      this.ctx.isIdle()
    )
      this.cutoff = this.retainedCutoff();
    const sample: Snapshot["session"]["sample"] = [];
    let id = sm.getLeafId();
    for (let n = 0; id && n < 8; n++) {
      const entry = sm.getEntry(id);
      if (!entry) break;
      sample.unshift({ id: entry.id, parentId: entry.parentId });
      id = entry.parentId;
    }
    const tmux = process.env.TMUX;
    // TMUX ends with ",server-pid,session-index"; the socket itself may contain commas.
    const tmuxSocket = tmux?.slice(
      0,
      tmux.lastIndexOf(",", tmux.lastIndexOf(",") - 1),
    );
    const snapshot: Snapshot = {
      type: "snapshot",
      version: 1,
      endpointId: this.endpointId,
      associationId: this.associationId,
      seq: ++this.seq,
      observedAt: new Date().toISOString(),
      host: {
        pid: process.pid,
        cwd: this.ctx.cwd,
        mode: this.ctx.mode,
        herdrPane:
          process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined,
        herdrSocket:
          process.env.HERDR_ENV === "1"
            ? process.env.HERDR_SOCKET_PATH
            : undefined,
        tmuxPane: process.env.TMUX_PANE,
        tmuxSocket,
      },
      session: {
        id: sm.getSessionId(),
        file: sm.getSessionFile() ?? null,
        leaf: sm.getLeafId(),
        cutoff: this.cutoff,
        sample,
      },
      state: {
        activity: this.prompt
          ? "waiting"
          : this.navigating || this.manualCompaction
            ? "unknown"
            : this.ctx.isIdle()
              ? "idle"
              : "working",
        pending: this.ctx.hasPendingMessages(),
        prompt: this.prompt || undefined,
        manualCompaction: this.manualCompaction,
        sendSupported:
          !this.navigating && !this.manualCompaction && !this.prompt,
        controlUnavailable: this.navigating
          ? "Navigation is pending; if cancelled, use the terminal or reload to resynchronize."
          : undefined,
      },
      provisional: { message: this.message, tools: [...this.tools.values()] },
      persistedIds: this.persistedIds,
      historyReady: this.historyReady,
      turnOpen: this.turnOpen,
      gap: this.overflow,
      liveUnavailable: this.unavailable || undefined,
    };
    if (Buffer.byteLength(JSON.stringify(snapshot)) >= MAX_FRAME)
      throw new Error("RAI snapshot metadata exceeds frame limit.");
    return snapshot;
  }
  control(value: unknown): Result {
    const req = parseControl(value);
    const requestId = req?.requestId ?? "";
    const result = (status: Result["status"], detail: string): Result => ({
      type: "result",
      version: 1,
      requestId,
      status,
      detail,
    });
    if (!req) return result("rejected", "Invalid control request.");
    if (
      req.endpointId !== this.endpointId ||
      req.associationId !== this.associationId
    )
      return result("rejected", "Target unavailable or conversation changed.");
    if (this.navigating)
      return result(
        "rejected",
        "Navigation association is pending; resynchronization required.",
      );
    if (req.operation === "send" && (this.manualCompaction || this.prompt))
      return result("rejected", "Terminal action required; Send unsupported.");
    try {
      if (req.operation === "send") {
        this.pi.sendUserMessage(req.text as string, {
          deliverAs: "steer",
          expandPromptTemplates: false,
        });
        return result(
          "submitted_unconfirmed",
          "Submitted; acceptance unconfirmed",
        );
      }
      this.ctx.abort();
      this.ctx.ui.setEditorText("");
      return result("stop_requested", "Stop requested");
    } catch {
      // Public void calls may have begun effects before a synchronous failure.
      return result(
        "outcome_unknown",
        "Control dispatch failed; check the conversation or terminal.",
      );
    }
  }
}
export default function rai(pi: ExtensionAPI) {
  let observation: Observation | undefined;
  let transport: Transport | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const publish = () => {
    if (observation) transport?.publish(observation.snapshot());
  };
  const cleanup = () => {
    clearInterval(heartbeat);
    heartbeat = undefined;
    transport?.stop();
    transport = undefined;
    observation = undefined;
  };
  pi.on("session_start", (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui") return; // Stop semantics are verified against the interactive host only.
    observation = new Observation(ctx, pi);
    transport = new Transport(
      process.env.RAI_SOCKET ??
        join(homedir(), ".local", "state", "rai", "bridge.sock"),
      {
        connected: () => {
          if (!observation) throw new Error("RAI connected after shutdown");
          observation.reconnect();
          return observation.snapshot();
        },
        receive: (value) => {
          if (!observation) throw new Error("RAI control after shutdown");
          return observation.control(value);
        },
        error: (error) => ctx.ui.notify(error.message, "error"),
      },
    );
    transport.start();
    heartbeat = setInterval(publish, 2000);
    heartbeat.unref();
  });
  pi.on("session_shutdown", cleanup);
  const context = (ctx: ExtensionContext) => {
    if (observation) observation.ctx = ctx;
    return observation;
  };
  pi.on("session_before_tree", (_event, ctx) => {
    context(ctx)?.beginNavigation();
    publish(); // Invalidate before the leaf moves, not after earlier post-hooks await.
  });
  pi.on("session_tree", (_event, ctx) => {
    context(ctx)?.navigate();
    publish();
  });
  pi.on("session_before_compact", (event, ctx) => {
    if (event.reason === "manual" && context(ctx)) {
      if (observation) observation.manualCompaction = true;
      publish();
    }
  });
  // Conservative: success is emitted before the compaction controller clears.
  // Later agent_start/settled or an explicit reload re-enables Send.
  pi.on("session_compact_failed", (_event, ctx) => {
    if (context(ctx)) {
      if (observation) observation.manualCompaction = false;
      publish();
    }
  });
  pi.on("agent_start", (_event, ctx) => {
    const o = context(ctx);
    if (o) {
      if (o.navigating) o.navigate();
      o.manualCompaction = false;
    }
    publish();
  });
  pi.on("agent_settled", (_event, ctx) => {
    const o = context(ctx);
    if (o) {
      if (o.navigating) o.navigate();
      o.manualCompaction = false;
      o.settled();
    }
    publish();
  });
  pi.on("ui_prompt_start", (event, ctx) => {
    const o = context(ctx);
    if (o) o.prompt = event.kind;
    publish();
  });
  pi.on("ui_prompt_end", (_event, ctx) => {
    const o = context(ctx);
    if (o) o.prompt = "";
    publish();
  });
  pi.on("turn_start", (_event, ctx) => {
    context(ctx)?.beginTurn();
    publish();
  });
  const message = (event: MessageEvent, ctx: ExtensionContext) => {
    context(ctx)?.observeMessage(event);
    publish();
  };
  pi.on("message_start", message);
  pi.on("message_update", message);
  pi.on("message_end", message); // Observation only: NEVER advances the completed cutoff.
  const tool = (event: ToolEvent, ctx: ExtensionContext) => {
    context(ctx)?.observeTool(event);
    publish();
  };
  pi.on("tool_execution_start", tool);
  pi.on("tool_execution_update", tool);
  pi.on("tool_execution_end", tool);
  pi.on("turn_end", (event, ctx) => {
    const o = context(ctx);
    if (o) o.completeTurn(event.messageEntryId, event.toolResultEntryIds);
    publish(); // One replacement includes persisted IDs, cutoff, and cleared provisional state.
  });
}
