# RAI Execution Plan

**Status:** P1 and the first macOS Herdr/tmux smoke phase are complete. The operator explicitly deferred the broad second test phase and directed history/UI implementation; P3–P5 are implemented with synthetic integration and independent source reviews; actual browser/tablet and full live reconciliation remain provisional, not silently passed. Only disposable Pi sessions were loaded/reloaded; no regular-session installation or private existing-conversation reads. See [current execution result](#current-execution-result-and-live-gate).
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
| P2 | Smoke passed; broad second phase explicitly deferred | Existing untested live limits retained, not a development gate after operator instruction |
| P3 | Implemented; fixtures/source review complete | `internal/history/**` owner handed back to coordinator; safe-cutoff combined projection integrated; full real-Pi reconciliation remains provisional |
| P4 | Implemented; request/model/DOM fixtures reviewed | Coordinator: embedded `internal/web/assets/` UI; actual browser/tablet geometry and keyboard behavior not accepted |
| P5 | Implemented; protected HTTP and client fixtures reviewed | Page-local drafts/receipts, independent Stop and honest outcomes; no automatic replay |
| P6 | Local integration/run guide complete; runtime acceptance provisional | Build/lint/test and independent engineering/source checks; no new live targets, regular installation, or tablet check |

## Current execution result and live gate

### Delivered and checked

- Concrete Go service, TypeScript extension, private Unix socket and embedded vanilla HTML/CSS/JavaScript browser. Session menu, raw retained-history paging/full expansion, bounded live projection, composer/drafts, honest Send/Stop feedback and protected HTTP controls are implemented. No React/frontend service, terminal transport, second transcript archive, Pi changes, or automatic control replay.
- Existing Herdr agent/tab labels and tmux pane/window context via literal CLI arguments; missing integration and partial coverage are explicit. First-phase live checks covered ordinary labels, duplicates, renames, and nonintegrated Pi discovery on the test host; nesting/authoritative overlapping ownership remain unpassed.
- Independent reviewer: Pi session `01a1c632-f370-71b6-9c2d-7c960392f836`, launched with `--presets:preset eng` into coordinator-owned background tab `w12:t9` / pane `w12:p9`. Read-only review included current installed Pi source and implementation, not live controls or modifying lint. Local fixes: before-tree invalidation (not merely late post-hook observation), test-to-build dependency to avoid stale/missing fixture binaries, and closing failed/partial command writes while still holding the write lock. Focused re-review cleared the fixture boundary after these corrections; it did **not** accept P2 live or P3 history correctness. A small persisted-ID bound was also added with explicit gap/resynchronization feedback.
- Ordinary `build`, `lint`, `test` workflows pass on macOS with Go 1.25.5 and Node 24.21.0, including race-enabled Go package tests and Node fake-context/real-service roundtrip fixtures. These are separate from the first live phase below, not proof of Pi concurrency or tablet behavior. Focused Go test forwarding was corrected after the tool normalized away a leading `./`; `test(paths: ["internal/catalog"])` now works.
- P3 completes the earlier lower-bound contract: explicit historyReady/turnOpen, already-persisted user cutoff at assistant start, persisted-ID replacement at turn_end, and authoritative settled/idle reads for later boundary proposals. Before-tree invalidation withholds old history and provisional data. Synthetic/source checks protect these rules without claiming a live reproduction of every Pi hook order.
- Remaining prototype limitations: observed successful manual compaction requires a later authoritative agent event or explicit reload before remote Send resumes; a later-handler navigation cancellation can similarly leave transition controls unavailable until resynchronization; built-in terminal dialogs are not fully observable. These are visible conservative limitations pending live tests, not silently restored by timers or a duplicate queue.
- Run/config/check instructions: [README](../README.md). Dependencies/build artifacts and test temporary paths are repo-local/ignored; no installed Pi or existing conversations were modified. Reviewer tab cleanup is recorded below. The earlier npm version probe hit a sandbox read denial; work paused and resumed only after the operator's explicit continuation guidance. Subsequent dependency/build workflows used the supported tools and succeeded.

### History and UI implementation — after explicit operator deferral

The operator questioned the value of another broad phase, accepted the recommendation to defer it, and then explicitly directed: “Carry on with history and UI.” The earlier full-bridge test gate is therefore **not** a development blocker. Untested behavior is still marked provisional. No new live Pi targets or regular-session installation/reload were performed during this implementation.

- **History:** one Go reader in `internal/history/` reads v3 raw JSONL only, follows parentId, retains compaction/context-edit originals and unknown entries, pages at 32 entries/256 KiB, and expands full retained records in UTF-8-aligned 64 KiB chunks. LF-incomplete tails wait; malformed completed records and unavailable/changed sources are errors. Explicit bounds are in README. An ephemeral offset index plus bounded file identity/prefix observations is not a second transcript cache/archive. The normal Pi writer is source-confirmed append-only; arbitrary concurrent same-inode/same-size in-place overwrites are not transactionally protected.
- **Projection:** one captured bridge observation and completed-cutoff history page form each `/conversation` response, with association revalidation after I/O. No browser paths, sibling expansion, text matching, independent duplicate append, timer-based persistence or message_end advancement. Midturn extension load honestly withholds unavailable state until a confirmed boundary.
- **Browser:** same Go binary serves session drawer, conversation/ongoing output, code/role formatting, tool/thinking disclosures and bulk defaults including later entries, older paging/anchors and Go to latest. Missing pages preserve the old reading view with explicit resync rather than claim completeness. Pure page state lives in model.js; DOM/network coordination in app.js. Drafts and temporary receipts are page-local per session+association; request results stay on the captured original view. Stale Review dialogs cannot copy into a changed recipient. Send uncertainty and Stop feedback coexist, and neither controls nor uncertain text auto-replay.
- **HTTP/security:** exact configured Host/Origin (including HTTP default-port canonicalization), per-start CSRF header, no control GET/permissive CORS, bounded JSON body, inert DOM text/code, no automatic external resources, and restrictive CSP. Explicit private LAN/Tailscale IP configuration is now available; loopback is default and wildcard/public addresses are rejected. These protections are not login/authentication against an untrusted network peer.
- **Ownership/review:** history writer `01a1c7ff-274e-744f-a030-5cc372e2a230` used `--presets:preset eng` in coordinator tab `w12:tE` / pane `w12:pE`, wrote only internal/history and handed it back before integration. Fresh independent read-only reviewer `01a1c806-ad96-7100-a342-85df4c965dd3` used the same preset in `w12:tF` / `w12:pF`. It reviewed history/projection before the UI relied on it, then assembled UI/security/engineering boundaries. Corrections addressed: pending-navigation history invalidation, persistent Send uncertainty coexisting with Stop, newest positioning on revisits, deferred assistant tool expansion, in-message reading anchors without explicit-expansion bottom-follow, stale Review recipient capture, and older-receipt dismissal not unlocking a newer uncertain draft. Focused re-review found no remaining source blocker and no warranted framework/refactor expansion. Reviewers did not execute live tests, modify lint/files, or install into Pi.
- **Checks:** final `build`, `lint`, and `test` all succeeded after integration and review fixes. Tests include 36 Node extension/client/DOM checks plus race-enabled Go package tests. Go reader/request tests, exact Go/TS HTTP dispatch+restart fixtures, pure client state tests, inert rendering tests, and a DOM-controller interaction fixture cover the contracts. The DOM fixture uses synthetic fetch/geometry—not a browser rendering engine or physical keyboard. No real-browser automation tool was available. Native dialog focus/scroll geometry, software-keyboard behavior, real-tablet access and full live history replacement still need actual use, not a claim from those fixtures.
- **Run guide/cleanup:** README contains actual build/start/load/config instructions for the browser UI, supported explicit extension loading into an operator-chosen new session, private network assumptions, and known limits. No service/Pi session is left running for regular use automatically. Coordinator-created history/reviewer tabs `w12:tE` and `w12:tF` were closed successfully by their returned IDs after handoff/review; no pre-existing tabs were closed.

### First operator browser feedback — discovery and readability correction

The first actual operator trial exposed poor presentation: dark modal veil/automatic dark styling, connected sessions buried among unintegrated candidates, and refusal of the conventional localhost alias. A single read-only `/sessions` metadata check found one healthy connected endpoint labeled `node` in tmux `root · %1`; this was not a missing-extension transport defect. No history content or controls were requested and no Pi was reloaded/changed.

The follow-up uses an explicit light palette with readable foregrounds, a light session sheet with transparent backdrop (native modal focus/Escape retained), connected-first groups/count/badges, folded other sessions, and separate folded discovery diagnostics. Initial lookup failure and stale retained lists are reported inside the sheet, not hidden behind it. Loopback listeners accept exact localhost at the configured port; private-network listeners still require their literal configured IP. Origin must match the request Host, not another alias, with CSRF and foreign-host protections retained.

A CSS-only worker in coordinator-created `w12:tG` / `w12:pG` handed back its stylesheet and performed read-only review of the coordinator's other changes. It found the hidden chooser-error case; the fix and failure/recovery fixture passed focused re-review. The coordinator inspected the stylesheet. Final build/lint/test passed: race-enabled Go packages and 38 Node checks. No real-browser rendering/geometry tool was available, so this is not visual/tablet acceptance. That worker tab was closed by returned ID. The operator's existing RAI service was not stopped/restarted; the rebuilt binary's embedded changes require restarting only RAI and refreshing the browser. Participating Pi processes can remain running and reconnect normally.

### Operator iteration: untouched history, one editor, moderate density

The operator's untouched `TESTTESTTEST!!!` session showed a history-loading error, then the composer exposed both the compact Message-like button and textarea plus four primary-looking buttons. The light styling also overcorrected spacing. These are usability defects, not acceptance results.

Source inspection of Pi's public session-manager implementation confirmed that setup/name entries can have an in-memory leaf and planned filename while no file exists; first user/assistant message flushes them. The extension now reports an empty persisted cutoff until that public conversation-start fact is true, without a new wire flag or extension file reader. The Go reader allows ENOENT as an empty page only for an authoritative nil cutoff, no cursor, and no previously observed source. Missing saved/previously observed files and other errors stay explicit. Browser copy is **No messages yet**.

The composer is one real textarea (one row compact, three on focus), with Send/Stop primary. Clear draft and Collapse editor live in secondary native **⋯** details; Escape also collapses without clearing. Draft/receipt ownership, exact payloads, independent Stop and uncertain-outcome locks are unchanged. Padding/card gaps/editor footprint are reduced while preserving 16px body text, light contrast and 44px targets. No theme/configuration framework was added.

Independent read-only reviewer in coordinator-created `w12:tH` / `w12:pH` found no concrete defect after inspecting source/fixtures and append-only/persistence guarantees. Build/lint/test passed: race-enabled Go and 40 Node checks, including untouched-file transitions and single-editor draft behavior. That reviewer tab was closed by returned ID. No user Pi controls, reloads, history reads or process changes were performed. The rebuilt UI needs an RAI-only restart/browser refresh; the cutoff correction applies on the next explicit/new extension load. Actual layout/tablet validation remains the operator's ongoing trial, not proven by DOM fixtures.

### Operator override: remove recovery workflow; show chat, not internal records

The operator explicitly removed **Review message** and the draft-management workflow, and clarified that model/thinking changes, internal custom entries and system setup do not appear as messages in Pi. This supersedes earlier receipt/reuse/lock and Clear/Close requirements in this plan's historical implementation notes.

The UI now has one ordinary textarea plus Send/Stop, without a review dialog, receipt archive, draft menu or mandatory unlock/reuse step. A rejected/unknown result leaves text editable with inline feedback; it never automatically resends. In-flight results stay with their original conversation. One Boolean preserves Stop eligibility from an earlier unconfirmed dispatch when a later Send is rejected, independently of the single latest feedback status; it does not retain submitted text/history.

Normal conversation filters administrative session records out entirely. View → Show session records is the opt-in, using quieter collapsed details. User/assistant messages remain primary, tool activity secondary; errors and meaningful compaction/branch boundaries remain visible. Explicit custom-message display flags are preserved even for deferred entries, so hidden extension messages do not flash into the timeline before expansion. Raw retained data/ancestry/paging and full expansion are unchanged.

Read-only reviewer in coordinator-created `w12:tJ` / `w12:pJ` identified two concrete edge cases (deferred display:false visibility and unresolved Stop eligibility across later rejection); both received minimal fixes, fixtures and cleared focused re-review. Build/lint/test passed after those fixes, including race-enabled Go and Node model/DOM/rendering tests. No user Pi controls/reloads, live history reads or browser-rendering claims. Only an RAI restart/browser refresh is required for this UI/server slice; no extension change in this follow-up.

### Operator cleanup: no debug panels or normal success notices; LAN instructions

The operator removed the top-right Details debug panel, visible Sessions text next to the hamburger, unreachable Pi candidates and Discovery details. The chooser now contains only connected endpoints. Lookup failure is still explicit, but cached/unreachable entries are not offered as choices. The icon retains its accessible Sessions label. Technical discovery APIs remain internal/read-only; no control identity rules changed.

Ordinary submission clears the input quietly. Sending… is confined to the pending Send button; no Submitted/acceptance-unconfirmed notice is rendered. The transport's lack of acceptance proof is unchanged, with actual rejection/unknown-delivery warnings and conservative independent Stop eligibility preserved. No success receipt or fake Sent event is created.

Address/port were already explicit JSON configuration via `rai serve -config PATH`; added `configs/lan.example.json` and concrete copy/edit/start/tablet URL instructions in README. The sample IP is illustrative and must be replaced with a real host private LAN/Tailscale address. Loopback remains the default, wildcard/public binding is still rejected, and the trusted-network/no-login/no-TLS assumptions remain explicit. Changing HTTP address/port leaves Pi and its private bridge socket configuration alone.

Build/lint/test passed, including 44 Node checks and race-enabled Go tests. This incremental UI deletion/configuration-guide change did not start/reload/control any user Pi session, alter network/firewall settings or claim actual tablet/LAN acceptance. An RAI-only restart loads the rebuilt UI; the operator chooses the LAN IP/configuration. SSH-tunnel authority support remains a separate unresolved follow-up below.

### Requested UI design review — recommendations, not implementation authorization

The operator requested review with their UI design agent `01a1d587-c404-741f-93f4-b2167e31540d`. That agent performed read-only source/fixture review; no rendered/browser/tablet evidence, live endpoints/conversations, tests, deployment or file changes. The coordinator independently checked the relevant renderer/header code and discussed the findings with the designer.

Agreed minimal direction: **refine the existing light, moderately dense conversation UI, not redesign it**. Preserve current type/touch sizes, palette, one textarea with Send/Stop, connected-only chooser, quiet ordinary dispatch, hidden internal records, explicit errors, independent disclosures and deliberate older/latest navigation. No restoration of Review/draft recovery or diagnostic panels.

Recommended next implementation, pending operator direction:

1. Keep concise recipient-disambiguating context in the selected header, particularly for equal labels with different reachable contexts. The chooser currently has context but the closed header retains only the label; this is presentation ambiguity, not evidence of incorrect dispatch targeting.
2. Keep unchanged completed-history nodes intact during provisional-only updates. Current replaceChildren removes native-summary/load-button focus and risks text-selection disruption; exact browser selection behavior is unverified. Add keyed focus restoration for those controls when retained history actually changes. No framework/virtual-DOM rewrite.
3. Use plain Idle / Working / Waiting for input / Activity unknown labels, retain real freshness/error/gap warnings, and hide ordinary healthy history/persistence explanations. Keep idle-not-completion semantics in docs rather than a permanent caveat. Move opaque nested parent IDs inside the existing tool disclosure, without hiding meaningful boundaries/errors.
4. Before further density changes, agree a small synthetic rendered tablet/keyboard-open/200%-zoom check: long duplicate names/context, conversation/code/tool content, multiline input and one inline failure. Verify scrolling, reachable Send/Stop, no page-width overflow, focus/selection and latest behavior. This is proposed visual acceptance, not an observed geometry defect or renewed broad live-Pi gate.

The repeated Connected badge is optional polish only; do not shrink name/context text further to compensate. No UI code/runtime changes were made for this review; only this durable review note was recorded.

### Dreamcoat reassessment — proposed visual treatment

The operator asked why not use Dreamcoat. The UI designer and coordinator read the local specification at `/Users/ricardo/Documents/mau/dreamcoat/SKILL.md`, its font README, and `/Users/ricardo/Documents/mau/ui-design/README.md`. The private-tool companion is the applicable adaptation, not literal presentation-scale/Quantum Lab styling or official Google branding. The earlier recommendation to preserve the generic blue-grey palette was over-conservative and is superseded by this direction; functional/density constraints remain.

Proposed treatment: Cream ground/chrome, white assistant/reading/input surfaces, Sand user messages, Thistle/plum text, locally bundled Google Sans (regular/italic variable fonts with OFL), one yellow Send action with dark text, restrained outlined Stop/error, blue focus/selection, and secondary flat tool/disclosure rows. Keep current moderate spacing, 16px body and 44px targets. No artwork, textures, hero/display headlines, animations, framework, CDN or new dependency. This is a Dreamcoat-derived private working instrument, not a claim of official brand fidelity.

Actual font use requires bundling/serving the local licensed font files as font/ttf, @font-face 400–700, and CSP font-src self; naming an absent font is not implementation. Contrast and actual font loading/keyboard geometry require the small synthetic rendered check already proposed. The three usability fixes above remain necessary and should accompany rather than be replaced by visual styling. Source confidentiality/artwork restrictions remain intact; no external guide fetch/upload or neighboring-project mutations.

This is a design recommendation only, pending operator implementation direction. No UI/runtime changes were made during the reassessment.

### Dreamcoat implementation and bounded rendered validation — complete

The operator approved the Dreamcoat private-tool treatment with the three UI review fixes. The existing UI designer wrote only style.css and froze it; the coordinator integrated local fonts/server routes, context/status/DOM behavior, tests and docs. No production/Pi session was reloaded, controlled or inspected, and no LAN/firewall/runtime configuration changed.

- Local Google Sans normal/italic variable fonts and OFL are bundled unchanged; exact allowlisted font routes return font/ttf and the readable license. CSP adds only font-src self. Actual Chrome loaded both faces; no CDN, system installation, proprietary artwork or official-brand claim.
- Selected context persists through duplicate labels and renames. Completed-history nodes survive token-only updates; keyed summaries/load controls restore on actual redraw. Deferred loading uses focusable aria-disabled plus the existing duplicate-request guard, and conditional completion handoff does not steal focus after the reader moves away.
- Plain activity labels replace enum/debug caveats and timestamps; healthy history/persistence explanations are hidden. Loading, empty, stale, errors/gaps and meaningful boundaries remain. Parent IDs move inside tool disclosures. Existing composer, connected-only menu and quiet dispatch behavior are preserved.
- Source review caught native disabled loaders losing focus: fixed and tested. The designer's visual review also caught an initial 512×384 capture with clipped actions despite earlier metrics taken before the next token re-showed Go to latest. The fixture was corrected to measure the same settled capture state, and footer/composer flex allocation was minimally fixed rather than reducing text/touch targets. Final compact actions are y332–376 inside a384px viewport, with locally scrolling input; the designer cleared the corrected capture/source.
- A disposable loopback Node fixture served the same production assets/CSP with synthetic 20-turn data and mock APIs only; it was not a new production frontend or live Pi test. Chrome/webgrab captures at1366×900,834×1194,1024×420 and512×384 confirmed normal/italic fonts loaded, stable retained node/text selection/reading position, native summary focus, actual-redraw focus restoration, deferred handoff/no stealing/no duplicate fetches, visible context, scrollable history, full44px Send/Stop in viewport and no horizontal page overflow. Short-height/effective zoom viewports are proxies, not OS software-keyboard/native200%-zoom acceptance.
- Solid adjacent color checks passed: body text11.23+:1, secondary/disabled text5.63+:1, Send text9.24+:1, exception text6.06+:1, essential control boundaries3.08+:1 and focus against adjacent Cream/white5+:1. Decorative hairlines are not essential input boundaries. Representative synthetic screenshots are in docs/images; API MIME/CSP and controls are separately covered by Go tests, not inferred from the mock visual server.

The designer independently inspected rendered captures and coordinator JS/server changes, clearing the two concrete focus/layout corrections. Ordinary build/lint/test passed. Physical tablet touch/software keyboard, true browser zoom and full live history reconciliation remain provisional. All three coordinator-created fixture tabs were closed after capture; the user-owned UI designer session was not closed or otherwise managed. Final checks passed: build/lint, race-enabled Go packages and46 Node checks.

### Palette preview refinement

After seeing the running style, the operator explicitly requested Sand rather than white for the background, agreed to modest Send corners, and asked to see Cream cards. The current preview sets the ground to canonical Sand (#FCF2D5), both message-card roles to Cream (#FCF7E4), and Send inherits the ordinary0.55rem control radius. White input/control surfaces, type, spacing,44px targets and behavior are unchanged. Updated representative screenshots use the same synthetic Chrome conversation; desktop/tablet checks and ordinary build/lint/test pass. The combination remains for operator visual judgment, not a new design-system requirement. Existing configs/lan.json was user work and was not changed or included in this UI commit.

### Neutral reference preview — awaiting visual choice

The operator found the warm treatment too intense at full-screen scale and supplied `../../engine1/docs/engines/report-reference-v1.html` as the new reference. The coordinator and UI designer read that actual file without modifying engine1 or contacting its agents. Cream really is lighter than Sand; the concern is broad chroma and repeated emphasis, not cache or incorrect RGB.

A palette-only synthetic comparison is recorded at [desktop](images/rai-neutral-preview-desktop.png) and [tablet-sized](images/rai-neutral-preview-tablet.png): report-derived light-gray ground (#F1F4F8), white cards/chrome, dark text (#172335), secondary slate (#58667B), quiet rules (#DCE3ED), stronger achromatic control edges, navy Send and neutral ordinary controls. Existing font, dimensions, structure and behavior are unchanged. This is a preview, not a new production theme/configuration. No application source or running Pi/RAI configuration was changed; the owned temporary preview server/tab was closed.

The designer independently read both captures and judged this visibly calmer, with no concrete new blocker. Scale remains a separate question: repeated full-width rounded message panels may still feel heavy/form-like. If that remains the operator's reaction, compare flatter conversation grouping next, rather than another palette or smaller text/touch targets. Do not implement that speculative variant before this preview is judged. Synthetic Chrome interaction/layout checks passed for the preview; this is not physical-device or final aesthetic acceptance.

### Warm-neutral middle preview and input/context refinements

The operator liked the neutral direction but wanted some warmth back. A proposed low-chroma warm middle is captured at [rest](images/rai-warm-neutral-rest.png) and [focused/tablet-sized](images/rai-warm-neutral-focused.png): warm light-gray ground (#F5F3EE), near-white reading surfaces/chrome (#FDFCF9), quiet stone rules and a restrained slate Send. This palette remains a preview, not a production theme or a deployed change. The UI designer read the initial middle captures and judged the warmth/clarity balance useful with no new aesthetic correction needed. The operator still chooses the palette.

Explicitly requested behavior fixes ARE implemented: the real textarea collapses on blur without clearing its value; an inset focus edge replaces the clipped extra outer outline; compact field styling shows one clean line rather than a partial second line. Chooser/header context uses the last two working-directory folders, not opaque workspace/pane IDs. This is presentation only; endpoint/association control identities are unchanged. Normal Send and Stop dispatch stays quiet; genuine failures/uncertainty remain. The earlier preview's error was deliberate synthetic failure coverage, not a normal status. These new representative captures show normal state and recognizable sample project context instead of stress-fixture names/IDs.

The blur/value, folder-context/rename and quiet independent-Stop assertions pass in client tests (the focus shim now dispatches native-like blur transitions). Synthetic Chrome verified collapse/value preservation, human context, quiet feedback, inset focus, reachable controls and no page-width overflow at desktop and tablet-sized viewports; the final compact-field recapture was visually checked for one clean line. Build, lint and full tests passed. No live/private Pi conversation or service configuration was used; only owned temporary fixture tabs were closed. Physical keyboard/touch acceptance remains separate.

### Warm-neutral palette approved and adopted

The operator approved the middle preview: **“Nailed it. Well done.”** The production stylesheet now matches that proposal: warm light-gray ground, near-white cards/chrome, quiet stone boundaries, neutral ordinary controls and a slate Send with white text. Existing inset input focus, blur collapse, folder context and quiet normal dispatch remain. This is the single default palette, not a theme selector. README/design and their representative image links now describe this approved state. The embedded assets were rebuilt and focused CSS/render validation passed; no running RAI/Pi service or user configuration was changed. Restart only RAI when ready to load the rebuilt assets.

### Deferred follow-up: SSH tunnel access

The operator reports **Host not permitted** when accessing RAI through an SSH tunnel; currently they must remote-view the host machine to use the page. Record this as an unresolved access defect, not a requirement to use remote desktop. No tunnel/configuration/security changes were requested for this turn.

Likely cause: HTTP forwarding preserves the browser-facing Host, while RAI currently allowlists the listener IP/localhost at the listener port. A different local tunnel port or hostname will not match. The exact browser URL, local/remote forwarding endpoints and RAI listen address have not yet been checked; confirm them when addressing this. Support the intended tunneled browser authority while preserving Host/Origin/CSRF protections, rather than allowing arbitrary hosts or disabling the checks.

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

Approved envelope (historical first live phase):

1. **Resources:** one new disposable Herdr instance named `rai-bridge-validation` (never the default server), one new tmux server using the exact repo-local socket `.rai-investigation/live/tmux.sock`, and two new interactive Pi targets in each. Never replace an existing instance/socket/name; collision returns for a decision. No coordinator/worker/production panes are test targets. The validation owner alone manages these resources.
2. **Paths/service:** `.rai-investigation/live/` only for fixture extensions, per-target working/session directories, configuration and temporary files; a dedicated RAI service on `127.0.0.1:8485` with `.rai-investigation/live/rai.sock`. No `/tmp`, LAN/public listeners, production history reads, or installed Pi/settings changes. Bind failures return for a decision.
3. **Payloads/work:** synthetic conversations only, ordinary prompts such as `Reply with exactly RAI_OK; do not use tools`, exact whitespace/Unicode/multiline/command-looking strings, desktop draft sentinels, and a disposable fixture tool/input handler with an interruptible promise latch. The fixture may delay input/settlement or show a benign dialog to exercise the two accepted races, normal steering, Stop and unsupported-state feedback. Manual compaction/fork/tree/reload act only on these synthetic conversations. No external side-effect tools, task subagents, private data, or network writes beyond ordinary configured model requests.
4. **Faults:** disconnect/reconnect the disposable extension/service socket, stop/restart only this RAI test service, throttle a diagnostic reader, intentionally drop a control response, and replace/reload only the disposable Pi targets. Rename/nest the disposable panes, switch/fork synthetic conversations, and interrupt the fixture workload. Do not alter installed integrations, existing multiplexer instances, or production agent processes.
5. **Budget/cleanup:** first 20-minute identity/control phase per backend; if it passes, agree the next bounded acceptance phase for exact input, recovery and history integration. Cleanup closes only the exact returned test pane/instance IDs and removes only created files under `.rai-investigation/live/`; never stop the default Herdr server. Report failed/untested cases rather than widening authority.

**Current operator step:** the broad proposed second smoke phase was explicitly deferred, not required again. History and UI are implemented. A small real-browser conversation-loop check is the useful next acceptance step, with exact operator-chosen disposable/new targets if the agent runs it; physical tablet/keyboard and untested platform behavior remain provisional. Regular installation/loading into existing sessions remains the operator's decision. The accepted races require no special cancellation machinery or renewed feasibility gate.

**Cleanup:** RAI test service stopped; exact tmux test session `$0` on `.rai-investigation/live/tmux.sock` killed; named Herdr instance `rai-bridge-validation` stopped (`running=false`). Coordinator-created management tabs `w12:tA` / `w12:tB` and reviewer `w12:tC` were closed by their returned IDs; earlier reviewer `w12:t9` was already closed. No default server or pre-existing panes were stopped. All 32 inventoried repo-local live fixture/session files and the leftover tmux socket were removed successfully by exact path; ordinary build/dependency artifacts remain ignored. Herdr's stopped named-instance metadata remains managed by Herdr outside the repo-only file-cleanup envelope.

## 6. Coordinator start brief

> Work in this repository and read `docs/COORDINATION.md`, `docs/design.md`, `docs/design-notes.md`, this execution plan, and the current investigation findings. The selected direction is an independent web service plus an in-Pi TypeScript extension using the existing API. Herdr/tmux retain process ownership and provide labels/context. Do not restart the historical investigation plan or polish the design generally.
>
> This document is a plan, not an execution authorization. Follow the operator's actual assignment; this authoring request granted planning only. Once implementation is assigned, begin with P1: choose one service stack, record the concrete file/owner/wire boundaries, and establish supported build/lint/test workflows. Then implement P2 before the full UI. Request separate, exact authorization for disposable live validation; no installation/reload or control of existing agents is implied. Fixture-based work can proceed within implementation authority while live authorization is pending.
>
> Follow the slice dependencies and review points, maintaining a small status table and explicit platform coverage. Preserve the accepted delayed-Send/Stop limitation; do not create special-case cancellation machinery or require a new Pi API. Return a specific unresolved targeting or integration defect for decision rather than widening scope. After the validated bridge, implement history reconciliation, the read-only UI, conversational controls, and integrated acceptance in that order. Report actual checks, limitations and cleanup honestly.
