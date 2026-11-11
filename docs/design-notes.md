# Remote Agent Interface (RAI): Product Brief and Design Notes

**Status:** Service/bridge, retained-history reader and browser conversation UI implemented with synthetic/source checks. First macOS Herdr/tmux live smoke passed; actual browser/tablet and full live reconciliation remain provisional after the operator deferred the broad second test gate.
**Target:** One user, one Linux/macOS host, tablet browser, trusted LAN or Tailscale.
**Stack:** Go standard-library service with an in-Pi TypeScript/Node extension; concrete boundaries in [design §§7–9](design.md#7-logical-architecture).
**Initial design:** [Architecture, tablet UX, and implementation validation](design.md). End-to-end behavior remains to be tested.
**Integration decision:** Herdr/tmux provide process durability and existing labels. A small Pi extension supplies direct state, output, Send, and Stop using the existing API; no Pi API change is planned. See [investigation findings](investigation-findings.md). The first disposable live phase was separately authorized and completed; further phases need agreed scope. Installation into existing sessions remains unauthorized.

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
- Support existing Pi sessions within these multiplexers, not just sessions started by a particular launcher. Direct participation requires the RAI extension to be loaded. Show identifiable sessions without it as integration unavailable; there is no terminal-control fallback. Installing a file alone does not attach it to already-running sessions.
- Multiplexers retain ownership of PTYs and Pi processes. Closing the browser, losing connectivity, or restarting RAI must not stop those sessions.
- Desktop and tablet views may remain open; one person types at a time.

### Output and history

- Show one scrollable conversation with messages, tool activity/results, errors, pending input where available, and ongoing output. Do not require separate history and terminal panels. Tool results and thinking blocks should expand/collapse individually and independently by type, including expand/collapse-all controls for each type, where the source supports identifying them. Use structured extension events for ongoing output and persisted entry IDs to reconcile it with existing saved history; validate that reconciliation during implementation.
- Provide the saved conversation history, opening near the newest content with older history available. Current terminal scrollback alone is insufficient: important information may have scrolled away between visits.
- No separate unread-tracking system, generated summary, or second permanent history archive is required for the first version.
- Completed conversation content is the historical requirement; preserving every transient progress update is not.
- If history or live information is incomplete or unavailable, make that limitation visible rather than implying completeness.
- Show useful activity/status information, including the kinds of states the user recognizes in herdr. Exact sources and meanings must be verified. Idle is not equivalent to task completion or permission to shut down.

### Input

- Provide a normal multiline text composer and Send action suitable for a tablet keyboard, not a terminal keyboard emulator. The selected conversation's header identifies the recipient. After Send, collapse the composer and dismiss the keyboard; show feedback in the footer. Confirmed Sent feedback clears after five seconds; unresolved delivery warnings do not time out.
- Keep ordinary unsent input with its conversation while the page stays open, including switching/reconnects. The operator's browser feedback removed Review message, receipt/reuse/unlock steps, and Clear/Close draft-management controls: use one ordinary textarea with Send/Stop and inline failures. No receipt archive, recovery workflow, persistence across page reload or device sync.
- Preserve the user's existing Pi behavior: submitting while Pi works uses its ordinary steering behavior. No separate follow-up mode is required for the first version.
- Approvals are ordinary conversational responses. Special extension dialogs and permission selectors are not required.
- Provide a dedicated **Stop** action in the footer, available with the composer open or collapsed. Use Pi's existing interruption path to abort current work and discard queued steering; retain the unsent RAI draft. Stop remains usable while a Send awaits feedback. This does not terminate Pi, undo completed actions, or promise cancellation of independent workers/background jobs; signal/process-termination and worker-tree controls are not required.
- Send calls Pi directly without submitting the desktop editor, so desktop drafts cannot be prepended accidentally. Preserve the composed string without trimming or normalization; ordinary Pi input extensions may deliberately transform or handle it. A void API return does not establish acceptance or queueing.

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
- Requiring RAI to launch or own Pi processes. The extension runs inside an existing Pi; the multiplexer remains responsible for process lifetime.

## 4. Integration architecture

```text
Tablet browser
      |
      | HTTP / live updates over trusted LAN or Tailscale
      v
RAI web service
      |-- retrieve existing herdr/tmux labels and pane context
      |-- accept a local connection from the extension inside each Pi
      |      |-- report current conversation and structured ongoing output
      |      |-- dispatch ordinary messages and Stop through Pi's API
      |-- read correctly associated existing Pi saved history
      v
Existing Pi processes + extension, owned by their multiplexers
```

Use one independent web service and one user-private local Unix-socket connection initiated by each Pi extension. Pi keeps working when the service/browser is absent or slow. Reconnect observation with a fresh history/current-turn synchronization; never replay Send/Stop and never maintain a command outbox. Keep bounded current display state, not another history archive. Sessions without the extension need an explicit supported load/reload before direct integration is available.

Choose the independent service stack, then build the bridge as the first implementation slice using Pi's existing API. TypeScript is the extension host language; Elixir/Phoenix LiveView and Go remain service candidates. No terminal capture/key injection or separate Pi control API is part of this direction.

## 5. Evidence and remaining implementation questions

The [investigation findings](investigation-findings.md) contain source references and environment details. No live integration tests or extension installs were performed.

- The extension can read its host's current session/file/branch state and receive structured response, thinking, tool, prompt, and settlement events. SDK/RPC process ownership is not needed to attach this extension to its own host.
- `turn_end` supplies persisted message/result IDs suitable for replacing provisional output. `message_end` occurs before persistence and is not an equivalent boundary. Mid-turn joining and reconnect synchronization still need integrated validation.
- Send directly enters Pi's ordinary input pipeline without editor trimming or draft submission. The API returns void; dispatch acknowledgment is not accepted/queued confirmation. Manual compaction and navigation during asynchronous input processing remain specific integration questions.
- Existing JSONL retains completed entries and compaction originals. Read raw ancestry without mutating storage; model-context projections and loading helpers that migrate/repair files are not suitable historical readers. Already-truncated saved content cannot be reconstructed.
- Herdr/tmux supply human labels and ownership context, not the control transport. Label mapping, nested ownership, extension reload, and service recovery need end-to-end validation in both environments. Linux remains provisional until tested.

## 6. Implementation checks

The direction is selected; validate it in small implementation slices rather than run another broad feasibility phase. [Design §10](design.md#10-implementation-validation) defines the focused checks:

- Extension participation, current conversation identity, existing labels, and stale selections under both multiplexers.
- Direct Send, normal interruption/queued-steering discard, and feedback reflecting actual API evidence.
- Read-only retained history, long-result paging, and provisional-to-persisted output replacement.
- Pi activity/settlement, service absence or slow readers, reconnect synchronization, independent process lifetime, and no control replay.
- Tablet composer/drafts, expansion controls, scrolling, accessibility, and browser-origin protections.

Live validation requires separate authorization for disposable sessions and cleanup. Do not install into existing agents or substitute private APIs, terminal controls, or another archive when an implementation issue appears.

## 7. UX work and next steps

The [initial design](design.md) defines the tablet flow: choose a named session, read one conversation, use the multiline composer or Stop, and switch sessions through a top-left menu overlay. The conversation remains scrollable with the keyboard open.

During implementation, refine:

- Existing window/pane label mapping in both multiplexers and session identification.
- Activity/status presentation and unknown or stale states.
- History navigation, individual and per-type bulk tool/thinking expansion and collapse, and coherent ongoing output within the conversation.
- Scrolling behavior while reading older content; do not assume unconditional scroll-to-bottom.
- Tablet keyboard, page-local per-conversation drafts, composer collapse after Send, footer feedback lifetime, Send/Stop actions, and disconnected behavior.

Next: choose the service stack and build the direct Pi extension bridge as the first implementation slice, then add history reconciliation and the web UI. This document authorizes neither live tests nor interaction with existing agents.
