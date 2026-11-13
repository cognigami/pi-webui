# Pi Durable and RAI

## Bottom line

Pi Durable is relevant upstream infrastructure, not a replacement RAI application.
Keep testing the current RAI against its actual requirement: viewing and controlling
existing interactive Pi sessions without taking ownership of their processes.
Consider Durable if a later requirement is to host restart-resilient agents that
multiple clients can attach to. That would be a runtime migration, not a dependency
swap inside the current Go service.

This is a source/documentation assessment, not an adopted migration plan. No
Durable code was installed or executed, and no existing Pi conversation or running
service was used for an experiment.

## What it is

Earendil's `@earendil-works/pi-durable` is a TypeScript/JavaScript agent harness:
conversations, model/tool execution, queued inputs, tasks and application state
managed together over storage. It shares pi-ai with the coding agent. Storage
options include SQLite, its own JSONL format, memory and browser IndexedDB.
Persistent backends can recover unfinished work when a host reopens storage and
runs the scheduler; the library does not itself restart a dead OS process.

The official introduction explicitly says **“It does not replace the Pi coding
agent.”** The current README still labels the API **experimental**, with changes
possible without notice. The upstream package inspected declares version 1.5.2;
that version number does not remove the experimental API warning.

The locally installed coding agent also declares version 1.5.2 and depends directly
on pi-agent-core, not pi-durable. The inspected upstream CLI still creates its
ordinary AgentSession/SessionManager runtime. Installing/updating ordinary Pi is
not evidence that its sessions have become Durable conversations.

## Where it could help

| RAI concern | Durable capability, for agents hosted on Durable |
| --- | --- |
| Retained history plus live output | A conversation watch supplies an initial bounded transcript/live-state view and subsequent operations. ConversationTranscript merges pages, reconnect gaps and immutable entries. |
| Uncertain input admission after a disconnect | Input submission is stored, can be reacquired, and a repeated requestId finds the existing submission rather than submitting twice. |
| Restarting interrupted work | Persisted tasks/checkpoints and the input inbox survive a process restart; model attempts and tool calls follow defined recovery policies. |
| Several clients | Multiple clients can watch and steer the same conversation through its host. Transport and authentication still belong to the application. |
| Related agents and Stop | Owned child conversations/tasks give cancellation a defined scope. Background ownership boundaries still survive ordinary parent abort. |

These are real overlaps with difficult RAI backend work. In a Durable-hosted
application, we would prefer its existing view/admission/task guarantees over
reimplementing a parallel persistence or orchestration layer.

## Why it is not a drop-in replacement

Current ownership:

```text
browser -> Go RAI -> extension in an existing interactive Pi
                         Herdr/tmux owns the Pi process
```

A Durable-based application instead hosts a Harness that owns agent execution,
storage and conversations. A browser and, if supplied, terminal clients attach to
that host. The reviewed package provides the runtime/view primitives, not a ready
replacement for our tablet UI, current-session discovery, host security or existing
Pi extension integrations.

Specific migration costs:

- Durable's JSONL backend is a commit log (`main.jsonl` plus sidecars, with commit
  envelopes), not a reader for Pi's existing v3 session files. Do not treat the two
  formats as interchangeable or open active Pi history as Durable storage.
- Durable extensions use their own registry/tools/hooks API. Existing Pi CLI
  extensions, presets, controlled tools and sandbox behavior must not be assumed
  to carry over unchanged; compatibility/porting needs a separate assessment.
- The runtime is JavaScript, not a Go library. Adoption would change our existing
  single-Go-service plus small in-Pi-extension architecture and process ownership.
- Wrapping today's RAI dispatches in a second Durable ledger would not make the
  underlying interactive Pi execution restart-safe. The executing agent must
  actually run on Durable for those guarantees to apply.

The conversation UI and its reading/focus/draft behavior could remain valuable
under either runtime; the backend/history model and integration would change.

## Durability qualifications

Do not read the introductory persistence claims as a guarantee of zero-loss,
exactly-once external effects:

- The current README's Watching section permits deferred persistence of streamed
  partial answers/tool output: default progress persistence is within about
  1,000 ms. A crash can lose that latest window, and an early interrupted stream
  may leave no aborted transcript entry. This is distinct from stored input
  admission and execution checkpoints.
- SQLite defaults to WAL with synchronous NORMAL: process-crash survival is not
  the same guarantee as preserving the newest commit through host/power failure.
  JSONL offers an explicit fsync option.
- Interrupted tools rerun only when declared replay-safe; otherwise an interrupted
  result is reported. Replay-safe external effects still need idempotency. Input
  deduplication is not exactly-once execution of arbitrary shell/API effects.
- A storage has one writer/owner. This is not permission to attach competing
  writers to the current session directory. Read-only observers and application
  transports have their own contracts.

## Recommendation

1. Finish the current RAI acceptance work; no rewrite for this discovery alone.
2. Treat Durable as a serious candidate for a future **hosted-agent backend**, not
   a competing frontend and not something we should independently reinvent.
3. If automatic recovery or server-owned multi-client conversations become an
   explicit requirement, evaluate one isolated disposable agent: port a small
   tool/policy subset, test crash recovery and reconnect/admission, and verify
   cancellation scope. No such experiment is authorized by this research.

## Primary sources inspected

- [Official Pi Durable introduction](https://earendil.com/posts/pi-durable/): purpose,
  explicit non-replacement of the coding agent, host/client and task ownership model.
- [Current Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md):
  experimental warning; Persist and Resume, Tools, Watching a Conversation, Busy
  Conversations, Abort and Subagents, Storage.
- [Durable package manifest](https://github.com/earendil-works/pi/blob/main/packages/durable/package.json).
- [JSONL storage implementation](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/jsonl/storage.ts):
  separate commit/sidecar format and read-only/writable-open behavior.
- [Coding-agent manifest](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json)
  and [ordinary runtime](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session-runtime.ts).

The introduction's launch demos point at the v1.0.0 tag; use current README APIs
rather than assuming those older snippets still match main. No runtime tests were
performed for this assessment.
