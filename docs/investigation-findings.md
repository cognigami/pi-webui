# RAI Integration Investigation Findings

**Status:** Historical read-only investigation, with the execution-time Pi 1.5.2 correction below. Subsequent first-phase disposable live results are in the [execution plan](execution-plan.md#current-execution-result-and-live-gate); historical untested statements below describe the investigation, not the later smoke phase. No installation into regular sessions was authorized.
**Scope:** [Product brief](design-notes.md), [design](design.md), and [investigation plan](investigation-plan.md), including the operator's clarification below. No production stack selected.

## Execution-time correction: Pi 1.5.2 and accepted races

The original analysis below inspected Pi 1.5.0 and is historical evidence, not the current integration contract. An independent read-only reviewer during execution checked the installed package (1.5.2) and bundled CLI:

- `dist/core/agent-session.js:1715–1726` reserves `_promptPreflightCount` throughout awaited input/auth processing; `navigateTree:3363–3368` rejects navigation during preflight/streaming. Navigation-first reserves its controller before yielding (`3398–3408`); prompts reject under it (`1712–1714`). Fix #9154 closes the original input-handler/navigation interleaving. The bundled CLI contains the fix too (`dist/bundle/chunks/chunk-VEJDBY3O.js:855,860,871`). Do not add a RAI navigation lock to duplicate this host guarantee.
- A distinct gap remains: `prompt:1695–1699` defers actions during `_isEmittingAgentSettled`, before reservation. `_emitAgentSettled:738–760` marks the run inactive, awaits public settlement handlers, then invokes deferred actions. Send deferred during a paused handler can execute after same-file navigation on the new leaf. `isIdle:1130–1133` does not expose this span. The public API supplies no expected-association token.
- **Operator decision during execution:** “Accept the race. Continue to completion or gate.” This accepts that specific settlement-deferred navigation window, in addition to the previously accepted delayed Send-after-Stop window. It does not authorize Pi changes, navigation vetoes, live tests, or installation into existing sessions. No atomic targeting guarantee is claimed.
- Public compaction hooks now expose `reason: "manual"`, success, and failure (`types.d.ts:620–655,1235–1237`). Success fires before the controller clears (`agent-session.js:2400–2417`), failure after clearing (`2431–2447`). There is no public compaction-completely-settled getter. The first bridge conservatively leaves Send unavailable after observed successful manual compaction until a later agent lifecycle event or explicit reload; this limitation must be tested and reported, not hidden behind an invented compaction queue.

These are source-supported conclusions, not live observations. Suggested installed-host fixture reproductions of the two interleavings were not run. Bridge fake-context tests validate RAI behavior, not Pi's concurrency implementation.

## 1. What we learned

**Direct integration with Pi is the better fit.** Herdr/tmux keep Pi running independently of the browser and web service. A small extension inside the existing Pi can supply its current conversation and structured response/tool updates. We do not need to type into the terminal to communicate with Pi.

The extension API supplies the observation primitives, but its controls do not yet establish the full required behavior. A Send can pause inside another extension's input processing, then finish **after Stop**, or after Pi has moved to another point in the conversation. The existing Send call gives the caller no completion/cancellation boundary for that processing.

**Operator decision after review:** evaluate the direct extension using Pi's existing controls. The operator accepted the timing limitation that a Send still delayed in input processing may arrive after Stop; a Pi API change is **not required upfront**. The frequency has not been measured. The next proposed step is a small prototype that deliberately exercises this case, not production implementation. Live tests/installations still require separate authorization; no prototype has been started. Other targeting/history requirements remain unchanged.

### Operator clarification

The original investigation treated multiplexer input as a constraint and stopped at I1: terminal/file observations could not reliably establish the live conversation or safely bind input to it. The operator clarified that the multiplexer is for **process durability**, and explicitly allowed investigating direct Pi-side integration. That changes the integration direction, not the requirements for safe Send, combined Stop, saved history, or independent process lifetime.

The operator accepted the delayed-Send/Stop limitation after the findings were reviewed. The operator did not authorize live tests, installing/reloading an extension into existing sessions, changing Pi itself, or normalizing submitted whitespace. Earlier terminal-control findings remain in source-control history; this document consolidates the current result.

## 2. Environment and evidence

- Inspected host: macOS, `Darwin x86_64`. Linux remains provisional. Neither backend has passed live integration tests.
- Pi **1.5.0**, operator-reported. `pi --version` failed because its new Node process could not read the installed package configuration. Work stopped and resumed only after operator guidance; that command was not retried. No independent Pi executable/source-version equivalence is claimed.
- Herdr client/server **0.9.3**, private protocol **22**, endpoint generation **1**, confirmed with `herdr --version` and `herdr status`. Existing Pi integration **v9**, confirmed with `herdr integration status`.
- tmux **3.7b**, confirmed with `tmux -V`.
- `PI/` below means `/Users/ricardo/.local/lib/node_modules/@earendil-works/pi-coding-agent/`. Installed documentation/types define public surfaces; source inspection explains this installation's behavior, not an extra supported API.
- Read the installed extension documentation and relevant examples, including `send-user-message.ts`, `file-trigger.ts`, and input-transform examples. The file-trigger example demonstrates external input, not a suitable control protocol or lifecycle implementation to copy.

No existing conversations were read as fixtures, no controls were injected into existing agents, and no installed package or integration was modified.

## 3. Proposed ownership and connection

```text
Browser ↔ independent RAI service ↔ extension inside existing Pi
                     │                         │
                     └─ mux labels/context     └─ existing saved history

Herdr/tmux owns Pi and its terminal, independently of browser and RAI.
```

A small candidate is **one local connection from each extension to the independent service**, using a user-private Unix socket on the same host. The extension initiates/reestablishes an observation connection; the service never becomes Pi's parent. Node built-ins are available to extensions. This requires neither a launcher nor a separate daemon per Pi, and does not select the web-service stack.

- Start connection work from `session_start`, not the extension factory; clean it up idempotently on `session_shutdown`. Never delay Pi startup/work waiting for RAI to connect.
- Browser/service loss stops observation delivery, not Pi. Keep only bounded current in-flight display state, not another transcript archive or command outbox. Slow network readers must not block awaited stream hooks.
- Service restart requires fresh conversation/history/current-output synchronization. Reconnect observation; **never replay Send or Stop**. Lost acknowledgments stay uncertain.
- A live connection addresses its extension instance, not a mutable pane label. Runtime replacement/reload requires fresh selection identity. Use Pi's existing stale-context checks rather than duplicating them. Same-file tree navigation additionally needs explicit handling (§5).
- Use the extension's backend context and existing herdr/tmux APIs to retrieve human labels. Duplicate/renamed labels do not change the direct recipient. Nested multiplexer ownership and label mapping remain untested; do not guess by directory or list one endpoint twice because both backends see it.
- A global extension can load automatically into future sessions. Already-running Pi needs explicit supported load/reload before it participates. Installing a file is not automatic attachment. Show sessions without the extension as unavailable for direct integration, with no terminal-input fallback.

Evidence: `PI/docs/extensions.md:9,133–164,252–258,372–408,603–612,1469–1480`. The existing Herdr integration, `/Users/ricardo/.pi/agent/extensions/herdr-agent-state.ts`, demonstrates Pi-to-service reporting but is not a RAI control bridge.

## 4. Observation and history are substantially improved

| Need | Public extension surface | Conclusion |
| --- | --- | --- |
| Current conversation | `ctx.sessionManager.getSessionFile()`, `getSessionId()`, `getLeafId()`, `getBranch()`; `session_start`, `session_tree` | Direct access to the live position previously missing from disk-only observation. Documented capability, not an integrated test pass. |
| Completed history | Read-only session-manager access and correctly associated existing JSONL | Can retain branch ancestry and compaction originals without another archive. Paging/large-block retrieval still need proof. |
| Ongoing response/thinking | `message_start/update/end` | Structured roles/content; no terminal parsing or inferred thinking. |
| Tool activity | `tool_execution_start/update/end`, `toolCallId`, `parentToolCallId` | Direct progress and tool correlation, including nested work. Unknown result types still need explicit fallback display. |
| Activity/prompts | `agent_start`, `agent_settled`, `ctx.isIdle()`, `ui_prompt_start/end` | Final settlement is distinct from `agent_end`, which can precede retries/continuations. Prompt hooks cover extension UI, not every built-in selector. |
| Completed-turn association | `turn_end.messageEntryId`, `toolResultEntryIds` | Candidate ID-based boundary for replacing current output with saved content. No text-similarity deduplication needed. |

References: `PI/docs/extensions.md:575–612,663–817,1201–1213`; `PI/dist/core/extensions/types.d.ts:810–906`. The SDK creates/owns another session; it is not how this extension attaches to its host (`PI/docs/sdk.md`).

**Single-conversation candidate:** show the current response/tools as a replaceable provisional turn at the conversation tail. At a confirmed `turn_end`, use its persisted IDs and an authoritative branch snapshot to replace that turn together. While provisional, do not also display the same newly persisted records from independently polled history. Keep a completed-history cutoff and current-turn snapshot; reconnect must resynchronize them together. This is a bounded experiment to prove, not a completed rendering implementation.

Ordering matters: extension `message_end` fires **before** persistence and later handlers may transform the message (`PI/dist/core/agent-session.js:764–783,948–956`). A timer after it or the leaf observed inside it is not a documented persisted-message association. `turn_end` runs after assistant/tool-result persistence and supplies IDs (`PI/docs/extensions.md:738–750`). Joining mid-turn, aborted/error turns, reconnect gaps, and later-handler transformations remain untested.

### Existing history evidence still applies

Pi's JSONL graph retains completed content and originals across compaction. Walk `parentId`, not a branch summary's `fromId`; key entries by session plus entry ID because forks can preserve IDs. Model-context projections omit summarized history and apply context edits, so they are not full historical readers (`PI/docs/session-format.md:1–75,123–155,209–248`; `sessions.md:30–56`; `dist/core/session-manager.js:194–286,1069–1086,1215–1322`). Already-truncated saved output cannot be reconstructed from JSONL.

**Do not load live files through mutating helpers:** `loadEntriesFromFile` can append a newline to an incomplete tail and skips malformed records; `SessionManager.open` can initialize, migrate, and rewrite storage (`session-manager.js:313–369,666–685,718–765,1338–1360`). Read source bytes as data or use the host's read-only state. Unknown leaf fallback in `buildSessionPath` is also unsuitable for validating an association (`124–144`).

The initial history investigator executed **in-memory reference calculations**, not installed-parser tests: a nine-record fixture with sibling branches, an error tool result >131,000 JavaScript characters, Unicode line separators, compaction, and a context edit. Expected raw ancestry excluded the sibling and retained originals; three-entry pages reconstructed it exactly; LF framing kept incomplete/un-terminated tails pending and classified malformed LF-complete records as errors. Identical bytes were compatible with different live positions. No disk fixture/helper was used.

Still untested: actual read-only parser and byte-bounded paging, full long-result expansion, successive/retain-none compaction, unsupported formats/entries, invalid graphs, chunked UTF-8, append completion, unavailable/replaced/truncated files, source nonmutation under concurrency, and integrated live/history reconciliation.

## 5. Send: a suitable primitive, but no acceptance boundary

The public candidate is:

```typescript
pi.sendUserMessage(text, { deliverAs: "steer", expandPromptTemplates: false });
```

It sends an actual user message, starting when idle or steering while busy, without submitting the desktop editor. A desktop draft can remain untouched and cannot be accidentally prepended through this route. Disabling command/template expansion makes command-looking text conversational input rather than invoking extension commands/templates. Existing input extensions still run and may deliberately transform/handle it.

The direct string path does not apply the editor's `.trim()` (`PI/dist/core/agent-session.js:1928–1954`; `docs/extensions.md:1649–1681`). The earlier whitespace conflict is therefore **not inherent to direct Send**. Exact input still needs live tests; no permission to normalize text has been assumed.

### The remaining gap

`ExtensionAPI.sendUserMessage()` returns **void**, not an acceptance result (`PI/dist/core/extensions/types.d.ts:1285–1293`). The binding starts async processing and catches errors through a generic extension-error channel (`agent-session.js:2792–2801`). `await pi.sendUserMessage(...)` does not wait for Pi to accept/queue/handle it.

Input handlers are awaited **before** input is queued or the run starts (`agent-session.js:1649–1711`; `extensions/runner.js:1201–1236`). There is no exposed expected-conversation condition or cancellation token carried through that processing. Existing stale-context guards reject a new call after runtime replacement, but do not make an already-entered async call conditional. Same-file tree navigation does not replace the runtime.

Concrete source-supported interleaving: idle Pi receives Send; an input handler pauses; `/tree` changes the current position while Pi is not yet busy; the handler resumes and the message can start at that changed position. A check before dispatch is insufficient. Normal output advances the leaf too, so any future condition must distinguish intentional navigation from ordinary appends, not freeze an exact leaf ID.

Manual compaction is another explicit limitation: direct prompt rejects while `_compactionAbortController` exists (`agent-session.js:1666–1668`), whereas the TUI has its own compaction-input queue. Auto-compaction/startup/retry already have busy/steering handling; do not duplicate it. Recognizing manual compaction as an unsupported Send state may be acceptable under the design, but that recognition has not been established through the public extension surface. Do not hide it behind terminal fallback.

## 6. Stop: queue clearing exists, but a delayed Send can escape it

In the current TUI host, public `ctx.abort()` invokes the normal path that synchronously clears session and UI compaction queues, restores their text into the editor, then starts async abort. Public `ctx.ui.setEditorText("")` can discard that restored desktop text. Core abort cancels retry, compaction, branch-summary work, and the active agent without terminating Pi.

That is a plausible current-source Stop primitive, **not** a proven combined-operation contract. Public `ctx.abort()` returns void and promises abort, not a completed discard/settlement receipt covering unfinished Send processing.

Concrete interleaving: Send pauses in an input handler; Stop clears queues and aborts; the handler resumes afterward and starts work or queues its input again. An idle/settled observation can miss such pre-start input. This violates the original absolute ordering promise. The operator has since accepted this specific timing limitation for the existing-API prototype.

A socket request ID, service-side mutex, aggregate pending-message check, or synchronous precheck does not close that gap inside Pi. Do not invent a queue keeper, depend on extension load order, lock desktop navigation until conversational completion, or reach into hidden session objects as a workaround.

References: `PI/dist/core/agent-session.js:1081–1086,1441–1497,1962–2007,2837–2844`; `dist/modes/interactive/interactive-mode.js:1566–1568,2161,3913–3942,3961–3979`; `dist/core/extensions/types.d.ts:260–263`.

**Acknowledgments:** request received/dispatch attempted is observable; accepted/steering queued is not established by void return. `ctx.hasPendingMessages()` is aggregate and excludes the separate TUI compaction queue. Public input/message events carry no submission token; text equality is not correlation (`types.d.ts:855–870,926–950`). No public extension queue-update event was identified. Acceptance-unconfirmed feedback is permitted. Wrong-position effects remain a targeting concern; the delayed-Send/post-Stop effect is now an explicitly accepted limitation, not a prerequisite for changing Pi. A lost response remains outcome unknown, never an automatic retry.

## 7. Gate disposition and smallest next step

| Required outcome | Herdr | tmux |
| --- | --- | --- |
| Current conversation from direct extension | Documented capability; integration **unverified** | Same |
| Correct labels/ownership, including nesting and renames | **unverified** end-to-end | **unverified** end-to-end |
| Exact ordinary Send, no accidental desktop draft | Plausible direct primitive; **unverified** | Same |
| Safe acceptance after conversation changes | **unverified; blocking gap** across async input | Same |
| Stop interrupts and clears queued input | **unverified**; delayed-Send exception accepted | Same |
| Read-only complete history and coherent ongoing output | **unverified** integration | Same |
| Pi survives browser/service loss; reconnect never replays controls | Proposed ownership supports it; **unverified** | Same |

No backend passes the full required gates. I2–I5 live phases were **not run**, not failed experiments. The original file-only current-position mechanism was source-disproven; direct extension access removes that particular information gap but does not by itself prove safe control.

**Optional stricter alternative, not a prerequisite after the operator's decision:** a future Pi control-API improvement could provide a boundary that:

1. Submits ordinary input to the intended session/navigation state, checking that condition through awaited input processing.
2. Reports queued/started/handled/rejected **when acceptance is decided**, not after the conversational response, and lets Stop cancel/order earlier unfinished submissions. Correlate the submission if queued acceptance is claimed.
3. Aborts and discards earlier unfinished/queued input without allowing it to return after Stop, and reports completion when settled. Cover the TUI compaction queue or reject unsupported states before effects.

This describes an optional **Pi API improvement**, not the selected next step or permission to patch the installed package. An existing internal preflight callback is an implementation lead, not a supported extension option. Merely returning the core prompt promise is insufficient: idle-origin prompt completion waits for the full response, which must not delay Stop.

The accepted next direction is a minimal extension prototype using the existing API, including deliberate delayed-Send/Stop tests and honest feedback about that limitation. Safe conversation targeting, observation, history, and independent lifetime still need evidence. Obtain separate live-test authorization before creating targets or installing the prototype. No new transport framework, permanent receipts, transcript archive, or web UI is needed. Revisit a Pi API change only if later evidence and the operator's requirements warrant it.

### Later live-test authorization, not granted now

Once a supported control path exists, replace the old terminal-input experiment proposal with direct-call tests. Request exact disposable targets and cleanup permission before creating them: a separate named Herdr instance and tmux server, two Pi panes each, and repo-local test directories/session files under `.rai-investigation/` (not `/tmp`). No existing agent or research pane is a test target.

Start with a **20-minute identity/control phase per backend**, agreed before execution: delayed input followed by same-file navigation or Stop, process replacement, session switch/fork/reload, and duplicate/renamed labels. Only if that passes, agree a separate budget for exact Unicode/multiline/special-character input and desktop drafts, multiple steering messages, repeated/partial Stop, connection loss, and acknowledgment uncertainty. Then test history/live replacement, service restart/no replay, service absence/slow reader, and Pi survival in both backends. Deliberate resize is limited to disposable panes. Cleanup covers only exact returned IDs/paths created for those tests; never stop the default Herdr server or alter installed integrations. Unsupported fault injection returns for a decision, not workaround development. Linux remains provisional until actually tested.

## 8. Review, changes, and cleanup

The coordinator alone updated repository Markdown. Two original read-only investigators and an independent reviewer completed the terminal-control/history research; their three coordinator-created tabs were closed successfully. The original assembled findings received correctness review with no blocking findings.

For this follow-up, the direct-control investigator used `w12:t6` / `w12:p6`, session `01a1c2cb-9831-7298-9581-9102ab5c7a57`; the fresh correctness reviewer uses `w12:t7` / `w12:p7`, session `01a1c2cf-8b36-7286-ba19-80a226282321`. All launched agents received `--presets:preset eng`, explicit repository cwd, and background tabs in inherited workspace `w12`. Workers/reviewer have read-only authority and no live-test permission.

**Follow-up review:** the fresh read-only reviewer independently traced the delayed-input/navigation and delayed-input/Stop interleavings, public void control methods, existing stale-context guards, queue-clear behavior, and live/persisted event ordering. No blocking findings or required corrections. Both follow-up coordination tabs were closed successfully by their returned IDs; no pre-existing agents/tabs were interrupted and no live-test resources exist.

**Validation:** all 12 relative Markdown link paths across the four changed documents exist; anchor contents were not checked. No repo build/test command was run for this documentation-only desk investigation. No production code, extension, service, parser, or harness was built.
