# Remote Agent Interface: Initial Design

**Status:** Initial design; UX specified, integration feasibility not yet demonstrated.
**Scope authority:** [Product brief and design notes](design-notes.md).
**Target:** One user, one Linux/macOS host, tablet browser, existing interactive Pi sessions in herdr and tmux.

This design specifies the intended experience and logical boundaries. It does not establish undocumented multiplexer or Pi contracts. Stack selection and production implementation follow the feasibility gates in §10. Writing this document does not authorize experiments on existing agents.

## 1. Design position

RAI is a remote conversation and observation surface, not a remote terminal. Multiplexers continue owning Pi processes and PTYs. RAI discovers those sessions, reads existing saved conversation history, observes available current activity, and submits ordinary Pi input through the owning multiplexer.

The first version has two primary surfaces:

1. **Session list:** choose a running Pi session using its existing herdr/tmux label.
2. **Conversation:** read the conversation, enter a message, or tap **Stop** to interrupt the current turn and discard queued steering messages.

The conversation is one scrollable view, including ongoing output where the integration can provide it. The user should not have to navigate separate history and terminal panels. Internally, saved history and terminal observations have different guarantees; presenting current output coherently is a feasibility requirement, not an assumed capability.

No session launcher, terminal keyboard emulator, generated summary, unread system, agent graph, process-termination control, or shutdown control is included. Stop interrupts Pi's current turn; it does not terminate Pi or promise to cancel independent workers.

## 2. Main user journey

1. Load the site and see a list of running Pi sessions, using their existing multiplexer names/labels.
2. Choose a session.
3. See its conversation near the newest content, with a compact **Message…** input affordance and **Stop** button. The header names the selected conversation using its multiplexer label.
4. Tap **Message…** to open the multiline composer and tablet keyboard. The conversation remains scrollable.
5. Send a message. The composer collapses and the keyboard is dismissed; submission feedback appears in the footer. Pi receives the message as ordinary input or queues it as steering while working. Show **Steering queued** only when that state can actually be observed.
6. To see another conversation, tap the top-left menu button. The session list opens over the conversation; choosing a session closes it.

At any point, Stop interrupts the selected Pi turn and discards its queued steering messages. Closing the browser or losing connectivity does not stop Pi; reconnecting does not resend input.

The list is for running sessions, not a browser of archived conversations. If discovery fails, show that failure rather than implying no sessions exist. There is no global “all done” indicator; the user decides whether to leave the host running or return to a terminal.

## 3. Information architecture and layout

### 3.1 Conversation screen

```text
+----------------------------------------------------------------+
| [☰ Sessions] coordinator · project-name Working [View] [Details] |
+----------------------------------------------------------------+
| ... conversation history ...                                   |
| User: ...                                                      |
| Assistant: ...                                                 |
| Tool: test [Expand result]                                      |
| ... ongoing response/tool activity where available ...          |
|                                                                |
| [New content below · Go to latest]                              |
+----------------------------------------------------------------+
| Submission feedback                                            |
| [Message…]                                             [Stop]  |
+----------------------------------------------------------------+
```

Use this structure on tablet and desktop, widening the conversation as space permits rather than adding a separate activity panel. The conversation gets the remaining height. Tapping **Message…** expands a multiline textarea with **Clear**, **Send**, and **Close** controls in the footer; Stop remains accessible in either state. Close hides the editor without discarding its draft. After Send, return to the compact footer. Tool and thinking output use expandable blocks within the conversation.

### 3.2 Session list and tablet keyboard

On first load, show the session list. After selection, show the conversation. The top-left menu button has the accessible label **Sessions** and opens the list as an overlay/drawer. Choosing a session closes it, updates the conversation header, and restores that conversation's draft with the editor initially collapsed. Closing it without choosing leaves the existing conversation unchanged.

The page must remain usable with the software keyboard open: conversation history remains scrollable, no composer or footer action is hidden behind the keyboard, no fixed viewport-height assumption, and no horizontal page scrolling. Code and tool output may scroll horizontally within their own blocks. Opening the session list does not submit or discard a draft.

### 3.3 Session list

Each row shows:

- The existing agent-assigned multiplexer label as the primary name, not a required Pi conversation name. In tmux, use the window name or pane title carrying that label; use the tmux session name as context where it describes a group of panes. Verify the equivalent herdr field during feasibility work.
- Project/directory context where available, with disambiguation for otherwise identical labels.
- A coordinator badge only when supported by a verified source, not inferred from activity, recency, or the first pane found.
- An activity label and its freshness; unknown is a valid state.

**Naming responsibility:** Existing herdr window names already help the user recognize the intended agent. Use those names, and the equivalent existing labels in tmux. Do not require agents to name Pi conversations too. If naming ever needs improvement, that belongs in agent instructions rather than a new RAI naming system; no instruction change is a prerequisite here.

RAI displays those labels consistently in the session list and conversation header. It does not infer assignments, generate names, parse roles from naming conventions, or maintain a second alias/renaming system. Unnamed or duplicate labels get available project/pane context and remain selectable; the naming convention is not an admission requirement. If names are technically retrievable but still hard to recognize, improve the agent instructions rather than add naming machinery to RAI.

Use a stable ordering by display label and keep it steady across activity updates. No special coordinator selection step, unread badges, or message counters. If a label changes, update the displayed name without changing the selected target or moving a draft to another session.

The user does not have to understand multiplexers to choose a session. A details disclosure provides backend, pane identity, working directory, and history availability for disambiguation and troubleshooting. Do not use directory or display name as the send target.

The human-readable labels should make the coordinator and other agents recognizable in either multiplexer. A coordinator badge is optional when verified metadata already supplies the role; lack of role metadata does not add a warning or require a new designation workflow.

Discovery distinguishes:

- **Loading:** enumeration has not completed.
- **No Pi sessions found:** both available backends were successfully checked.
- **Partially available:** one backend failed or could not be inspected; show which coverage is missing.
- **Unavailable:** discovery failed; do not present an empty list as authoritative.

A selected session that disappears remains visible as unavailable until the user selects another. Never silently redirect the conversation or composer to a different session.

## 4. Conversation

### 4.1 History and reading behavior

Read Pi's existing saved history without modifying it. Display the currently selected conversation branch, not a chronological mixture of sibling branches. Show branch/compaction boundaries where they affect interpretation. Original completed entries remain available where retained and correctly associated; compaction summaries are not a replacement archive.

Presentation:

- User and assistant messages have clear roles and preserve paragraph/code formatting.
- Tool calls show the tool name and available arguments; tool results are expandable, with a compact preview and explicit error treatment.
- Tool results and thinking blocks start collapsed. Identify thinking only where the saved/live source explicitly exposes it; never infer or generate it. Expanding a block makes its retained content accessible, not silently truncated to the preview.
- Errors remain visible without opening a successful-looking collapsed card.
- Unsupported entry types or unavailable content have explicit placeholders rather than fabricated text or silent omission.
- History loading and history failure have their own states, independent of live activity.
- Historical approval requests, errors, and waiting messages remain historical. Do not style them as current pending prompts without fresh evidence.

**Expansion controls:** Use the disclosure/accordion pattern, without an exclusive-open restriction. Each tool-result or thinking block has a tappable summary row with a chevron and an expanded/collapsed state. Tap again to collapse; individual blocks are independent. Use real buttons with `aria-expanded` and descriptive labels, not a swipe gesture that conflicts with scrolling or text selection.

A **View** button in the conversation header opens a menu with explicit **Expand all tools**, **Collapse all tools**, **Expand all thinking**, and **Collapse all thinking** actions. A bulk action affects only its content type, including older entries loaded afterward and new entries arriving later. It resets individual choices for that type; individual toggles made afterward override the bulk setting for those blocks. Tool and thinking settings do not affect one another. These choices are per conversation for the lifetime of the open page. If the source cannot distinguish a type, explain that limitation rather than offering controls that pretend to expand it.

Open at the newest completed content. Load older content in bounded pages through **Load older messages** at the top. Preserve the visible reading anchor when prepending older messages or expanding/collapsing individual blocks. Bulk expansion/collapse should keep the current message anchored where possible; if its content is hidden, anchor to its disclosure header.

When the reader is already at the bottom, follow new conversation content, including ongoing output. When they scroll away, stop following and show **New content below · Go to latest**. This is a transient navigation affordance, not durable unread tracking. Receiving data or sending a message must not forcibly move someone reading older content.

On session switch, open the destination near its newest content. Exact reading-position restoration across reloads is not required.

### 4.2 Ongoing output in the conversation

The user sees one conversation, not a completed-history panel plus a separate terminal panel. Ongoing assistant output and tool activity should appear at the bottom of that conversation where observable. Status stays in the conversation header.

This presentation still requires evidence about the underlying sources:

- Saved history supplies completed messages; it does not necessarily contain the response or tool progress currently visible in the terminal.
- Use structured ongoing content only if its role and identity can be established. Otherwise, a readable current-output block may appear inline at the conversation tail, labeled **Live terminal view** rather than attributed to an assistant or tool without evidence.
- An inline terminal view is a replaceable current snapshot, not a transcript of every redraw. It must not force the user to switch to another pane.
- Reconcile provisional output with completed history only when identity/ordering evidence supports it. Do not deduplicate by text similarity or leave duplicated full messages as the intended steady-state experience.
- Streaming partials, tool progress, and queued steering appear only if observable. Say **Live output unavailable** or **Queue visibility unavailable** when relevant, rather than implying completeness.
- Historical prompts remain historical; only current evidence can establish a pending-input state.
- If neither structured ongoing content nor a readable inline current view can be provided, the feasibility gate fails. Revisit the integration with the user instead of quietly dropping live visibility or restoring the split-panel UX.

No terminal keyboard emulator or clickable terminal controls are provided. Stop and Send are explicit actions on the selected Pi session, not controls embedded in captured terminal content.

### 4.3 Activity vocabulary

Keep source health separate from agent activity. A disconnected browser must not turn “Working” into “Idle.”

| Label | Meaning and evidence requirement |
| --- | --- |
| Working | A verified source reports active Pi work; not merely recent terminal bytes. |
| Waiting for input | A verified source identifies an input-wait state. Ordinary conversational input may be possible; special dialogs may still require the terminal. |
| Idle | A verified source reports no active turn. This does not mean the task is complete. |
| Unknown | No reliable agent-state evidence is available. Recent output can still be shown separately. |
| Unavailable / stale | The session or observation source cannot currently be reached; retain the last known observation and its timestamp. |
| Exited | The tracked Pi process is confirmed gone. This is not a task-success verdict. |

Expose useful herdr-specific state detail in session details only after its semantics are verified. Do not assign equivalent states to tmux based on a quiet screen. Do not introduce a “safe to shut down” state or derive task completion from inactivity.

## 5. Composer and submission contract

### 5.1 Interaction

- A compact **Message…** control opens a normal labeled multiline textarea with **Clear**, **Send**, and **Close** controls. Enter inserts a newline; there is no keyboard-only requirement to send.
- The recipient is the selected conversation, named in the always-visible conversation header with enough context to distinguish identical labels. Do not duplicate it beside the composer or introduce a separate recipient selector.
- Clear empties only this conversation's unsent draft. Close collapses the editor without clearing it. When a saved draft exists, the compact control reads **Continue draft…**.
- Disable Send for empty/whitespace-only content, an unavailable or unverified target, a disconnected client, or an outstanding submission from this composer.
- Preserve the exact nonempty text, including newlines and special characters. Do not trim or interpolate it through a shell.
- Being busy alone does not disable Send. Submission uses Pi's ordinary interactive steering behavior, verified by the feasibility tests.
- Ordinary conversational approvals use this composer. **Stop** is a separate footer action, available with the composer open or closed; no special approval interface, follow-up selector, or process-termination control is included.
- If a terminal-only dialog or unsupported input state is known to prevent safe ordinary submission, disable Send and explain that terminal action is required.

Keep one remote draft per Pi conversation/branch in page memory, keyed by identity rather than its mutable display name. Switching sessions requires no discard confirmation: leave the draft in its original conversation and restore it when the user returns. Reconnects and label changes preserve it while the page remains open. Closing or reloading the page discards drafts; no browser storage, cross-device sync, or recovery across page visits is required.

On Send, capture the exact draft, collapse the editor, dismiss the keyboard, and show progress in the footer. While the request is pending, its submitted text can be reviewed but not edited or cleared; Stop remains available. Once delivery/acceptance is established at the reported boundary, clear that submitted draft. A known failure or uncertain outcome retains the text under the original conversation for deliberate review/reuse, without reopening the editor or keyboard automatically. In-flight submissions and their outcomes stay associated with their original recipient when the user switches sessions.

Desktop and tablet may both be open, but the operating assumption is one person typing in one place at a time. RAI serializes its own submissions to a target; it does not claim to lock out desktop typing. The user must not type in the desktop editor while a remote submission is being applied.

### 5.2 Desktop drafts and exact input

An unfinished desktop draft may be discarded, but must never be prepended to or accidentally submitted with the remote message. The verified submission operation must establish the intended ordinary editor state, replace a disposable draft, insert literal multiline text, and invoke normal submission without triggering unintended key bindings.

This is a feasibility requirement, not a presumed sequence of keys. If it cannot be established safely through the multiplexer, the integration direction must be revisited. Do not compensate with an unverified “clear line, paste, Enter” recipe.

### 5.3 Submission feedback

Show brief feedback in the compact conversation footer, independently of the collapsed composer. **Sending** means the request is in progress; **Sent** or **Steering queued** requires evidence of the corresponding Pi state. When the integration proves only terminal delivery, use **Input sent; acceptance unconfirmed**. The distinctions below define failure handling, not extra steps in the user journey:

| State | UI and behavior |
| --- | --- |
| Sending | Collapse the editor and dismiss the keyboard. Keep the submitted text read-only for review and show pending feedback in the footer. Prevent double taps from submitting twice. |
| Input sent | Use only when the verified multiplexer input operation reports success. Clear the editable draft, retain a temporary receipt with the exact submitted text, and say “Input sent; acceptance unconfirmed.” This does not prove acceptance or execution. |
| Sent / Steering queued | Show only when the corresponding acceptance or steering-queue state is reliably associated with this submission. The ordinary history entry is authoritative for saved content; do not add a second permanent user message. |
| Not sent | Use only when failure is known to precede any input side effect. Preserve the text for an explicit retry. |
| Outcome unknown | Some input may have reached Pi, or the browser lost the response. Retain the text/recipient and say “Check the conversation or terminal before sending again.” Never retry automatically. |

**Feedback lifetime:** A confirmed **Sent** status clears after five seconds, or when the next Send/Stop action begins. A verified **Steering queued** status remains until observation shows the message was consumed or discarded; if queue observation is lost, mark it unconfirmed instead of silently declaring it consumed. Failure, acceptance-unconfirmed, and outcome-unknown notices do not time out: they remain until resolved or explicitly dismissed. Each conversation retains its own feedback while the page is open; switching sessions never shows another conversation's receipt.

A temporary receipt with exact submitted text remains accessible from **Review message** in the footer while sending, acceptance is unconfirmed, or delivery is failed/unknown. Dismissing a notice is not a retry and does not send anything. This is page-local state, not a second history archive. Lack of a new history entry is not proof that input was rejected, especially while Pi is busy. Matching message text alone is not reliable confirmation because repeated messages are legitimate.

After reconnecting, refresh history and current activity before inviting a retry. If reliable confirmation is unavailable, keep the uncertainty explicit and allow the user to dismiss the receipt or deliberately reuse the text. There is no promise of durable delivery receipts or exactly-once submission across service restarts. Disable replay/automatic retries in the browser-to-service submission path as well as the backend adapter.

### 5.4 Stop

**Stop** interrupts the selected Pi session's active turn and discards all steering messages pending at the stop boundary. Discarded steering must not start another turn after the interruption. This is a required combined behavior, not a conversational request to stop and not merely an abort operation that leaves steering queued.

- Keep Stop in the footer, available with the composer open or collapsed and accessible with the tablet keyboard open. No routine confirmation dialog; the purpose is immediate interruption.
- Enable it for a reachable, verified target whenever work or queued steering may remain. Disable it if the session is known idle with no queued steering, or while the stop operation is already pending. Unknown activity alone does not make Stop unavailable.
- Keep it usable while a Send request awaits feedback. Order the actual per-target input/stop operations so Stop applies after any already-started submission and before further sends. Do not wait for a conversational response or a history acknowledgment to issue Stop. Disable new sends while stopping.
- Show **Stopping…** during the operation. Show **Stopped · steering cleared** only when both interruption and queue clearance are established. Otherwise show the known result and identify the unconfirmed part; a lost connection means **Stop outcome unknown**, not success.
- Stop does not terminate the Pi process, kill its multiplexer, undo actions already taken, or promise cancellation of independently running workers/background jobs.
- An unsent remote composer draft is not queued steering and is retained. Pending-steering UI is cleared only after the underlying discard is confirmed; never replay discarded text automatically.

Verify the installed Pi/multiplexer interrupt and queue-discard mechanisms and their ordering. Do not assume a particular key, signal, or repeated escape sequence implements this contract. If an in-progress Send may only have partially applied text, Stop must still interrupt safely without submitting those fragments. A partial success, such as interrupting without clearing steering, does not pass the Stop gate.

## 6. Disconnects, stale data, and accessibility

Browser connectivity, backend reachability, history availability, and current-activity freshness are separate indicators. Show failures where they affect the interface rather than replacing every issue with a generic disconnected banner.

On browser disconnect, retain already loaded content as stale, show the last update time, and disable Send and Stop. Preserve an unsent remote draft in the open page, bound to its original target. Explain that losing RAI connectivity does not itself stop Pi. On reconnect, rediscover the selected target and refresh its identity before enabling Send or Stop. Never automatically replay a pending Send or Stop request. If the service restarted or the target changed, do not restore an unverified send target from its old label.

If the selected Pi switches or forks conversations, invalidate the old history association. Show an explicit **Conversation changed** notice and load the newly verified branch. Do not continue displaying old history as if it belongs to the current process state. Retain any earlier draft under its original conversation identity, rather than silently carrying it into the new conversation. Require an explicit review/use action before sending that old draft to the changed conversation. If the association is unresolved, display the limitation and disable Send until safe targeting is re-established.

Use semantic headings, labeled controls, visible keyboard focus, and touch targets of at least 44 CSS pixels. Status must use text, not color alone. Announce connection changes and submission outcomes with a polite live region; do not announce every token/redraw or steal focus when output arrives or connectivity returns. Tool/thinking disclosures and bulk View actions must be keyboard and screen-reader accessible. Render code with preserved whitespace and escaped content.

## 7. Logical architecture

```text
Tablet browser
  Session list | Conversation (history + ongoing output) | Send / Stop
                           |
                 RAI web service (one host)
                 /          |             \
        discovery/control read-only     browser updates
        + observation     history reader + request handling
          /       \          |
       herdr      tmux    existing Pi JSONL
          \       /
       existing interactive Pi processes
       (PTY/process lifetime owned by multiplexers)
```

Implement the backend distinctions as small modules/functions with a shared logical contract, not a general plugin framework or separate services. A database, broker, second archive, and agent extension are not required. Runtime session observations and UI receipts can be ephemeral.

### 7.1 Multiplexer integration

Each backend must support, using verified installed interfaces:

- Discover candidate Pi processes at pane granularity and report partial failures.
- Resolve a target identity and associated conversation evidence.
- Observe current output and report the actual guarantees of its status source.
- Submit exact ordinary input to a revalidated target and report established success/failure boundaries.
- Interrupt its current turn and discard pending steering, with verified ordering and outcome reporting.

The contract describes outcomes, not CLI syntax. Do not copy command examples from superseded drafts. Prefer nonintrusive observation; do not take over an existing tmux output pipe. Do not resize, attach interactively, clear history, or alter a user's pane merely to obtain a cleaner display.

A backend may provide richer status than another. Present capability differences explicitly rather than synthesizing unsupported parity. Both backends must still pass the core discovery, history association, readable conversation, submission, and Stop gates for the stated first-version scope.

### 7.2 Identity and target changes

Maintain a distinction between:

- **Live target:** backend instance/socket, pane, and evidence identifying the current Pi process rather than a recycled pane or an unrelated foreground program.
- **Conversation:** the current saved session file and selected branch/leaf, with evidence linking them to that live target.
- **Browser selection:** an opaque service-issued reference to the verified target/association, never a free-form path or shell command.

Display names, directories, and file recency are not identities. Revalidate the selected target before applying input or Stop. A stale browser association must fail visibly rather than retarget to a newly discovered process or conversation. The feasibility work must establish what protects the interval between validation and input; a preflight check alone does not prove race-free targeting.

When herdr and tmux views overlap, do not list the same Pi twice if authoritative process/ownership evidence can deduplicate it. If ownership or identity is ambiguous, expose the limitation and do not choose a send target by guesswork.

### 7.3 Read-only history

Read existing files as data; do not invoke helpers that may migrate, repair, or append to a live session. Resolve paths server-side from verified identity evidence rather than accepting arbitrary browser file paths.

Handle concurrent append: consume complete records, wait for an incomplete trailing record, and report malformed completed records or unsupported formats. Recheck associations on session switch/fork/branch changes. Select the appropriate ancestry from Pi's entry graph, not every record in file order. Keep retained completed content accessible across compaction without inventing content that is no longer available.

The parser/index can be in memory and rebuilt. It should support paging long histories without sending the entire session to the browser. Do not persist a parallel copy or write repair results into the source file. Validate with representative session fixtures before depending on installed library internals.

### 7.4 Web boundary and lifecycle

The web layer carries bounded history pages, ongoing observations, source health, and explicit Send/Stop results. Stack-native HTTP requests and live updates are sufficient; exact endpoints and polling/streaming choices follow the stack decision.

Watch only what is needed: lightweight discovery for the list and detailed history/output observation for the selected session. Start with snapshots rather than inventing a raw-PTY pipeline. Stop observation work when it is no longer needed. Stopping RAI must only stop RAI-owned work, never Pi or its multiplexer.

The request handler orders RAI-originated Send/Stop operations for each target, gives Stop priority over further sends, and does not replay either operation following an uncertain failure. It does not claim a durable deduplication guarantee. Unexpected adapter/parser failures should be visible operational errors, not successful empty results.

## 8. Deployment and security

Run one service on the same host as the multiplexers, under the user permitted to inspect those sessions. No Pi process spawning or session ownership transfer is part of startup. Existing agents keep running when the service stops.

Provide a standard configuration file with a listening address and port. The conservative default is loopback; the operator explicitly chooses a LAN/Tailscale listening address for tablet access. Exact file location/schema and packaging follow stack selection. Do not add configuration for every implementation detail.

No login or custom TLS is required by the trusted-network product assumption. Nevertheless, the service can direct agents with host privileges:

- Restrict exposure through the operator's LAN/Tailscale/firewall configuration; no public binding is implied safe.
- Validate permitted Host/Origin values and apply framework-appropriate CSRF protection to state-changing requests. Reject cross-origin WebSocket handshakes if used. No permissive cross-origin access and no GET endpoints that submit input or invoke Stop.
- Never interpolate user messages, paths, or labels into shell commands. Use literal argument/input mechanisms after verifying backend behavior.
- Treat conversation Markdown, tool output, and terminal text as untrusted display data. Escape/sanitize rendered content; do not execute terminal controls or arbitrary HTML. Avoid automatically loading remote images/resources from history.
- Do not log full conversations or submitted text by default. Ordinary operational logs can identify the failed source/operation without creating another transcript.

Browser-origin protections are not authentication and do not protect against an untrusted LAN client. If the network assumption changes, revisit the security model before exposure.

## 9. Stack decision

Do not select a language based on an imagined streaming API. First prove the multiplexer and history contracts with the smallest disposable harness using actual supported interfaces.

After the gates, choose a single stack capable of:

- A responsive tablet layout and accessible composer.
- Safe local process/socket interaction and read-only JSONL handling.
- Bounded history loading and modest live updates.
- Clear disconnect, submission, and Stop state handling and simple Linux/macOS deployment.

Elixir/Phoenix LiveView and Go remain candidates. Compare one concrete minimal implementation shape for each against the proven integration requirements. Do not combine both or add a separate frontend service without a demonstrated need. Record the selected stack and resulting module/wire boundaries as a revision to this design, not as an assumed integration guarantee.

## 10. Feasibility and verification plan

### 10.1 Experiment boundary

Before running live tests, obtain explicit authorization for disposable test Pi sessions, their multiplexers, input payloads, and cleanup. Use test directories and throwaway drafts. Do not inject text into the coordinator, existing worker sessions, or production conversations. Reading documentation and implementing fixture-based tests do not require interacting with live agents.

First inspect the installed supported interfaces. Then use a minimal harness that records observed behavior and failures; no production dashboard or elaborate evidence system is needed. Record conclusions and resulting decisions in repository Markdown.

### 10.2 Gates and decisions

| Gate | Minimum experiment / pass condition | Decision if it fails |
| --- | --- | --- |
| Discovery and identity | Discover Pi panes in both backends; distinguish multiple sessions in one directory, multiple windows/panes, replaced/exited processes, and overlapping multiplexer visibility. Establish authoritative current file/branch association through session switch, fork, and branch navigation. | Revisit the selected integration or required coverage. Never substitute recency/path guessing. |
| Session labels and recognition | Retrieve agent-assigned labels in both herdr and tmux, distinguish same-name/unnamed panes, and retain selection through renames. With representative labels, verify the user can recognize the intended coordinator or worker without decoding backend IDs. Confirm which label field each backend exposes; a Pi conversation name is not required. | Fix the adapter if labels are missing or mapped incorrectly. If existing labels prove unhelpful, discuss an agent-side naming adjustment; no Pi conversation naming or instruction change is assumed necessary. Do not add generated names or a separate alias system to RAI. |
| Historical catch-up | Retrieve completed messages and tool results after they leave scrollback; traverse only the selected branch; handle compaction, long results, concurrent append, partial trailing records, and unavailable history without writing to the source. | Revisit history integration; terminal capture alone does not pass. |
| Conversation with ongoing output | Observe streaming text and tool output under redraws, wrapping, and resizing without disturbing the pane or taking over an existing output pipe. Demonstrate a readable single conversation with structured live content or an inline current view; establish how provisional content relates to saved messages without guessed merging. | Revisit observation/integration if this cannot be presented coherently; a separate history/terminal panel is not the agreed default UX. |
| Exact input | While idle and busy, send literal single/multiline messages, Unicode and special characters, with/without a disposable desktop draft. Check Pi receives exactly the intended content and uses ordinary steering. Include unsupported prompt/dialog states. | Stop the input path; revisit the integration with the user rather than adding guessed key recipes. |
| Stop and steering discard | Stop an active turn with multiple queued steering messages; verify no pending steering starts another turn. Also test idle-with-queue, a Send already in progress, partial input, repeated taps, interruption/clearance partial failure, and connection loss. Pi remains alive; both interruption and queue discard must work in both backends. | Revisit the control integration. Conversational stop, process termination, and abort-with-queue-retained do not meet the requirement. |
| Stale target | Switch conversations and replace/exit Pi between browser selection and Send/Stop; investigate the validation-to-control race using only disposable targets. Neither action may reach the wrong process/editor. | No production control until the target guarantee is established or the integration requirement changes. |
| Acknowledgment | Test failures before input, during a multi-step operation, and after input but before the browser response. Establish which successes/failures are actually observable. | Narrow success wording and use outcome-unknown states. If safe non-replay behavior is impossible, revisit submission integration. |
| Status | Verify herdr state semantics and any tmux/Pi evidence. Demonstrate unknown and stale states rather than deriving idle/completion from silence. | Use unknown plus current observations; confirm that the remaining visibility meets the workflow. |
| Lifetime and recovery | Close browser, disconnect network, restart RAI, and rediscover the correct current session/history. Pi continues; neither Send nor Stop is replayed and no unverified target is restored. | Fix lifecycle/selection boundaries before implementation proceeds. |

A failed gate triggers an explicit decision with the user. Neither a required extension/launcher nor terminal-only history may be introduced silently. Passing on one multiplexer does not establish support for the other.

### 10.3 Implementation acceptance

Once integration contracts and stack are selected, cover:

- Adapter behavior against disposable sessions on both Linux and macOS; keep untested platforms explicitly provisional.
- Fixture tests for history branch selection, compaction, tool errors, partial append, malformed records, and long result paging.
- Request tests for target invalidation, literal input, Send/Stop ordering, interruption plus steering discard, non-replay after uncertain failures, and rejection of state-changing requests from untrusted browser origins.
- Browser tests for session labels/renames, page-local per-conversation draft restoration, Clear/Close, draft loss on page reload, double taps, composer collapse/keyboard dismissal after Send, footer feedback lifetime, disconnected Send/Stop, retained unknown-outcome text, and readable ongoing output within the conversation.
- Independent individual/bulk tool and thinking expansion, including entries loaded later, and scroll-anchor stability when loading older content, appending new messages, or expanding/collapsing output.
- Real tablet portrait/landscape and software-keyboard checks, plus keyboard/screen-reader navigation and malicious-content rendering tests.

## 11. Delivery sequence

1. Review this conversation-first UX and the Send/Stop behavior.
2. Authorize and run the bounded feasibility work; record actual contracts and remaining limitations.
3. Select the stack and replace provisional integration details with evidence-backed decisions.
4. Build the session list and read-only conversation, including ongoing output; validate tablet catch-up and menu navigation.
5. Add exact, revalidated Send and Stop with their outcome feedback only after their gates pass.
6. Validate recovery, security boundaries, and tablet interaction before regular use.

The design is ready to guide feasibility and UX review. It is not a claim that arbitrary already-running Pi sessions can yet be identified and controlled safely through both multiplexers.
