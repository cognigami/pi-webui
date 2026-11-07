# Remote Agent Interface (RAI): Product Brief and Design Notes

**Status:** Product scope confirmed; architecture and integration feasibility unproven.
**Target:** One user, one Linux/macOS host, tablet browser, trusted LAN or Tailscale.
**Stack:** Not selected. Elixir/Phoenix LiveView and Go remain candidates.

This document replaces the initial architecture draft and its later update. Requirements below reflect the product discussion; candidate mechanisms are not established integration contracts.

## 1. Purpose and primary workflow

Pi agents are running, usually under a coordinator in herdr, sometimes in tmux. The user is away from the computer or prefers using a tablet.

The user needs to:

1. Find the coordinator or another running Pi session.
2. Understand what has happened and what is happening now.
3. Respond conversationally to unblock or approve work, redirect it, or say that work should stop for now.
4. Decide whether the machine should keep running or whether returning to a terminal is necessary before shutting it down for the night.

RAI provides information and ordinary Pi messaging. It does not decide that a machine is safe to shut down or perform shutdown itself.

## 2. Confirmed first-version scope

### Sessions and ownership

- Support existing interactive **Pi sessions in both herdr and tmux**. General terminal programs and other agents are not targets.
- Present sessions without requiring the user to care which multiplexer backs them. The coordinator should be easy to identify and select.
- The desired coverage is any running Pi session within these multiplexers, not just sessions started by RAI. Reliable discovery and identification remain feasibility gates.
- Multiplexers retain ownership of PTYs and Pi processes. Closing the browser, losing connectivity, or restarting RAI must not stop those sessions.
- Desktop and tablet views may remain open; one person types at a time.

### Output and history

- Show conversation messages, tool activity/results, errors, pending input where available, and current activity. Verbose tool output should be collapsible if the integration supports identifying it.
- Provide the saved conversation history, opening near the newest content with older history available. Current terminal scrollback alone is insufficient: important information may have scrolled away between visits.
- No separate unread-tracking system, generated summary, or second permanent history archive is required for the first version.
- Completed conversation content is the historical requirement; preserving every transient terminal redraw is not.
- If history or live information is incomplete or unavailable, make that limitation visible rather than implying completeness.
- Show useful activity/status information, including the kinds of states the user recognizes in herdr. Exact sources and meanings must be verified. Idle is not equivalent to task completion or permission to shut down.

### Input

- Provide a normal multiline text composer and Send action suitable for a tablet keyboard, not a terminal keyboard emulator.
- Preserve the user's existing Pi behavior: submitting while Pi works uses its ordinary steering behavior. No separate follow-up mode is required for the first version.
- Approvals are ordinary conversational responses. Special extension dialogs and permission selectors are not required.
- A request to stop means sending a conversational instruction. Dedicated abort, signal, process-termination, or worker-tree cancellation controls are not required.
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
- Dedicated process controls or non-conversational approval interfaces.
- Replacing Pi's inter-agent communication or implementing a new coordinator/session graph.
- A Pi extension bridge as the chosen integration path. Multiplexer integration is the selected direction.

## 4. Candidate architecture, not yet a contract

```text
Tablet browser
      |
      | HTTP / live updates over trusted LAN or Tailscale
      v
RAI web service
      |-- discover/identify Pi panes through herdr and tmux
      |-- observe current terminal output/activity
      |-- submit ordinary text through the selected multiplexer
      |-- read existing Pi saved history, if correctly associated
      v
Existing Pi processes, owned by their multiplexers
```

Multiplexer input does not require terminal output to be the only history source. Reading Pi's existing saved conversation is a candidate way to provide catch-up without adding another archive.

Do not assume that stripping ANSI sequences produces a conversation feed, or that a text payload followed by Enter is an atomic Pi message. A screen capture, raw PTY stream, and saved conversation are different sources with different guarantees.

Choose the implementation stack and the smallest necessary backend boundary after the integration tests. The previous draft's Elixir behavior, spawning API, PubSub pipeline, WebSocket library, and deployment packaging were proposals, not confirmed decisions.

## 5. Evidence and limits established so far

The investigation used installed Pi documentation/library sources and the local tmux manual. It did not run live integration tests.

### Pi

- Documented RPC controls a process running in RPC mode; the SDK creates/owns its session. Neither was established as an attachment mechanism for an arbitrary already-running interactive Pi process.
- Pi distinguishes steering, follow-up input, and aborting. Only ordinary interactive steering is required here.
- Existing session JSONL can retain completed user/assistant messages and tool results after terminal scrollback disappears. Compaction does not itself remove the original stored entries.
- Saved history is not a complete live-event feed. Streaming partials, tool progress, queued/unsent input, and terminal-only UI are not all durably represented. In-flight content can be lost before persistence.
- No documented automatic mapping from an arbitrary live pane to its currently selected Pi session file was established. Concurrent sessions, switching, forking, and branch navigation matter; directory and recency are not sufficient identifiers.
- A historical reader must not accidentally modify a live session file. Some session-loading helpers can migrate or repair files; their suitability as read-only readers is not established.

Relevant installed Pi documentation: `docs/session-format.md`, `docs/sessions.md`, `docs/message-types.md`, `docs/usage.md`, `docs/rpc.md`, and `docs/sdk.md` in the Pi package, not this repository.

### tmux

- Discovery and targeting must operate at pane level: a tmux session may contain several windows and panes.
- `capture-pane` reads rendered screen content and optionally retained history. History is bounded; alternate-screen capture does not provide an unlimited transcript.
- `pipe-pane` provides program output, not retrospective history or already-parsed conversation messages. It has a single output pipe per pane, so installing one can interfere with existing use.
- Literal key injection is documented, but correct multiline Pi submission, draft handling, and behavior while busy still require live tests.

### herdr

- The installed manual lookup did not provide a herdr entry. Discovery, socket protocol, capture/streaming, key input, retention, and state semantics remain unverified.
- The previous draft's herdr command examples must not be treated as valid syntax or API guarantees. Confirm the installed version's actual interfaces before implementation.

## 6. Feasibility gates

These are tests to perform before committing to the architecture, not promises that the mechanisms already work.

| Gate | Evidence needed |
| --- | --- |
| Live session identity | Discover Pi panes in both multiplexers and associate each with the correct saved conversation. Test multiple Pi sessions in one directory and session switching/forking. Never guess which session receives input. |
| Historical catch-up | Open a long-running session after output has left terminal scrollback and retrieve its completed conversation/tool results. Handle a concurrently growing history file without modifying it; identify unavailable content. |
| Current activity and output | Establish readable current output under Pi redraws, wrapping, and resizing. Determine which tool/progress/queued-input details are actually observable and how to distinguish history from current state. |
| Correct message submission | Deliver exact single-line and multiline text to the selected Pi while idle and busy, with literal special characters and an existing disposable draft. Verify normal steering behavior. |
| Status | Verify herdr states and determine what tmux-backed sessions can honestly report. Distinguish observed activity, waiting, unknown/disconnected, and actual completion where supported. |
| Disconnect and recovery | Reopen the browser and restart RAI without affecting Pi. Reassociate the correct session and recover history. Establish submission acknowledgment behavior so a connection failure does not lead to blind duplicate sends. |

If a gate fails, revisit the minimum necessary product or integration decision with the user. Do not silently substitute terminal screen scraping for promised conversation history, or introduce a required extension or launcher without agreement.

## 7. UX work and next steps

Full UX specification is not a prerequisite for this feasibility work. A rough session-list, conversation/activity view, and multiline composer sketch is sufficient to begin discussing the workflow.

After the integration gates, specify:

- Session identification and coordinator visibility.
- Activity/status presentation and unknown or stale states.
- History navigation, tool-result expansion, and the distinction between completed history and live output.
- Scrolling behavior while reading older content; do not assume unconditional scroll-to-bottom.
- Tablet keyboard, multiline entry, submission feedback, and disconnected behavior.

Next: verify the installed multiplexer contracts and run a small, explicitly authorized feasibility prototype. Then select the stack and refine the UX against proven capabilities. Product scope confirmation does not make the architecture proven or authorize interaction with existing agents.
