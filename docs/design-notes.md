# Remote Agent Interface (RAI): Product Brief and Design Notes

**Status:** Product scope confirmed; architecture and integration feasibility unproven.
**Target:** One user, one Linux/macOS host, tablet browser, trusted LAN or Tailscale.
**Stack:** Not selected. Elixir/Phoenix LiveView and Go remain candidates.
**Initial design:** [Architecture, tablet UX, and feasibility plan](design.md). Integration assumptions remain provisional.
**Operator clarification after I1:** Herdr/tmux provide process durability, not a required input transport. Investigating a Pi-side extension for direct state, output, Send, and Stop is explicitly allowed. The operator subsequently accepted using Pi's existing controls with a documented Stop timing limitation: a Send still delayed in input processing may arrive after Stop. A Pi API change is not a prerequisite to a prototype. This does not authorize live tests or installation into existing sessions; see [current findings](investigation-findings.md).

This document replaces the initial architecture draft and its later update. Requirements below reflect the product discussion; candidate mechanisms are not established integration contracts.

## 1. Purpose and primary workflow

Pi agents are running, usually under a coordinator in herdr, sometimes in tmux. The user is away from the computer or prefers using a tablet.

The user needs to:

1. Find the coordinator or another running Pi session.
2. Understand what has happened and what is happening now.
3. Respond conversationally to unblock or approve work, redirect it, or say that work should stop for now.
4. Decide whether the machine should keep running or whether returning to a terminal is necessary before shutting it down for the night.

RAI provides information, ordinary Pi messaging, and a Stop action that interrupts the selected turn and discards queued steering. It does not decide that a machine is safe to shut down or perform shutdown itself.

## 2. Confirmed first-version scope

### Sessions and ownership

- Support existing interactive **Pi sessions in both herdr and tmux**. General terminal programs and other agents are not targets.
- Present sessions using their agent-assigned herdr/tmux names or labels, with context to distinguish duplicates or unnamed panes. Pi conversation names are not required. Labels may change without changing the selected target's identity. The user should not have to care which multiplexer backs a session.
- Existing herdr window names already help the user recognize the intended coordinator or worker. RAI should use those names and equivalent existing tmux labels; asking agents to name Pi conversations too is unnecessary. RAI adds available disambiguating context but does not generate names, infer assignments, or maintain separate aliases. Unnamed sessions remain supported. If naming ever needs improvement, address it in agent instructions, not utility-side naming machinery; no instruction change is a prerequisite.
- The desired coverage is any running Pi session within these multiplexers, not just sessions started by RAI. Reliable discovery and identification remain feasibility gates.
- Multiplexers retain ownership of PTYs and Pi processes. Closing the browser, losing connectivity, or restarting RAI must not stop those sessions.
- Desktop and tablet views may remain open; one person types at a time.

### Output and history

- Show one scrollable conversation with messages, tool activity/results, errors, pending input where available, and ongoing output. Do not require separate history and terminal panels. Tool results and thinking blocks should expand/collapse individually and independently by type, including expand/collapse-all controls for each type, where the source supports identifying them. Presenting history and ongoing output coherently remains a feasibility gate.
- Provide the saved conversation history, opening near the newest content with older history available. Current terminal scrollback alone is insufficient: important information may have scrolled away between visits.
- No separate unread-tracking system, generated summary, or second permanent history archive is required for the first version.
- Completed conversation content is the historical requirement; preserving every transient terminal redraw is not.
- If history or live information is incomplete or unavailable, make that limitation visible rather than implying completeness.
- Show useful activity/status information, including the kinds of states the user recognizes in herdr. Exact sources and meanings must be verified. Idle is not equivalent to task completion or permission to shut down.

### Input

- Provide a normal multiline text composer and Send action suitable for a tablet keyboard, not a terminal keyboard emulator. The selected conversation's header identifies the recipient. After Send, collapse the composer and dismiss the keyboard; show feedback in the footer. Confirmed Sent feedback clears after five seconds; unresolved delivery warnings do not time out.
- Keep remote drafts per conversation while the page stays open, including through session switching and reconnects. Provide Clear and Close controls; Close hides the composer without discarding the draft. Do not persist drafts across page reload/closure or sync them across devices.
- Preserve the user's existing Pi behavior: submitting while Pi works uses its ordinary steering behavior. No separate follow-up mode is required for the first version.
- Approvals are ordinary conversational responses. Special extension dialogs and permission selectors are not required.
- Provide a dedicated **Stop** action in the footer, available with the composer open or collapsed. It interrupts the selected Pi session's active turn and discards all steering messages pending at the stop boundary, so they cannot resume work afterward. An unsent remote draft is retained. Stop must remain usable while a Send awaits feedback. This does not terminate Pi, undo completed actions, or promise cancellation of independent workers/background jobs; signal/process-termination and worker-tree controls are not required.
- Unfinished desktop drafts do not need preservation. Submission must nevertheless avoid accidentally combining a draft with the remote message or submitting the wrong content.

### Deployment and configuration

- One user and one host, reachable through a trusted LAN or Tailscale.
- A standard configuration file must provide listening IP/address and port options. The exact configuration schema is not selected.
- No application-level login, custom TLS setup, or special remote-network infrastructure is required.
- This deliberately relies on the operator's trusted-network assumption. The service can direct agents with host privileges and is not intended for public-internet exposure.

## 3. Outside the first version

- Creating or launching new Pi sessions. This remains a possible later convenience.
- General-purpose terminal access, a remote IDE, or a complex dashboard.
- Multiple users, multiple hosts, or public hosting.
- Shutdown automation or automatic certification that all work is finished.
- Process-termination or worker-tree cancellation controls, and non-conversational approval interfaces. Pi turn interruption plus steering discard is included.
- Replacing Pi's inter-agent communication or implementing a new coordinator/session graph.
- Requiring RAI to launch or own Pi processes. A Pi extension bridge is now an authorized investigation direction; the multiplexer remains responsible for process lifetime.

## 4. Candidate architecture, not yet a contract

```text
Tablet browser
      |
      | HTTP / live updates over trusted LAN or Tailscale
      v
RAI web service
      |-- retrieve existing herdr/tmux labels and pane context
      |-- connect to a Pi-side extension (under investigation)
      |      |-- report current conversation and structured ongoing output
      |      |-- accept ordinary messages and combined Stop
      |-- read correctly associated existing Pi saved history
      v
Existing Pi processes + extension, owned by their multiplexers
```

The extension would connect RAI to the existing interactive Pi, without spawning a second agent or transferring process ownership. Pi must keep working when the browser/service disconnects, and a service restart must not replay Send/Stop. Reading Pi's existing saved conversation remains a candidate for catch-up without another archive. Sessions without the extension would need it loaded before direct integration is available; installing it is not automatically an attachment to every running Pi.

Do not assume that stripping ANSI sequences produces a conversation feed, or that a text payload followed by Enter is an atomic Pi message. A screen capture, raw PTY stream, and saved conversation are different sources with different guarantees.

Choose the implementation stack and the smallest necessary backend boundary after the integration tests. The previous draft's Elixir behavior, spawning API, PubSub pipeline, WebSocket library, and deployment packaging were proposals, not confirmed decisions.

## 5. Evidence and limits established so far

The investigation used installed Pi documentation/library sources and the local tmux manual. It did not run live integration tests.

### Pi

- Documented RPC controls a process running in RPC mode; the SDK creates/owns its session. Neither was established as an attachment mechanism for an arbitrary already-running interactive Pi process.
- Pi distinguishes steering, follow-up input, and aborting. Ordinary interactive steering and a Stop operation that both interrupts the active turn and discards pending steering are required here. The combined Stop mechanism and its ordering have not been verified; abort alone must not be assumed to clear queued messages.
- Existing session JSONL can retain completed user/assistant messages and tool results after terminal scrollback disappears. Compaction does not itself remove the original stored entries.
- Saved history is not a complete live-event feed. Streaming partials, tool progress, queued/unsent input, and terminal-only UI are not all durably represented. In-flight content can be lost before persistence.
- No documented automatic mapping from an arbitrary live pane to its currently selected Pi session file was established. Concurrent sessions, switching, forking, and branch navigation matter; directory and recency are not sufficient identifiers.
- A historical reader must not accidentally modify a live session file. Some session-loading helpers can migrate or repair files; their suitability as read-only readers is not established.

Relevant installed Pi documentation: `docs/session-format.md`, `docs/sessions.md`, `docs/message-types.md`, `docs/usage.md`, `docs/rpc.md`, and `docs/sdk.md` in the Pi package, not this repository.

### tmux

- Discovery and targeting must operate at pane level: a tmux session may contain several windows and panes.
- The local tmux manual documents `list-panes -F` and format metadata for session names (`session_name`), window names (`window_name`), and pane titles (`pane_title`). Retrieving display labels does not require recovering a Pi conversation name. Which field agents currently name remains to be checked; names are not stable target identities.
- `capture-pane` reads rendered screen content and optionally retained history. History is bounded; alternate-screen capture does not provide an unlimited transcript.
- `pipe-pane` provides program output, not retrospective history or already-parsed conversation messages. It has a single output pipe per pane, so installing one can interfere with existing use.
- Literal key injection is documented, but correct multiline Pi submission, draft handling, behavior while busy, and interruption plus steering discard still require live tests.

### herdr

- The installed manual lookup did not provide a herdr entry. Discovery, socket protocol, capture/streaming, key input, retention, and state semantics remain unverified.
- The previous draft's herdr command examples must not be treated as valid syntax or API guarantees. Confirm the installed version's actual interfaces before implementation.

## 6. Feasibility gates

These are tests to perform before committing to the architecture, not promises that the mechanisms already work.

| Gate | Evidence needed |
| --- | --- |
| Live session identity and labels | Discover Pi panes and their labels in both multiplexers; associate each with the correct saved conversation. Test duplicate/missing/changing names, multiple Pi sessions in one directory, and session switching/forking. Check that existing window/pane names are displayed usefully with context; neither Pi conversation naming nor an agent-instruction change is a prerequisite. Never use display names as control identities or guess which session receives Send/Stop. |
| Historical catch-up | Open a long-running session after output has left terminal scrollback and retrieve its completed conversation/tool results. Handle a concurrently growing history file without modifying it; identify unavailable content. |
| Conversation and ongoing output | Establish a readable single conversation under Pi redraws, wrapping, and resizing, with structured ongoing output or an inline current view. Determine which tool/progress/queued-input details are actually observable and how provisional output relates to saved history without guessed merging. |
| Correct message submission | Deliver exact single-line and multiline text to the selected Pi while idle and busy, with literal special characters and an existing disposable draft. Verify normal steering behavior. |
| Stop and steering discard | Interrupt the active turn and discard all pending steering without terminating Pi or letting queued steering resume work. Test Stop during an outstanding Send, partial input, idle-with-queue, and partial/uncertain failure. Verify both effects rather than assume an interrupt key clears the queue. |
| Status | Verify herdr states and determine what tmux-backed sessions can honestly report. Distinguish observed activity, waiting, unknown/disconnected, and actual completion where supported. |
| Disconnect and recovery | Reopen the browser and restart RAI without affecting Pi. Reassociate the correct session and recover history. Establish Send/Stop acknowledgment behavior so a connection failure does not lead to blind replay of either action. |

If a gate fails, revisit the minimum necessary product or integration decision with the user. Do not silently substitute terminal screen scraping for promised conversation history, or introduce a required extension or launcher without agreement.

## 7. UX work and next steps

The [initial design](design.md) defines the tablet flow: choose a named session, read one conversation, use the multiline composer or Stop, and switch sessions through a top-left menu overlay. The conversation remains scrollable with the keyboard open.

After the integration gates, refine:

- Existing window/pane label mapping in both multiplexers and session identification.
- Activity/status presentation and unknown or stale states.
- History navigation, individual and per-type bulk tool/thinking expansion and collapse, and coherent ongoing output within the conversation.
- Scrolling behavior while reading older content; do not assume unconditional scroll-to-bottom.
- Tablet keyboard, page-local per-conversation drafts, composer collapse after Send, footer feedback lifetime, Send/Stop actions, and disconnected behavior.

Next: verify the installed multiplexer contracts and run a small, explicitly authorized feasibility prototype. Then select the stack and refine the UX against proven capabilities. Product scope confirmation does not make the architecture proven or authorize interaction with existing agents.
