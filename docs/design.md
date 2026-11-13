# Remote Agent Interface: Initial Design

**Status:** Go service, TypeScript bridge, retained-history reader and vanilla browser conversation UI implemented with fixture/source reviews. First disposable macOS Herdr/tmux smoke passed; broader live/tablet acceptance remains untested, not a development gate after the operator's explicit deferral.
**Scope authority:** [Product brief and design notes](design-notes.md).
**Integration evidence:** [Investigation findings](investigation-findings.md). Use Pi's existing extension API. Live tests and extension installation require separate authorization.
**Target:** One user, one Linux/macOS host, tablet browser, existing interactive Pi sessions in herdr and tmux.

This design specifies the intended experience and logical boundaries. It does not establish undocumented multiplexer or Pi contracts. The delivery sequence is in §11 and implementation validation is in §10. Writing this document does not authorize experiments on existing agents.

## 1. Design position

RAI is a remote conversation and observation surface, not a remote terminal. A small extension inside each participating Pi provides current conversation identity, structured output, ordinary Send, and Stop. An independent RAI web service connects that extension to the browser. Herdr/tmux retain ownership of Pi processes and PTYs and supply existing human-readable labels; they are not the input or output transport.

The first version has two primary surfaces:

1. **Session list:** choose a running Pi session using its existing herdr/tmux label.
2. **Conversation:** read the conversation, enter a message, or tap **Stop** to interrupt the current turn and discard queued steering messages.

The conversation is one scrollable view combining existing saved history with structured ongoing response, thinking, and tool updates. The user should not have to navigate separate history and terminal panels. Joining live events to persisted entries still needs integrated verification; terminal scraping is not a fallback.

No session launcher, terminal keyboard emulator, generated summary, unread system, agent graph, process-termination control, or shutdown control is included. Stop interrupts Pi's current turn; it does not terminate Pi or promise to cancel independent workers.

## 2. Main user journey

1. Load the site and see a list of running Pi sessions, using their existing multiplexer names/labels.
2. Choose a session.
3. See its conversation near the newest content, with one compact real textarea and **Send** / **Stop** actions. The header names the selected conversation using its multiplexer label.
4. Focus the textarea to expand it for multiline editing and the tablet keyboard. No second input-like button remains on screen. The conversation remains scrollable.
5. Send a message. The composer collapses and the keyboard is dismissed; only actionable failure/uncertainty feedback appears in the footer; ordinary dispatch completes quietly. Pi receives the message as ordinary input or queues it as steering while working. Show **Steering queued** only when that state can actually be observed.
6. To see another conversation, tap the top-left menu button. The session list opens over the conversation; choosing a session closes it.

At any point, Stop interrupts the selected Pi turn and discards its queued steering messages. Closing the browser or losing connectivity does not stop Pi; reconnecting does not resend input.

The list is for running sessions, not a browser of archived conversations. If discovery fails, show that failure rather than implying no sessions exist. There is no global “all done” indicator; the user decides whether to leave the host running or return to a terminal.

## 3. Information architecture and layout

**Visual direction:** Operator-approved warm-neutral private working instrument,
not official branding or presentation-scale styling. The earlier Dreamcoat
palette was too intense; a neutral report reference then needed a little warmth
back. The approved middle uses warm light-gray ground (#F5F3EE), near-white
cards/chrome (#FDFCF9), white input/control surfaces, dark neutral text and quiet
stone rules. One compact slate Send has white text and modest corners rather
than a pill. Ordinary Stop/tool controls are neutral; reserve exception colors
for actual problems. Keep strong control/focus edges, Google Sans normal/italic
locally served under OFL, 16px body, 44px targets and moderate spacing. No artwork,
texture, display-scale headings, themes/settings, new framework or remote
resources. Code alone uses system monospace.

### 3.1 Conversation screen

```text
+----------------------------------------------------------------+
| [☰] coordinator · project-name Working                  [View] |
+----------------------------------------------------------------+
| ... conversation history ...                                   |
| User: ...                                                      |
| Assistant: ...                                                 |
| Tool: test [Expand result]                                      |
| ... ongoing response/tool activity where available ...          |
|                                                                |
| [New content below · Go to latest]                              |
+----------------------------------------------------------------+
| Actionable failures only, when needed                           |
| [Message… (one real textarea)]                                  |
|                                                [Stop] [Send]  |
+----------------------------------------------------------------+
```

Use this structure on tablet and desktop, widening the conversation rather than adding a separate activity panel. The conversation gets the remaining height. Operator feedback replaced the duplicate compact Message-like button plus expanded panel with one real textarea: one row at rest, three on focus, collapsing on blur without clearing text. Keep the focus edge inside the field, not a clipped extra outer ring. Send and Stop are the only composer actions. The operator removed the Review/draft-management workflow entirely; there is no receipt archive, reuse/dismiss gate or Clear/Close options menu. Escape preserves text and returns to one row; Send also collapses and blurs. Keep readable 16px body text/44px targets, but modest card padding/gaps rather than oversized panels. Tool/thinking disclosures remain within the conversation.

### 3.2 Session list and tablet keyboard

On first load, show the session list. After selection, show the conversation. The top-left menu button has the accessible label **Sessions** and opens the list as an overlay/drawer. Choosing a session closes it, updates the conversation header, and restores that conversation's draft with the editor initially collapsed. Closing it without choosing leaves the existing conversation unchanged.

The page must remain usable with the software keyboard open: conversation history remains scrollable, no composer or footer action is hidden behind the keyboard, no fixed viewport-height assumption, and no horizontal page scrolling. The footer is shrinkable with a flexible locally scrolling textarea and nonshrinking actions; the live/latest affordance must be included when checking short-viewport allocation, not measured before it appears. Code and tool output may scroll horizontally within their own blocks. Opening the session list does not submit or discard a draft.

### 3.3 Session list

Each row shows:

- The existing agent-assigned multiplexer label as the primary name, not a required Pi conversation name. In tmux, use the window name or pane title carrying that label; use the tmux session name as context where it describes a group of panes. Validate the equivalent herdr label mapping during bridge implementation.
- Project/directory context where available, with disambiguation for otherwise identical labels.
- A coordinator badge only when supported by a verified source, not inferred from activity, recency, or the first pane found.
- An activity label and its freshness; unknown is a valid state.

**Naming responsibility:** Existing herdr window names already help the user recognize the intended agent. Use those names, and the equivalent existing labels in tmux. Do not require agents to name Pi conversations too. If naming ever needs improvement, that belongs in agent instructions rather than a new RAI naming system; no instruction change is a prerequisite here.

RAI displays those labels consistently in the session list and conversation header. It does not infer assignments, generate names, parse roles from naming conventions, or maintain a second alias/renaming system. Unnamed or duplicate labels get available project/folder context and remain selectable; do not surface opaque workspace/pane IDs as navigation labels; the naming convention is not an admission requirement. If names are technically retrievable but still hard to recognize, improve the agent instructions rather than add naming machinery to RAI.

Use a stable ordering by display label and keep it steady across activity updates. No special coordinator selection step, unread badges, or message counters. If a label changes, update the displayed name without changing the selected target or moving a draft to another session.

The user does not have to understand multiplexers to choose a session. Existing names and brief context distinguish duplicate labels, and the selected row's context remains beside/below the header label after the chooser closes. Plain activity is visually separate; no persistent idle-not-completion caveat or observation timestamp is needed. The top-right Details debug panel and discovery diagnostics were explicitly removed by the operator; do not expose raw endpoint/session metadata in the normal UI. Do not use directory or display name as the send target.

The human-readable labels should make the coordinator and other agents recognizable in either multiplexer. A coordinator badge is optional when verified metadata already supplies the role; lack of role metadata does not add a warning or require a new designation workflow.

The browser chooser shows only currently connected RAI endpoints, not unreachable/unintegrated Pi candidates. Loading, no connected sessions, and lookup failure remain distinct. On lookup failure, show the error rather than stale unreachable choices. The backend can retain diagnostic discovery coverage internally/API-side; there is no Discovery details panel or unconnected-session section in the browser.

A selected conversation that loses its connection keeps its cached content and an unavailable indication until safely reassociated or explicitly changed, but is not offered as a reachable choice. Never silently redirect the conversation/composer. Extension loading remains explicit; no terminal-input fallback.

## 4. Conversation

### 4.1 History and reading behavior

Read Pi's existing saved history without modifying it. Display the currently selected conversation branch, not a chronological mixture of sibling branches. Show branch/compaction boundaries where they affect interpretation. Original completed entries remain available where retained and correctly associated; compaction summaries are not a replacement archive.

Presentation:

- User and assistant messages have clear roles and preserve paragraph/code formatting. Model/thinking configuration, internal custom data and system setup are session records, not normal chat: hide them by default. View → Show session records reveals quiet collapsed details without changing retained data, ancestry or paging. User-visible extension messages remain available; meaningful compaction/branch boundaries and known errors stay visible. Tools are secondary to the user/assistant exchange.
- Tool calls show the tool name and available arguments; tool results are expandable, with a compact preview and explicit error treatment.
- Tool results and thinking blocks start collapsed. Identify thinking only where the saved/live source explicitly exposes it; never infer or generate it. Expanding a block makes its retained content accessible, not silently truncated to the preview.
- Errors remain visible without opening a successful-looking collapsed card.
- Unsupported entry types or unavailable content have explicit placeholders rather than fabricated text or silent omission.
- History loading and history failure have their own states, independent of live activity. Hide healthy persistence/current-turn explanations; retain useful loading, empty, error and resynchronization text. Nested parent IDs belong inside the existing tool disclosure, not compulsory timeline metadata.
- Provisional-only updates do not recreate unchanged completed-history nodes, protecting native focus and text selection. An actual retained redraw restores keyed native summaries/load controls. A deferred loader remains focusable while aria-disabled; its existing request guard prevents duplicate fetches. Completion moves focus to the loaded disclosure/summary or a programmatic entry target only when the loader still owns focus, never after the user moved away.
- Historical approval requests, errors, and waiting messages remain historical. Do not style them as current pending prompts without fresh evidence.

**Expansion controls:** Use the disclosure/accordion pattern, without an exclusive-open restriction. Each tool-result or thinking block has a tappable summary row with a chevron and an expanded/collapsed state. Tap again to collapse; individual blocks are independent. Use real buttons with `aria-expanded` and descriptive labels, not a swipe gesture that conflicts with scrolling or text selection.

A **View** button in the conversation header opens a menu with explicit **Expand all tools**, **Collapse all tools**, **Expand all thinking**, and **Collapse all thinking** actions. A bulk action affects only its content type, including older entries loaded afterward and new entries arriving later. It resets individual choices for that type; individual toggles made afterward override the bulk setting for those blocks. Tool and thinking settings do not affect one another. These choices are per conversation for the lifetime of the open page. If the source cannot distinguish a type, explain that limitation rather than offering controls that pretend to expand it.

Open at the newest completed content. Load older content in bounded pages through **Load older messages** at the top. Preserve the visible reading anchor when prepending older messages or expanding/collapsing individual blocks. Bulk expansion/collapse should keep the current message anchored where possible; if its content is hidden, anchor to its disclosure header.

When the reader is already at the bottom, follow new conversation content, including ongoing output. When they scroll away, stop following and show **New content below · Go to latest**. This is a transient navigation affordance, not durable unread tracking. Receiving data or sending a message must not forcibly move someone reading older content.

On session switch, open the destination near its newest content. Exact reading-position restoration across reloads is not required.

### 4.2 Ongoing output in the conversation

Use the extension's `message_start/update/end` and `tool_execution_start/update/end` events to render a replaceable provisional turn at the conversation tail. Preserve tool-call identifiers, including parent identifiers for nested activity. Unknown content/result types have an explicit fallback display rather than guessed structure. Status stays in the header.

At a confirmed `turn_end`, use its persisted assistant/tool-result entry IDs and an authoritative branch snapshot to replace the provisional turn with saved content together. While the provisional turn is displayed, independently read history must not also append those same records. Keep only a completed-history cutoff and bounded current-turn state, not another transcript archive.

`message_end` is not a persistence boundary: it precedes saving, and later handlers may transform the content. Do not correlate by text similarity, a timer, or an incidental leaf observed during that event. Reconnect must resynchronize history and ongoing state together rather than replay a stream and hope it matches.

Verify joining mid-turn, interrupted/error turns, reconnect gaps, and transformations by later handlers during bridge implementation. Show **Live output unavailable** or an explicit synchronization gap when needed; do not fill gaps with terminal snapshots. Queued steering is shown only where observable. Historical prompts remain historical; only current evidence can establish pending input.

### 4.3 Activity vocabulary

Keep source health separate from agent activity. A disconnected browser must not turn “Working” into “Idle.”

| Label | Meaning and evidence requirement |
| --- | --- |
| Working | Pi reports active work through extension events/state, not merely recent output. |
| Waiting for input | A current Pi prompt event identifies an input-wait state. Extension UI prompt events do not cover every built-in selector; unsupported dialogs still require the terminal. |
| Idle | Pi reports settlement/idle. Use `agent_settled` and current state, not `agent_end` alone, which may precede retries or continuations. This does not mean the task is complete. |
| Unknown | No reliable current Pi state is available. Retained conversation content can still be read. |
| Unavailable / stale | The session or observation source cannot currently be reached; retain the last known observation and its timestamp. |
| Exited | The tracked Pi process is confirmed gone. This is not a task-success verdict. |

Use Pi state consistently for sessions under either multiplexer. Useful herdr-specific detail may appear in session details after its semantics are verified, but is not a substitute for current Pi state. Do not introduce a “safe to shut down” state or derive task completion from inactivity.

## 5. Composer and submission contract

### 5.1 Interaction

- One compact labeled textarea expands on focus and collapses on blur while preserving its value; Send and Stop are the only composer actions. No Review message dialog, receipt archive, draft options menu or reuse/unlock workflow. Enter inserts a newline; there is no keyboard-only requirement to send.
- The recipient is the selected conversation, named in the always-visible conversation header with enough context to distinguish identical labels. Do not duplicate it beside the composer or introduce a separate recipient selector.
- Edit/delete text normally in the textarea. Escape compacts it without deleting the text. Selecting/revisiting a conversation restores its page-local input in that single compact editor.
- Disable Send for empty/whitespace-only content, an unavailable or unverified target, a disconnected client, or an outstanding submission from this composer.
- Preserve the exact nonempty text, including newlines and special characters. Do not trim or interpolate it through a shell.
- Being busy alone does not disable Send. Submission uses Pi's ordinary steering behavior; validate it during bridge implementation.
- Ordinary conversational approvals use this composer. **Stop** is a separate footer action, available with the composer open or closed; no special approval interface, follow-up selector, or process-termination control is included.
- If a terminal-only dialog or unsupported input state is known to prevent safe ordinary submission, disable Send and explain that terminal action is required.

Keep one remote draft per Pi conversation/branch in page memory, keyed by identity rather than its mutable display name. Switching sessions requires no discard confirmation: leave the draft in its original conversation and restore it when the user returns. Reconnects and label changes preserve it while the page remains open. Closing or reloading the page discards drafts; no browser storage, cross-device sync, or recovery across page visits is required.

On Send, capture the exact draft, collapse the editor, dismiss the keyboard, and show progress in the footer. While the request is pending, its submitted text remains visible but temporarily read-only; Stop remains available. A dispatch-unconfirmed response clears the input without claiming acceptance. A known failure or uncertain outcome leaves text directly editable under the original conversation with inline feedback, without a Review step, mandatory lock, automatic retry or automatic keyboard opening. In-flight submissions and their outcomes stay associated with their original recipient when the user switches sessions.

Desktop and tablet may both be open, with one person typing at a time. Send bypasses the desktop editor; RAI does not lock desktop typing or navigation. Intentional conversation changes must invalidate stale browser selections (§7.2).

### 5.2 Direct input and desktop drafts

The candidate extension call is `pi.sendUserMessage(text, { deliverAs: "steer", expandPromptTemplates: false })`. It starts ordinary input while idle or steers while busy, without submitting the desktop editor. No clearing, pasting, key injection, or accidental desktop-draft concatenation is involved. Ordinary Send can leave a desktop draft untouched.

Pass the exact composed string without trimming or normalization. Disabling command/template expansion keeps command-looking text conversational. Existing Pi input extensions still run and may deliberately transform or handle it; RAI should preserve that behavior rather than bypass it. Verify whitespace, Unicode, multiline input, and extension transformations in disposable sessions.

This API returns void, not an acceptance promise. Input processing may continue asynchronously after the call returns. Do not await that return as proof of acceptance or wait for conversational completion before allowing Stop. Manual compaction has a distinct unsupported/rejected-input path that needs investigation; no terminal fallback or duplicate compaction queue is planned.

### 5.3 Submission feedback

Show only actionable failure/uncertainty feedback in the compact footer. While pending, the Send button reads **Sending…**; ordinary dispatch clears the input quietly without a Submitted/acceptance notice or invented Sent/queued confirmation. The underlying void API still provides no acceptance proof. The transport distinctions below define failure handling, not extra UI steps:

| State | UI and behavior |
| --- | --- |
| Sending | Collapse the editor and dismiss the keyboard. Keep the submitted text temporarily read-only and show Sending… on the disabled Send button. Prevent double taps from submitting twice. |
| Submitted; acceptance unconfirmed | The extension reports dispatch was attempted. Clear the input quietly; no visible success notice or archived receipt. The void API return does not prove acceptance, queueing, or execution. |
| Sent / Steering queued | Show only when the corresponding acceptance or steering-queue state is reliably associated with this submission. The ordinary history entry is authoritative for saved content; do not add a second permanent user message. |
| Not sent | Use only when failure is known to precede any input side effect. Preserve the text for an explicit retry. |
| Outcome unknown | Some input may have reached Pi, or the browser lost the response. Retain the text/recipient and say “Check the conversation or terminal before sending again.” Never retry automatically. |

Keep at most one latest inline Send failure/uncertainty per conversation, not normal success feedback or a receipt collection. Starting another deliberate Send replaces that feedback; Stop feedback is independent. One per-view Boolean preserves Stop eligibility if an earlier dispatch remains unconfirmed even when a later Send is rejected; no earlier message text/receipt archive is kept. A rejected/unknown result keeps text editable in the ordinary input with a warning. It does not require review, dismissal, reuse or unlocking before another manual Send. The operator explicitly removed that workflow. There is no recovery UI, copied receipt text or hidden receipt archive.

Refresh target identity/history/activity after reconnect before enabling Send. Never infer acceptance from matching text or retry automatically. There is no durable-delivery or exactly-once promise across restarts. Pending requests/results stay on their captured original conversation.

### 5.4 Stop

Stop uses Pi's existing interruption path to abort current work and discard queued steering. In the inspected TUI host, use `ctx.abort()` followed by `ctx.ui.setEditorText("")` to discard text restored from cleared queues. This may discard desktop editor text; an unsent RAI draft remains untouched.

- Keep Stop in the footer with the composer open or collapsed. No routine confirmation dialog.
- Enable it for a reachable, verified target whenever work or queued steering may remain. Disable it when known idle with no queued steering, or while its dispatch is pending; unknown activity alone does not disable it.
- Dispatch Stop promptly, including while a Send awaits feedback. Do not wait for a conversational response or history acknowledgment. Never automatically resend it.
- Show **Stop requested** when dispatch is known, then observed activity/settlement. A lost response means **Stop outcome unknown**.
- Stop does not terminate Pi or its multiplexer, undo completed actions, or promise cancellation of independent workers/background jobs.

Use the existing API; no additional Pi control API or queue manager is planned.

## 6. Disconnects, stale data, and accessibility

Browser connectivity, backend reachability, history availability, and current-activity freshness are separate indicators. Show failures where they affect the interface rather than replacing every issue with a generic disconnected banner.

On browser disconnect, retain already loaded content as stale, show the last update time, and disable Send and Stop. Preserve an unsent remote draft in the open page, bound to its original target. Explain that losing RAI connectivity does not itself stop Pi. On reconnect, rediscover the selected target and refresh its identity before enabling Send or Stop. Never automatically replay a pending Send or Stop request. If the service restarted or the target changed, do not restore an unverified send target from its old label.

If the selected Pi switches or forks conversations, invalidate the old history association. Show an explicit **Conversation changed** notice and load the newly verified branch. Do not continue displaying old history as if it belongs to the current process state. Retain any earlier draft under its original conversation identity, rather than silently carrying it into the new conversation. Do not copy old input into the changed conversation or introduce a recovery workflow. If the association is unresolved, display the limitation and disable Send until safe targeting is re-established.

Use semantic headings, labeled controls, visible keyboard focus, and touch targets of at least 44 CSS pixels. Status must use text, not color alone. Announce connection changes and submission outcomes with a polite live region; do not announce every token/redraw or steal focus when output arrives or connectivity returns. Tool/thinking disclosures and bulk View actions must be keyboard and screen-reader accessible. Render code with preserved whitespace and escaped content.

## 7. Logical architecture

```text
Tablet browser
  Session list | Conversation (history + ongoing output) | Send / Stop
                           |
                    RAI web service
                     /           \
          mux labels/context    local Unix socket
                |                    |
           herdr / tmux       extension inside Pi
                                     |
                          current state + saved history

Herdr/tmux owns Pi and its PTY, independently of RAI and the browser.
```

Use one independent web service and a small TypeScript extension running inside each participating Pi. The extension initiates a local connection to the service over a user-private Unix socket. No separate daemon per Pi, launcher, database, broker, permanent receipt store, or second transcript archive is needed. Keep only bounded current display state and ordinary page-local UI state.

### 7.1 Extension bridge and multiplexer context

The extension provides:

- Its current session file, session ID, leaf, and branch through the host's read-only session-manager context.
- Structured message/thinking/tool updates, current activity, and available prompt state.
- Ordinary Send and Stop through existing public extension controls.
- Initial and reconnect snapshots sufficient to synchronize saved history and the current turn.

Start connection work from `session_start`, not the extension factory. Clean up idempotently on `session_shutdown`. If RAI is absent, Pi must still start and work normally; reconnect observation when the service returns. Extension reload/replacement requires fresh endpoint association.

Herdr/tmux integration is limited to existing labels, pane/ownership context, and discovery of nonparticipating sessions. Use supported installed interfaces; do not infer identity from directory or recency. Do not capture/scrape terminal output, inject keys, take over an output pipe, or alter the user's pane. Basic label/rename mapping passed the first disposable smoke phase under both backends. Nested ownership still needs end-to-end validation.

### 7.2 Identity and target changes

Maintain a distinction between:

- **Live target:** the connected extension instance inside the existing Pi. Multiplexer labels and pane IDs provide context, not the direct recipient.
- **Conversation:** the session ID/file and current branch/position reported by that host.
- **Browser selection:** an opaque service reference to that endpoint and conversation association, never an arbitrary path, pane label, or command.

Use Pi's existing stale-context checks for runtime replacement rather than duplicate them. Reconnect/reload must reestablish the endpoint association; never reuse a browser selection solely because a label matches. Session switch, fork, and intentional tree navigation invalidate the old conversation association. Invalidate in `session_before_tree`, before the leaf moves; keep controls unavailable until the bridge's `session_tree` snapshot. A post-hook alone is too late when earlier handlers await. This never vetoes desktop navigation. A later handler cancelling navigation has no public cancellation-complete event, so remain conservatively unavailable until a later authoritative agent lifecycle event or explicit reload. Normal output advances the leaf too, so do not freeze an exact leaf ID for an entire run.

Installed Pi 1.5.2 reserves prompt preflight across awaited input handlers and rejects tree navigation during that span (#9154). Independent source review found a separate window: Send deferred while async `agent_settled` handlers run can start after same-file navigation, on the new branch. The operator explicitly accepted this additional narrow race during execution, alongside delayed Send-after-Stop. Neither is an atomic targeting guarantee. Use existing public controls without a RAI navigation lock, private APIs, load-order assumptions, or a Pi patch; live verification remains required.

When herdr and tmux views overlap, associate the extension with authoritative ownership context rather than listing it twice or choosing by directory. Ambiguous/unavailable associations stay visible and cannot become guessed control targets.

### 7.3 Read-only history

Use the extension host's read-only state or read existing JSONL bytes as data, with the current file/branch association supplied by the host. Do not accept arbitrary browser paths or call helpers that migrate, repair, or append to a live session (`SessionManager.open` and `loadEntriesFromFile` are unsuitable).

Walk `parentId` ancestry, not a branch summary's `fromId`, and key records by session plus entry ID because forks may retain IDs. Model-context projections are not complete history: they may omit summarized entries or apply context edits. Retain original completed content across compaction where stored; already-truncated output cannot be reconstructed.

For file reads, consume LF-complete records, wait for an incomplete tail, and report malformed completed records/unsupported formats. Page by bounded entries/bytes, with full retained result content available on expansion. Recheck the association on navigation and synchronize the history cutoff with ongoing output (§4.2). An in-memory index is sufficient; never maintain another permanent archive or modify source files.

### 7.4 Web boundary and lifecycle

The Go service embeds HTML/CSS/JavaScript and serves the browser and JSON boundary in one process: `GET /`, `/app.js`, `/model.js`, `/style.css`, `/health`, `/api/bootstrap`, `/sessions`, `/sessions/{endpointId}`. Browser polling refreshes complete observations, not an event replay stream. `GET /conversation/{endpointId}?association=...&before=...` combines one captured observation with a bounded completed-history page; `GET /conversation/{endpointId}/entries/{id}?association=...&offset=N` expands only that ancestry in UTF-8 chunks. The service rechecks the endpoint/association after file I/O. Paths never come from the browser. Reader errors remain separate from activity and do not become successful empty histories.

`POST /control` carries the exact captured target/request/text once through the existing bridge. It requires an Origin matching that request Host and current per-start `X-RAI-CSRF` secret from `/api/bootstrap`; all routes reject foreign origins/cross-site requests and use no-store, with no permissive CORS. Token/origin rejection is not authentication against a trusted-network peer. No control GET or automatic POST retry. CSP permits only self-hosted scripts/styles/connections, no active history HTML or automatic images/resources.

The page stores ordinary input, per-type disclosure preferences and one latest failure/uncertainty notice by session+association in memory only. A reconnect can rebind only through the same opaque association/session plus host PID evidence, followed by a fresh combined observation; replacement runtimes without that association require an explicit selection. Same-endpoint intentional navigation loads a new view without transferring old input. There is no Review/reuse dialog or receipt archive. Uncertain Send and Stop feedback coexist. Pure state logic lives in `model.js`, DOM/network coordination in `app.js`; DOM tests use development-only linkedom, not a separate production frontend stack.

The private Unix socket carries LF-delimited UTF-8 JSON, protocol version 1, maximum 1 MiB per frame. An extension first sends `snapshot` and thereafter replaces its observation with monotonically increasing sequence numbers. Each reconnect creates a fresh UUID `endpointId`; intentional tree navigation creates a fresh `associationId`, normal leaf advancement does not. A snapshot includes session ID/file, current leaf, completed cutoff, bounded provisional message/tools, persisted IDs at turn end, observed activity/prompt/manual-compaction state, observation timestamp, and explicit gap/limitation flags. Branch samples contain at most eight IDs/parents, not a competing history reader. `historyReady` and `turnOpen` make holdback explicit; legacy bridges without historyReady do not silently expose a guessed cutoff. Turn start opens a provisional turn, first assistant message_start captures the already-persisted preceding user/system leaf, and assistant/tool message_end never advances the cutoff. Confirmed turn_end atomically clears provisional content with persisted IDs and cutoff. Authoritative settled/idle reads with no open turn include later committed turn_end/agent_before_settle proposals; elapsed time is not persistence evidence. Before-tree invalidation clears readiness/cutoff/provisional content, not only controls. An extension loaded midturn admits missing pre-load state until an authoritative boundary. For a setup-only session, Pi has an in-memory leaf and planned filename but does not flush until a user/assistant message. The extension uses public getEntries to establish that conversation-start fact, latching true under the append-only session contract; metadata-only leaves are not reported as persisted cutoffs. The raw reader accepts a missing file as empty only for an authoritative nil cutoff, no paging cursor and no prior source observation. Saved/unavailable or previously observed missing sources remain errors. No new persistence flag, file reader in the extension, or synthetic transcript is introduced. Synthetic/source reviews cover these rules; full real-Pi reconciliation remains unaccepted.

A local diagnostic client may send one `control` frame on a separate connection to that same private socket: target `{endpointId, associationId}`, request ID, operation `send`/`stop`, and exact text for Send. The service forwards once to the selected connection, without retry; extension responses are `submitted_unconfirmed`, `stop_requested`, `rejected`, or `outcome_unknown`. Synchronous errors after entering a public void API are uncertain, not proven no-side-effect rejection. Loss after possible dispatch is uncertain. In-flight IDs exist only until response/disconnection/deadline, not as durable receipts or replay machinery. Stop has no dependency on Send completion.

Snapshots are coalesced rather than queued behind slow transport; skipped observations set `gap`. Oversized provisional content is explicitly unavailable for the rest of that turn. Initial join/reconnect uses the same complete snapshot; lack of pre-load current-turn content is stated rather than reconstructed. The raw reader plus captured safe-cutoff snapshot provide one projection to the browser. Synthetic replacement tests and source review passed; this is not a claim of full real-Pi history acceptance.

Maintain lightweight endpoint/session state for the list and detailed observations for the selected conversation. Extension event handlers must not block Pi on a slow browser or service: bound current-output buffering and resynchronize after a gap. Browser/service loss stops delivery, not Pi work.

After service restart, reconnect each extension and obtain a fresh combined history/current-turn snapshot. Never maintain a command outbox or replay Send/Stop. Report dispatch separately from acceptance; a transport request ID does not create a Pi acceptance receipt. Unexpected bridge/parser failures are visible errors, not successful empty results. Stopping RAI stops only RAI-owned work, never Pi or its multiplexer.

## 8. Deployment and security

Run one service on the same host as the multiplexers, under the user permitted to inspect those sessions. No Pi process spawning or session ownership transfer is part of startup. Existing agents keep running when the service stops.

Install the extension using Pi's supported global/project extension mechanism. It can load into future sessions normally; existing sessions require an explicit supported load/reload. Service startup does not install or inject it into existing Pi processes. The local socket must be accessible only to the owning user.

`rai serve -config PATH` reads JSON `{ "address": "127.0.0.1", "port": 8484, "socket": "/absolute/private/rai/bridge.sock" }`; omitted config uses loopback and `~/.local/state/rai/bridge.sock`. Its directory must be user-owned, non-symlink, mode 0700; socket is mode 0600. Startup holds a user-private per-socket flock until the listener closes, refusing concurrent owners, live sockets and non-socket/symlink paths. It recovers only an owned socket whose connection is refused, so a crash does not block LaunchAgent restart. The empty lock file remains in place to preserve one lock inode. Loopback remains the default. Explicit private LAN/Tailscale IPs are supported with the browser boundary; wildcard/public IP binding is refused. Use the configured literal IP and port in the browser. Loopback listeners additionally accept the exact `localhost` alias at the same port; private-network listeners do not. Origin must match the accepted request Host, not a different alias. Arbitrary DNS/proxy/TLS-origin configuration remains outside this small deployment surface.

No login or custom TLS is required by the trusted-network product assumption. Nevertheless, the service can direct agents with host privileges:

- Restrict exposure through the operator's LAN/Tailscale/firewall configuration; no public binding is implied safe.
- Require Origin to match the request Host and apply CSRF protection to state-changing requests. The operator chose simple trusted-LAN access without a Host allowlist; aliases need no registration, but DNS rebinding is not defended against. Private binding and Origin/CSRF checks are not authentication. Reject cross-origin WebSocket handshakes if used. No permissive cross-origin access and no GET endpoints that submit input or invoke Stop.
- Never interpolate user messages, paths, or labels into shell commands. Use literal argument/input mechanisms after verifying backend behavior.
- Treat conversation Markdown and tool output as untrusted display data. Escape/sanitize rendered content; do not execute terminal controls or arbitrary HTML. Avoid automatically loading remote images/resources from history.
- Do not log full conversations or submitted text by default. Ordinary operational logs can identify the failed source/operation without creating another transcript.

Browser-origin protections are not authentication and do not protect against an untrusted LAN client. If the network assumption changes, revisit the security model before exposure.

## 9. Stack decision

The in-Pi extension uses TypeScript and Node built-ins available in its host. Choose one independent web-service stack before implementing the bridge service; a new Pi API or another broad feasibility phase is not a prerequisite.

Choose a single stack capable of:

- A responsive tablet layout and accessible composer.
- Safe local process/socket interaction and read-only JSONL handling.
- Bounded history loading and modest live updates.
- Clear disconnect, submission, and Stop state handling and simple Linux/macOS deployment.

**Decision: Go standard library service, TypeScript extension with Node built-ins.** `net`, `net/http`, `encoding/json`, and read-only file I/O cover this workload without a service framework or runtime dependencies. Browser delivery stays in the same Go process. The extension imports Pi types only and is loaded as TypeScript by Pi.

Concrete ownership map (one coordinator currently owns all writes):

| Slice/owner | Paths |
| --- | --- |
| P1 coordinator/shared | `go.mod`, `package.json`, lockfile, `tsconfig.json`, `biome.json`, `Justfile`, `.gitignore`, `cmd/rai/`, `internal/config/`, `docs/`, `README.md` |
| P2 bridge owner | `extension/`, `internal/bridge/`, `internal/catalog/`, `internal/web/diagnostic.go` and focused tests |
| P3 history owner, handed back to coordinator | `internal/history/reader.go`, `reader_test.go`; projection integration stays in the existing extension snapshot + web adapter, not a competing reader/module |
| P4/P5 coordinator | `internal/web/app.go`, `internal/web/assets/{index.html,style.css,app.js,model.js}` and request/model/DOM tests |

`internal/bridge` owns Go wire structs and connected endpoint state; `extension/protocol.ts` owns the small matching TS wire types. This deliberate two-language boundary is checked with shared synthetic wire fixtures/tests, not a schema framework. No extension file-history parser. `Justfile` exposes build/lint/test; focused tests accept Go package paths, extension tests or browser JS test files. Dependencies use the manifest/lock and supported deps tool (fresh-clone installation in README); build type-checks the extension and produces the Go binary with embedded browser assets. The history reader rescans bounded raw data read-only, with an ephemeral offset index and bounded file identity/prefix-digest observations, never a transcript archive.

## 10. Implementation validation

### 10.1 Test boundary

Build the extension bridge as the first implementation slice, not a new API or a separate research framework. This design is documentation, not authorization to install/reload it into existing agents or run live tests.

Obtain explicit authorization for disposable Pi sessions, multiplexer instances, input payloads, and exact cleanup paths before live validation. Use repo-local `.rai-investigation/` directories and throwaway conversations, never existing coordinator/worker panes or `/tmp`. Fixture tests can be developed independently.

### 10.2 Bridge validation

| Area | Validate during implementation |
| --- | --- |
| Participation and labels | Connect an extension-hosted Pi under both herdr and tmux; show existing labels, missing-extension sessions, duplicate/renamed labels, and nested ownership without duplicate endpoints. |
| Conversation identity | Use host-reported session/file/branch state; check switch, fork, same-file navigation, reload/replacement, and stale selections, including navigation during input processing. Resolve the open navigation question in §7.2 before claiming safe targeting. |
| Send | Exercise exact Unicode/whitespace/multiline/command-looking input while idle and busy, existing input extensions, desktop drafts, and unsupported manual-compaction states. Keep dispatch and acceptance feedback distinct. |
| Stop | Verify the normal Pi interruption path, queued-steering discard, retained RAI draft, repeated taps, and continued Pi process lifetime. |
| History | Retrieve retained ancestry across branches/compaction; page long results; handle malformed records, incomplete append, UTF-8 boundaries, unavailable/replaced files, and unknown content without source mutation. |
| Ongoing output | Render structured response/thinking/tool updates; replace provisional turns using persisted IDs and branch snapshots. Test mid-turn join, interruption/errors, reconnect gaps, and later-handler transformations without duplicated messages. |
| State and recovery | Use current Pi activity/settlement/prompt evidence; distinguish unknown/stale. Restart the service, disconnect browser/socket, and slow a reader: Pi keeps working, observations resynchronize, and no controls replay. |

These checks define desired coverage. The first bounded live smoke has passed for ordinary controls/identity on macOS; synthetic/source review covers the new history/UI. Broader live/browser/tablet coverage remains provisional and is recorded in the execution plan. If a concrete integration defect blocks a requirement, bring that issue to the user rather than add a terminal fallback, private-API workaround, or new framework.

### 10.3 Implementation acceptance

As the bridge and UI are implemented, cover:

- Adapter behavior against disposable sessions on both Linux and macOS; keep untested platforms explicitly provisional.
- Fixture tests for history branch selection, compaction, tool errors, partial append, malformed records, and long result paging.
- Request tests for target invalidation, exact direct input, normal Pi interruption/steering discard, non-replay after uncertain failures, and rejection of state-changing requests from untrusted browser origins.
- Browser tests for session labels/renames, page-local per-conversation input restoration, absence of review/draft-management UI, input loss on page reload, double taps, composer collapse/keyboard dismissal after Send, footer feedback lifetime, disconnected Send/Stop, retained unknown-outcome text, and readable ongoing output within the conversation.
- Independent individual/bulk tool and thinking expansion, including entries loaded later, and scroll-anchor stability when loading older content, appending new messages, or expanding/collapsing output.
- Real tablet portrait/landscape and software-keyboard checks, plus keyboard/screen-reader navigation and malicious-content rendering tests.

## 11. Delivery sequence

1. Choose the independent web-service stack and concrete local bridge message boundary.
2. Implement the Pi extension bridge using the existing API: connection/lifecycle, host identity, structured observations, Send, and Stop. Validate it with separately authorized disposable sessions before building the full UI; no new Pi API is planned.
3. Implement read-only history paging and provisional-to-persisted conversation replacement against that bridge.
4. Build the session menu, conversation view, expansion controls, composer/drafts, and footer feedback.
5. Validate recovery, security boundaries, both multiplexer environments, and tablet interaction before regular use.

The integration direction is selected. Proceed in small implementation slices with focused validation; Linux/macOS support and end-to-end behavior remain unverified until tested.
