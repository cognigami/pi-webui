# RAI Execution Plan

**Status:** P1 complete; P2 fixture checks and first authorized live identity/control smoke phase passed on macOS under Herdr and tmux. Full P2 acceptance and dependent UI remain gated on the next agreed live phase. Only disposable Pi sessions were loaded/reloaded; no regular-session installation or private existing-conversation reads. See [current execution result](#current-execution-result-and-live-gate).
**Authority:** [Product scope](design-notes.md), [design](design.md), and the operator's actual execution authorization.
**Coordination:** Follow [COORDINATION.md](COORDINATION.md), including the `eng` preset, background tabs in the coordinator's own Herdr workspace, bounded assignments, and independent review.
**Evidence:** [Investigation findings](investigation-findings.md). The [investigation plan](investigation-plan.md) is historical; do not restart its feasibility sequence.

## 1. Objective and boundaries

Deliver one independent web service and a small extension inside participating Pi sessions. Herdr/tmux continue owning Pi and its PTY; they supply labels and pane context, not terminal input/output transport. The tablet gets a session menu, one conversation combining saved and ongoing content, ordinary Send, and Stop.

Use Pi's existing public extension API. The operator has accepted that a Send still delayed inside input processing can arrive after Stop. **Do not add special-case cancellation machinery, change Pi, or reopen this limitation as a delivery gate.** Report dispatch honestly rather than claiming acceptance or completed interruption from a void API return. Other target/conversation requirements remain those in the design.

Excluded: session launching/ownership transfer, terminal capture or key injection, a required Pi API change, a database/broker, a second transcript archive, permanent delivery receipts, automatic control replay, generated names/summaries, unread tracking, shutdown/process-termination controls, and a separate frontend service without demonstrated need.

The repository currently contains documentation only. File roots below are proposed ownership boundaries, not claims about existing modules. P1 must turn them into a concrete stack-native file map before delegating implementation.

## 2. Authorization and decisions

### Ordinary implementation decisions

The coordinator selects one service stack from Go or Elixir/Phoenix LiveView, records the choice in the design, and resolves routine module/wire details within the agreed scope. No further broad feasibility phase or language comparison project is required. Escalate a product/integration change, not every routine engineering decision.

### Separate live-test authorization

Before live validation, request approval for exact disposable Pi targets, multiplexer instances/panes, repo-local `.rai-investigation/` paths, benign payloads/workloads, fault injection, and cleanup. Use separate test targets, never existing coordinator/worker panes or production conversations. Do not install/reload into existing sessions, modify installed Pi, use `/tmp`, or stop the default Herdr server.

Until that authorization is given, implement against fixtures/fakes and run ordinary local checks within the execution assignment. If live authorization is pending, report the bridge as unvalidated and do not start the full UI. Independent fixture work may continue.

### Concrete unresolved issues

Execution-time independent review verified that installed Pi 1.5.2 fixes the originally documented input-processing/navigation race via its built-in preflight reservation. It also found a distinct settlement-deferred Send/navigation race. The operator explicitly accepted that additional race and directed continuation to completion or gate; no Pi patch or navigation veto is authorized. See [updated findings](investigation-findings.md#execution-time-correction-pi-152-and-accepted-races). Normal leaf advancement is not intentional navigation; the bridge invalidates associations in `session_before_tree` before transition, then refreshes in `session_tree`, without preventing desktop navigation.

Manual compaction/unsupported input states also need focused validation. Use the existing rejection/limitation behavior and honest feedback; no terminal fallback or duplicate compaction queue.

## 3. Slices, ownership, and dependencies

| Slice | Deliverable | Depends on | Owner / intended write scope |
| --- | --- | --- | --- |
| P1 | Stack, concrete boundaries, minimal build/test setup | Execution assignment | Coordinator: design and this plan, root manifests/workflows, initial service skeleton |
| P2 | Working extension/service bridge, identity, controls, discovery/labels | P1 | One bridge owner: proposed `extension/`, service bridge/session-catalog modules, their focused tests |
| P3 | Read-only history paging and coherent ongoing-content projection | P2 bridge boundary; live bridge gate before integrated acceptance | One history owner: service history/projection modules, synthetic fixtures and focused tests |
| P4 | Read-only session menu and conversation UI | P2 validated and P3 accepted | One UI owner: service's stack-native browser/templates/assets and UI tests |
| P5 | Composer, drafts, Send/Stop and feedback | P4 and validated P2 controls | Same UI owner unless explicitly handed off; control request handlers/tests assigned to one owner |
| P6 | Integrated recovery/security/platform/tablet acceptance and run instructions | P3–P5 | Coordinator integrates; assign individual fixes to the current module owners |

The coordinator owns shared manifests, workflow files, design/plan edits, and integration. Workers return proposed shared-file changes rather than editing them concurrently. P1 records exact paths for each assignment; two owners must not share a write scope. A single engineer may implement several slices; headings are not a staffing requirement.

```text
P1 -> P2 [validated bridge] -> P3 -> P4 -> P5 -> P6
          \-> fixture-only P3 preparation may proceed earlier
```

P2 includes a minimal test client or diagnostic view, not the full application UI. No full UI until its live validation and correctness review pass on both multiplexers on the available test host. Other platforms remain explicitly provisional until tested; lack of Linux access need not stop development on macOS, or vice versa.

## 4. Slice details and acceptance

### P1 — Select stack and establish executable boundaries

**Work**

- Choose one concrete service shape for the local Unix-socket bridge, bounded history pages, browser updates, and simple host deployment. Keep TypeScript for the in-Pi extension; no second service stack.
- Read relevant installed Pi extension documentation and examples in full before implementation, following cross-references. Use the findings as leads, not an extra API contract. Verify installed multiplexer interfaces when implementing label/discovery access.
- Update design §§7–9 with the selected stack, actual module layout, local message framing, and browser request/update shape. Define endpoint-instance identity, conversation/navigation association, initial/reconnect snapshot, event/gap handling, and dispatch/failure responses. Keep it a small internal boundary, not a general protocol framework.
- Choose one history-reader location and entry-ID projection owned by P3; do not build competing readers in extension and service. The first bridge snapshot may carry a minimal branch sample for validation, not a second history subsystem.
- Establish only the required manifests, minimal service/extension skeleton, and standard `build`, `lint`, and `test` workflows through normal manifests or a root Justfile. Include focused-path support where practical. Use the supported `build`/`lint`/`test`/`deps` tools; do not invent undocumented project commands.
- Establish private local socket placement/permissions and loopback-only development defaults. Pick concrete config and run entrypoints for this stack; do not launch Pi from service startup.

**Accept when** the stack and actual owner/file map are recorded, the skeleton builds/tests, and the bridge/browser boundary is explicit enough for one owner to implement P2. A short coordinator-led interface check is enough; no architecture panel is required.

### P2 — Implement and validate the bridge first

**Work**

- Connect from the extension on `session_start`; clean up idempotently on shutdown/reload. Pi must start/work if the service is absent. Reconnect observations with fresh identity and snapshots, never queued commands.
- Report host session/file/branch association, structured message/thinking/tool activity, prompt/settlement evidence, and source freshness. Preserve tool and parent identifiers. Bound buffering; slow or disconnected readers must not block Pi. Report a gap and resynchronize rather than silently claiming complete output.
- Target the connected extension instance, not a path, label, directory, or recycled pane. Invalidate stale browser associations on replacement/reload and intentional conversation changes, without treating every normal append as navigation.
- Dispatch Send through `pi.sendUserMessage(text, { deliverAs: "steer", expandPromptTemplates: false })`; preserve the exact composed string and ordinary input-extension behavior. Do not submit or clear the desktop draft on Send.
- Use the existing Stop path described in design §5.4. Keep it prompt while Send feedback is pending; do not wait for a conversational response. No new queue manager or cancellation mechanism for the accepted delayed-Send limitation.
- Keep dispatch distinct from acceptance. Default to **Submitted; acceptance unconfirmed** and **Stop requested** at the established boundary. Unexpected errors remain errors; lost responses remain uncertain. Never retry/replay controls automatically.
- Add small herdr/tmux discovery/context functions: existing labels, duplicate/unnamed/renamed panes, authoritative ownership/deduplication, extension participation, missing integration, and partial discovery failures. No terminal fallback or alias system.
- Keep all browser control access absent or loopback-only and protected until its HTTP/browser boundary is implemented. The local socket must already be user-private.

**Checks**

- Unit/fake-transport tests for lifecycle, stale endpoint rejection, bounded output/gap recovery, non-replay, exact dispatch payloads, unavailable/partial discovery, and dispatch-versus-acceptance wording/data.
- Separately authorized disposable sessions under both herdr and tmux: connection, labels/renames/nesting, switch/fork/reload/replacement, and navigation during async input processing. Address the specific targeting issue before claiming this slice accepted.
- Exact whitespace/Unicode/multiline/command-looking input while idle/busy, untouched desktop drafts, ordinary steering, existing input transformations, and unsupported compaction/dialog behavior.
- Normal Stop/queued-steering discard, repeated taps, retained remote draft semantics, and continued Pi lifetime. The accepted delayed-Send timing limitation is not a test-failure criterion and needs no additional implementation.
- Service absence/restart, socket loss, slow reader, and loss of control responses: Pi survives, fresh association is required, and no commands replay. Exercise current-turn snapshots without implementing the full history browser.

**Accept when** both multiplexer tracks pass the required checks on the tested host, remaining platform limits are recorded, and a fresh correctness reviewer verifies the control/identity/lifecycle result. If live authorization or a concrete targeting issue is unresolved, stop dependent UI work and return that specific dependency. Do not reopen the accepted Stop exception.

### P3 — Read-only history and ongoing-conversation projection

**Work**

- Read associated retained history through the selected read-only mechanism. Never accept arbitrary browser paths or use helpers that migrate/repair source files.
- Traverse `parentId` ancestry and retain completed originals across compaction where stored. Key records by session plus entry ID; do not substitute a model-context projection or mix sibling branches.
- Bound entry/byte pages and support full retained tool/thinking content on expansion. For file reads, handle LF-complete framing and chunked UTF-8; wait for incomplete tails and report malformed completed records, unsupported content, unavailable/replaced/truncated files.
- Project a bounded provisional current turn together with a completed-history cutoff. At confirmed `turn_end`, use persisted IDs and authoritative branch state to replace provisional assistant/tool content together. Do not use text matching, timers, `message_end` as persistence, or an independently appended duplicate.
- Synchronize history and current output on initial join/reconnect, including mid-turn join, aborted/error turns, later-handler transformations, and gaps. Show an explicit limitation rather than fabricated missing content.

**Checks**

- Synthetic fixtures for sibling branches/forks, ID reuse across sessions, compaction/context edits, unknown entries, tool errors, long outputs, append/UTF-8 boundaries, malformed records and file replacement. Verify source nonmutation and paging/full-expansion behavior.
- Authorized bridge integration checks for provisional-to-persisted replacement, mid-turn join, reconnect and interruption, with no duplicated messages or stale branch content. Do not read private existing conversations as fixtures without permission.

**Accept when** one projection supplies correct bounded history plus coherent ongoing output to the browser boundary, with focused correctness review before the UI relies on it. Fixture-only work may be prepared before P2 passes; integrated acceptance may not.

### P4 — Session menu and read-only conversation UI

**Work**

- Implement the tablet/desktop shell, first-load session list, overlay/drawer, stable labels/context and details, and independent discovery/history/activity health states. Selection cannot silently redirect when a session disappears.
- Render the single conversation from P3 with role/code formatting, explicit errors/unsupported content, tool/thinking disclosures, and independent per-type View bulk actions, including entries loaded later.
- Page older messages and preserve reading anchors. Follow new content only while already at the bottom; otherwise show **New content below · Go to latest**. Do not add unread tracking or a separate terminal panel.
- Treat all content as untrusted from the first rendering implementation: escape/sanitize Markdown/tool content, prevent active HTML/terminal controls, and avoid automatically loading remote resources.
- Use semantic controls, focus states, accessible disclosure labels, text status and touch targets per design §6. Keep viewport/composer layout compatible with a software keyboard even before controls are wired.

**Checks**

Browser checks for session selection/rename/disappearance, missing integration, partial discovery, history failure, live updates, paging, individual/bulk expansion, reading anchors, malicious content, keyboard navigation, and layout without horizontal page scrolling.

**Accept when** the read-only catch-up flow works against the validated bridge/projection, not only mocks, and a correctness review finds no blocking behavior or disclosure problems. A brief real-tablet layout check here should catch structural issues before P5.

### P5 — Composer, drafts, Send/Stop, and footer feedback

**Work**

- Implement **Message… / Continue draft…**, multiline editor, Clear/Close/Send, keyboard dismissal and collapse after Send, and Stop in both composer states.
- Keep drafts and receipts page-local and associated with their original conversation/branch. Preserve them through switching/reconnect/rename, lose drafts on page reload, and require explicit review/use for an old draft after a conversation change.
- Implement enablement, outstanding-request/double-tap prevention, exact text capture, read-only pending review, and deliberate reuse after failure/uncertainty. Busy alone does not disable Send; known unsupported input states do.
- Implement design §5 feedback and lifetime rules using only available evidence. Keep dispatch, acceptance-unconfirmed, known no-side-effect failure, and unknown outcome distinct. Do not infer acceptance from matching text or add permanent user-message duplicates.
- Keep Stop usable while Send feedback is pending; do not wait for Pi's response. Use **Stop requested** or **Stop outcome unknown** as appropriate, without claiming an unobserved completed stop.
- Protect the browser boundary before enabling controls: permitted Host/Origin handling, framework-appropriate CSRF, no state-changing GET, no permissive CORS, and origin rejection for WebSockets if used. Disable automatic browser/client/adapter retries of Send/Stop.

**Checks**

- Request tests for stale targets, disconnected/unsupported controls, untrusted origins, literal input, operation outcomes, and non-replay after response loss/reconnect.
- Browser tests for per-conversation drafts/receipts, Clear/Close, double taps, composer collapse/keyboard behavior, feedback lifetimes, uncertain-outcome review/reuse without automatic resend, session changes while a request is pending, and Stop accessibility.

**Accept when** the full conversational loop matches design §§5–6 using the real bridge, ordinary error/recovery paths preserve the right text/recipient, and focused correctness review passes. Reviewers do not introduce stricter Stop guarantees than the accepted API behavior.

### P6 — Integrated acceptance and operator run instructions

**Work and checks**

- Run the integrated build/lint/test workflows and targeted regression checks accumulated in P2–P5. Fix demonstrated defects; do not add a separate test framework for every layer.
- Exercise browser/socket loss, service restart, slow readers and reconnection: current identity/history are refreshed, stale observations remain marked, controls never replay, and Pi/multiplexer lifetime is independent of RAI.
- Verify security behavior end to end: loopback default, explicit LAN/Tailscale configuration, private local socket, browser-origin protections, untrusted-content rendering and no full conversation/input logging by default. Do not bind publicly for tests.
- Validate both multiplexers and available Linux/macOS environments. Record actual platform/backend coverage; untested combinations stay provisional, not silently supported.
- Perform real-tablet portrait/landscape and software-keyboard tests: all footer actions visible, history still scrollable, keyboard dismissal after Send, usable drawer and touch targets. Include keyboard/screen-reader navigation and restrained live announcements.
- Add a concise README/run guide with actual install/build/start/config commands, supported extension load/reload procedure, safe network assumptions, known limitations and tested versions, and how to stop RAI without stopping Pi. No automatic extension injection into existing agents.
- Clean up only authorized disposable targets/files by their exact identities. Do not alter existing integrations or unrelated tabs/processes.

**Accept when** a fresh correctness review covers the assembled application and an engineering review covers the integrated codebase for simplicity/ownership/dependencies. The coordinator reports tested, provisional and blocked behavior, remaining concrete issues, run instructions, and cleanup results. Regular use/install into existing sessions remains the operator's decision, not a consequence of tests passing.

## 5. Coordination, review, and reporting

- Default to one owner per slice. P3 fixture preparation is the main useful early parallel task; any further concurrency needs concrete independent work and disjoint paths/targets. Keep shared boundary changes serialized.
- Use correctness reviews at meaningful dependency boundaries as specified above, not after every edit. Reuse a reviewer for follow-up; read-only reviews do not authorize live tests or modifying lint. Evaluate recommendations against actual requirements.
- Keep ordinary progress in the table below. Record stack/boundary decisions in the design and concise validation results with the slice handoff or in this plan. No new evidence registry, task database, durable receipt store, or coordination service.
- On a blocker, state the failing requirement, evidence, dependent work stopped, and smallest operator decision. Do not silently change integration direction, extend experimental authority, or restart broad design review.

| Slice | State | Owner / result |
| --- | --- | --- |
| P1 | Complete | Coordinator: Go stdlib + TS/Node; concrete paths/wire/config in design §§7–9; executable workflows pass |
| P2 | First bounded live smoke passed; NOT fully accepted | Coordinator: macOS Herdr/tmux controls/identity smoke and review complete; demonstrated Node-host discovery defect fixed and live-checked; extended live acceptance pending |
| P3 | Not started | P2 supplies lower-bound cutoff only; fixture preparation allowed, integrated acceptance blocked |
| P4 | Blocked | Gate: live-validated P2 and accepted P3; no full UI built |
| P5 | Blocked | Gate: P4 and validated controls; no HTTP control routes |
| P6 | Blocked | Gate: P3–P5; README currently covers prototype only |

## Current execution result and live gate

### Delivered and checked

- Concrete Go standard-library service, TypeScript extension, user-private Unix socket, bounded snapshots and provisional output, fresh endpoint/conversation associations, local diagnostic Send/Stop client, and read-only loopback HTTP diagnostics. No terminal transport, second transcript archive, Pi changes, or automatic control replay.
- Existing Herdr agent/tab labels and tmux pane/window context via literal CLI arguments; missing integration and partial coverage are explicit. First-phase live checks covered ordinary labels, duplicates, renames, and nonintegrated Pi discovery on the test host; nesting/authoritative overlapping ownership remain unpassed.
- Independent reviewer: Pi session `01a1c632-f370-71b6-9c2d-7c960392f836`, launched with `--presets:preset eng` into coordinator-owned background tab `w12:t9` / pane `w12:p9`. Read-only review included current installed Pi source and implementation, not live controls or modifying lint. Local fixes: before-tree invalidation (not merely late post-hook observation), test-to-build dependency to avoid stale/missing fixture binaries, and closing failed/partial command writes while still holding the write lock. Focused re-review cleared the fixture boundary after these corrections; it did **not** accept P2 live or P3 history correctness. A small persisted-ID bound was also added with explicit gap/resynchronization feedback.
- Ordinary `build`, `lint`, `test` workflows pass on macOS with Go 1.25.5 and Node 24.21.0, including race-enabled Go package tests and Node fake-context/real-service roundtrip fixtures. These are separate from the first live phase below, not proof of Pi concurrency or tablet behavior. Focused Go test forwarding was corrected after the tool normalized away a leading `./`; `test(paths: ["internal/catalog"])` now works.
- `cutoff` is explicitly a conservative P2 lower bound. Pi can append later `turn_end` / `agent_before_settle` proposals beyond it; P3 must reconcile the authoritative persisted tail and provisional holdback before claiming a coherent conversation. The fake host is not a reproduction of Pi's later-handler persistence.
- Remaining prototype limitations: observed successful manual compaction requires a later authoritative agent event or explicit reload before remote Send resumes; a later-handler navigation cancellation can similarly leave transition controls unavailable until resynchronization; built-in terminal dialogs are not fully observable. These are visible conservative limitations pending live tests, not silently restored by timers or a duplicate queue.
- Run/config/check instructions: [README](../README.md). Dependencies/build artifacts and test temporary paths are repo-local/ignored; no installed Pi or existing conversations were modified. Reviewer tab cleanup is recorded below. The earlier npm version probe hit a sandbox read denial; work paused and resumed only after the operator's explicit continuation guidance. Subsequent dependency/build workflows used the supported tools and succeeded.

### First live phase — completed within the approved bounds

The operator approved the disposable live-test phase, then explicitly disabled the sandbox after its Unix-socket connect denial. The denied first Send had no dispatch side effect; the same request was retried after that guidance. The first phase stayed within 20 minutes per backend (Herdr targets started 2026-11-10 23:57 UTC; tmux targets 2026-11-11 00:03 UTC). Testing used macOS x86_64, installed Pi 1.5.2, Herdr client/server 0.9.3 and tmux 3.7b, with the configured model `openai-codex/gpt-6.1-sol`. All model tools except the benign fixture wait tool were disabled. The scope below records the approved envelope, not completion of every check it permitted. Broader phases still require agreement.

| Check | Herdr | tmux |
| --- | --- | --- |
| Extension connection, session/file identity, real Send and saved `RAI_OK` response | Passed | Passed |
| Unicode/multiline/whitespace and embedded command-looking line through ordinary input hook; desktop draft untouched | Passed for the synthetic sample | Passed for the synthetic sample |
| Busy fixture tool, ordinary steering queue, Stop interrupts and discards queued steering without Pi exit | Passed | Passed |
| Held async input rejects navigation; after release, navigation invalidates old association | Passed | Passed |
| Reload and fork invalidate endpoint; stale controls rejected | Passed | Passed |
| Duplicate/renamed labels preserve target identity | Passed | Passed |
| Extension confirm dialog produces waiting/unsupported Send feedback | Passed | Passed |
| Missing RAI extension is reported rather than becoming a guessed control target | Passed | Passed after the Node-host discovery fix |
| RAI absence/restart preserves Pi and refreshes endpoint identity without observed replay | Passed for one joint four-target restart | Same joint run |

**Behavioral evidence:** Send/Stop result strings alone were not treated as acceptance/completed interruption. Public fixture observations and synthetic saved ancestry showed the real `RAI_OK` reply, unchanged desktop drafts, a waiting tool with `pending=true`, then an interrupted tool with `pending=false`, empty editor, and no queued-steering user entry in active ancestry. The busy payload was exactly `Reply with exactly RAI_STEERED; do not use tools`; it was not one of the fixture-handled input prefixes. A contemporaneous four-target assertion confirmed unchanged PIDs/session IDs/input counts across RAI restart. Later process replacements overwrote the disposable b-target snapshots; this is recorded as an observed check, not a reconstruction from their final state.

**Demonstrated defect and minimum correction:** tmux reported a real nonintegrated Pi as `pane_current_command=node`, so the old exact-`pi` predicate omitted it. The service now checks only Node candidates using that pane's `pane_tty` and bounded `ps -t TTY -o pid=,stat=,comm=` metadata: an exact `pi` foreground (`+`) process identifies a candidate. No terminal/title scraping, all-host process walk, or control-recipient inference. Background/non-Pi cases and process-inspection failure have focused tests. Rebuilding/restarting RAI made the actual nonintegrated tmux target appear as `integration=unavailable`; Linux remains provisional.

**What did not pass:** the literal sample begins `RAI_LITERAL` and contains an embedded `/rai-not-command` line; it does not establish leading slash-command behavior. A held-settlement attempt did not reproduce the accepted race: terminal setup commands waited until the fixture's 30-second auto-release, so the deferred literal ran on the original leaf before navigation. Neither a race reproduction nor atomic targeting is claimed. Manual compaction, nested ownership, session switching, real-Pi response loss/backpressure, comprehensive exact-input cases, and coherent history/live reconciliation remain unpassed. The two previously accepted races remain accepted; no cancellation machinery was added.

**Independent review:** read-only reviewer `01a1c7ef-ba57-74dd-9eba-6659f0aebd2e` ran with `--presets:preset eng` in coordinator-created background tab `w12:tC` / pane `w12:pC`. It reviewed the sources, synthetic fixture artifacts and evidence limits without controlling targets, modifying files/lint, running tests/model requests, or launching descendants. It found the smoke result sound as a bounded smoke, reviewed the narrow Node-host correction without a blocking finding, and explicitly did not accept full P2. The coordinator separately performed the live discovery-fix check.

Approved envelope:

Approved envelope:

1. **Resources:** one new disposable Herdr instance named `rai-bridge-validation` (never the default server), one new tmux server using the exact repo-local socket `.rai-investigation/live/tmux.sock`, and two new interactive Pi targets in each. Never replace an existing instance/socket/name; collision returns for a decision. No coordinator/worker/production panes are test targets. The validation owner alone manages these resources.
2. **Paths/service:** `.rai-investigation/live/` only for fixture extensions, per-target working/session directories, configuration and temporary files; a dedicated RAI service on `127.0.0.1:8485` with `.rai-investigation/live/rai.sock`. No `/tmp`, LAN/public listeners, production history reads, or installed Pi/settings changes. Bind failures return for a decision.
3. **Payloads/work:** synthetic conversations only, ordinary prompts such as `Reply with exactly RAI_OK; do not use tools`, exact whitespace/Unicode/multiline/command-looking strings, desktop draft sentinels, and a disposable fixture tool/input handler with an interruptible promise latch. The fixture may delay input/settlement or show a benign dialog to exercise the two accepted races, normal steering, Stop and unsupported-state feedback. Manual compaction/fork/tree/reload act only on these synthetic conversations. No external side-effect tools, task subagents, private data, or network writes beyond ordinary configured model requests.
4. **Faults:** disconnect/reconnect the disposable extension/service socket, stop/restart only this RAI test service, throttle a diagnostic reader, intentionally drop a control response, and replace/reload only the disposable Pi targets. Rename/nest the disposable panes, switch/fork synthetic conversations, and interrupt the fixture workload. Do not alter installed integrations, existing multiplexer instances, or production agent processes.
5. **Budget/cleanup:** first 20-minute identity/control phase per backend; if it passes, agree the next bounded acceptance phase for exact input, recovery and history integration. Cleanup closes only the exact returned test pane/instance IDs and removes only created files under `.rai-investigation/live/`; never stop the default Herdr server. Report failed/untested cases rather than widening authority.

**Current gate:** P2 is smoke-tested but not fully accepted; full UI work remains stopped. Proposed next agreement: up to 30 minutes per backend for the remaining P2 exact-input, manual-compaction, nesting and response-loss/backpressure checks, reusing only the stopped named test instance and recreating the same private repo-local resources. No existing sessions are targets; the original payload/fault/cleanup exclusions remain. P3 fixture work may proceed, but full history/live reconciliation requires P3 implementation and its own integrated acceptance after the bridge gate. The accepted races need no special cancellation machinery and are not renewed delivery gates. No new stack/feasibility review is needed.

**Cleanup:** RAI test service stopped; exact tmux test session `$0` on `.rai-investigation/live/tmux.sock` killed; named Herdr instance `rai-bridge-validation` stopped (`running=false`). Coordinator-created management tabs `w12:tA` / `w12:tB` and reviewer `w12:tC` were closed by their returned IDs; earlier reviewer `w12:t9` was already closed. No default server or pre-existing panes were stopped. All 32 inventoried repo-local live fixture/session files and the leftover tmux socket were removed successfully by exact path; ordinary build/dependency artifacts remain ignored. Herdr's stopped named-instance metadata remains managed by Herdr outside the repo-only file-cleanup envelope.

## 6. Coordinator start brief

> Work in this repository and read `docs/COORDINATION.md`, `docs/design.md`, `docs/design-notes.md`, this execution plan, and the current investigation findings. The selected direction is an independent web service plus an in-Pi TypeScript extension using the existing API. Herdr/tmux retain process ownership and provide labels/context. Do not restart the historical investigation plan or polish the design generally.
>
> This document is a plan, not an execution authorization. Follow the operator's actual assignment; this authoring request granted planning only. Once implementation is assigned, begin with P1: choose one service stack, record the concrete file/owner/wire boundaries, and establish supported build/lint/test workflows. Then implement P2 before the full UI. Request separate, exact authorization for disposable live validation; no installation/reload or control of existing agents is implied. Fixture-based work can proceed within implementation authority while live authorization is pending.
>
> Follow the slice dependencies and review points, maintaining a small status table and explicit platform coverage. Preserve the accepted delayed-Send/Stop limitation; do not create special-case cancellation machinery or require a new Pi API. Return a specific unresolved targeting or integration defect for decision rather than widening scope. After the validated bridge, implement history reconciliation, the read-only UI, conversational controls, and integrated acceptance in that order. Report actual checks, limitations and cleanup honestly.
