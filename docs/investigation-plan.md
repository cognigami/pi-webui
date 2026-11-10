# RAI Integration Investigation Plan

**Status:** Ready for coordinator handoff; investigation only. Live tests are not authorized by this plan.
**Baseline:** [Design](design.md), especially §§5, 7, and 10; [product scope and existing evidence](design-notes.md).
**Goal:** Determine whether existing interactive Pi sessions in both herdr and tmux can satisfy the required identity, conversation, Send, and Stop contracts. Produce an evidence-backed go/no-go decision, not a production implementation.

**Operator-approved follow-up after I1:** Investigate a Pi-side extension for direct state/output/control, with herdr/tmux retaining process durability. The earlier restriction against introducing an extension is lifted for this investigation, not permission to install one into running sessions or conduct live tests. The remaining gate requirements and authorization boundaries still apply. Record follow-up evidence in [the current findings](investigation-findings.md); interpret multiplexer input/control experiments below as the original track, not a requirement to inject terminal keys.

## 1. Scope and priorities

Freeze the design as the investigation baseline. Reopen it only when evidence requires a product or integration decision; do not pursue general ambiguity cleanup or UX polish.

Investigate in this order:

1. Supported interfaces and experiment authorization.
2. Reliable target/conversation identity and protection against stale-target control.
3. Exact ordinary input and Stop plus steering discard.
4. Read-only history and a coherent conversation with ongoing output.
5. Failure boundaries, recovery, and capability limits.
6. Findings and an explicit decision with the user.

The design's feasibility table is a coverage checklist, not an execution order. Front-load likely integration blockers. Do not select a production stack, implement a dashboard, or plan production delivery before the required gates pass.

### Blocking versus permitted limitations

**Blocking:** guessed target/history association; actions reaching a replacement process or wrong conversation; inexact submission or accidental desktop-draft submission; interrupt without steering discard; missing saved history; unreadable or incoherent ongoing output; unavoidable automatic replay.

**Permitted when explicit:** unknown agent activity, unavailable queue visibility, acceptance-unconfirmed delivery, and an inline current terminal snapshot rather than structured live messages. These are not permission to weaken exact input, Stop, targeting, or history requirements.

Both backends must pass the required contracts. A passing backend does not compensate for a failing one. An unavailable test platform remains provisional, not implicitly supported.

## 2. Coordinator operating instructions

Follow [COORDINATION.md](COORDINATION.md) for agent launch/placement, bounded assignments, investigation responsibilities, independent review, and handoff conventions. For this investigation:

- Begin with desk research. Confirm installed versions and supported Pi/multiplexer interfaces rather than copying old command examples.
- Agree a short investigation budget before each live phase; do not let a failed mechanism turn into open-ended workaround development.
- Backend-specific research and fixture-only history work can proceed independently, with separate live-test targets and non-overlapping writes.
- The coordinator maintains one concise findings document at `docs/investigation-findings.md`; workers report results for synthesis.
- Use the smallest disposable harness needed. No plugin framework, persistent receipt store, second transcript archive, or production web service.
- On a required-gate failure, stop dependent work and bring the smallest necessary decision to the user. Independent read-only work may finish; do not silently change scope or try a required extension, launcher, alternate UX, or process-killing substitute.
- Obtain a fresh correctness review of the assembled findings before presenting the final feasibility recommendation; reviewers have no additional live-test authority.

## 3. Work packages and gates

### I1 — Supported-interface inventory and experiment proposal

**Prerequisite:** None. Read-only research; no control of existing agents.

Inspect the installed Pi, herdr, and tmux interfaces for:

- Pane-level enumeration, ownership/process identity, backend/socket identity, existing labels, and overlapping multiplexer visibility.
- Authoritative evidence of the current Pi saved file and branch/leaf, including switch, fork, and branch navigation.
- Literal input, editor-state handling, normal submission/steering, interruption, pending-steering discard, and any ordering guarantees.
- Nonintrusive current-output snapshots and activity evidence; read-only saved-history formats and relevant helper side effects.

Use existing notes as leads, not proof of current installed behavior. Record concrete interface/source references, versions, and gaps. Source inspection may explain behavior but does not automatically make an internal interface supported.

**Deliverables:** Per-backend capability sketch; proposed minimal mechanisms; likely blockers; and an authorization request specifying:

- Disposable Pi sessions, multiplexer instances/panes, and test directories to create/use.
- Test payloads and benign workloads, including Unicode, multiline/special characters, disposable desktop drafts, and queued steering.
- Proposed fault injection: controlled process replacement, conversation changes, partial operations, connection loss, and harness restart.
- Exact cleanup scope, including disposable processes and files; no changes to existing agents or conversations.

**Gate:** There is a plausible mechanism to test each required contract, or an identified blocker for user decision. Obtain explicit authorization before creating or controlling live test sessions. Until authorized, only research and fixture-based work may continue.

### I2 — Identity and safe-targeting kill test

**Prerequisite:** I1 and explicit authorization for these experiments.

For each backend, test discovery and association with:

- Multiple Pi processes in one directory, multiple windows/panes, duplicate or missing labels, and renames.
- Pi exit/replacement, an unrelated foreground program, and backend restart where relevant.
- Conversation switch, fork, and branch navigation within the same Pi process.
- Overlapping herdr/tmux visibility where applicable; do not guess ownership or deduplicate by label/path.

Establish the chain from live target to current saved file and branch. Then investigate the interval between validation and control: deliberately change/replace a disposable target in that interval. Use harmless authorized payloads and observe the recipient.

**Pass:** Labels are useful display metadata, not identities. Association changes invalidate stale selections. Supported targeting/ordering semantics explain why Send and Stop cannot reach the wrong process/editor or conversation; successful repetitions alone do not establish that guarantee. A preflight process check alone is insufficient.

**Stop condition:** If authoritative association or the validation-to-control guarantee cannot be established, report the precise gap before developing the control path further. Do not substitute file recency, directory matching, screen-text guessing, or mutable pane names.

### I3 — Exact input and combined Stop kill tests

**Prerequisite:** I2 passes for the backend being tested.

First prove exact ordinary submission:

- Idle and busy Pi; single/multiline text; Unicode; shell metacharacters and text resembling terminal shortcuts.
- Empty and disposable nonempty desktop editors. The remote message must replace, never combine with or accidentally submit, the desktop draft.
- Ordinary busy-state steering, including multiple pending messages.
- Unsupported prompt/dialog states: determine whether they can be recognized and submission safely disabled. Do not inject blindly into a known incompatible dialog.

Verify the received content using an authoritative Pi-side observation, not merely the multiplexer command's exit status. Record the operation steps and the earliest possible side effect. Do not assume a paste/Enter recipe is atomic or safe.

Then prove Stop as a combined operation:

- Active turn with multiple queued steering messages; after Stop, none starts another turn.
- Idle-with-queue if that state is reachable; otherwise document why it is not.
- Send already applying versus Send awaiting acknowledgment; Stop follows already-started input without waiting for a conversational response and precedes further sends.
- Partial input, repeated Stop taps, interruption/clearance partial failure, and connection loss.
- Pi remains alive; an unsent remote draft is not part of the discarded queue. Stop must not submit partially applied input fragments.

**Pass:** Exact input uses verified normal Pi behavior. Stop interrupts and clears steering at an established boundary with verified ordering in each backend. Report which outcomes can actually be confirmed.

**Stop condition:** Inexact input, unsafe editor-state assumptions, or abort-with-steering-retained blocks the integration. Escalate rather than inventing key sequences or substituting termination/conversational stop.

### I4 — Saved history and ongoing-conversation proof

**Prerequisite:** Fixture-only history research can start after I1; live integration and presentation work follows I2–I3. Do not invest in presentation while a required control gate is unresolved.

**History:** Using representative fixtures, then authorized disposable sessions, verify:

- Completed messages/tools remain retrievable after leaving terminal scrollback.
- Selected-branch ancestry, fork/navigation changes, compaction boundaries, and retained originals without mixing sibling branches.
- Long results and bounded paging without silent truncation.
- Concurrent append, incomplete trailing records, malformed completed records, unsupported entries, and unavailable files.
- Reader operations do not migrate, repair, append to, or otherwise write the source history.

**Ongoing output:** Use a minimal local rendering/projection experiment, not a dashboard:

- Observe streaming text and tool activity under redraw, wrapping, and naturally occurring layout changes. Do not resize a user's pane, attach interactively, or take over an existing output pipe. Any deliberate resize is limited to an explicitly authorized disposable pane.
- Prefer supported snapshots first. Establish whether structured ongoing content or a readable inline **Live terminal view** is possible.
- Demonstrate how provisional output is replaced or reconciled as completed history arrives. No text-similarity deduplication, false role attribution, or duplicated full responses as the steady state.
- Identify observable versus unavailable thinking, tool progress, queued input, current prompts, and status. Historical prompts must not become current pending prompts.
- Retrieve labels and context useful enough for the user to recognize sessions; no new naming system or mandatory Pi conversation names.

**Pass:** A readable single conversation combines correct saved history with current output without disturbing the owning pane or guessing identity/ordering. A small sample projection is sufficient; tablet layout polish is not part of this investigation.

**Stop condition:** Terminal scrollback alone, a separate history/terminal-panel substitute, or incoherent live/history reconciliation fails the agreed requirement. Bring evidence and the smallest alternative decision to the user.

### I5 — Failure boundaries, status, and recovery

**Prerequisite:** I2–I4 pass for the backend. Record useful failure evidence encountered earlier rather than rerunning it unnecessarily.

Use the minimal harness to examine:

- Failures before input, partway through input, and after delivery but before acknowledgment.
- Disconnect/reconnect and harness/service-state restart during Send or Stop. Revalidate identity, reload history/current observations, and never replay either action automatically.
- Session exit/replacement and conversation change during recovery; no restoration by old label and no stale branch association.
- Ending observation/harness work without affecting Pi or the multiplexer.
- Meaning and freshness of available activity sources, independently of connection health. Quiet output is not evidence of Idle or task completion.

Produce a small outcome table mapping actual observations to **Not sent**, **Input sent; acceptance unconfirmed**, **Sent/Steering queued** when provable, **Outcome unknown**, and the corresponding Stop outcomes. State what evidence correlates an acknowledgment with a specific operation; text equality alone does not suffice.

**Pass:** Failures are classified honestly, unknown outcomes stay unknown, recovery restores only verified associations, Pi survives, and the browser-to-service-to-adapter path can be implemented without automatic replay. Verify relevant transport/client retry defaults before claiming this last property; no production service is required.

Unknown activity or missing acceptance/queue observations may pass with explicit limitations. Inability to preserve safe targeting, combined Stop, or non-replay requires user decision.

### I6 — Synthesis and decision

**Prerequisite:** All feasible work is complete, or a blocking gate has stopped dependent work.

The coordinator consolidates findings with:

1. Tested environment/versions and platform coverage; untested Linux/macOS/backend combinations marked provisional.
2. A compact matrix of required contracts by backend: **pass**, **fail**, or **unverified**, with evidence references and a short rationale.
3. Proven interface/ordering guarantees, observed-only behavior, and remaining unknowns kept distinct.
4. Supported status/output/acknowledgment capabilities and their honest UI implications.
5. Minimal reusable experiment code/fixtures where useful, reproduction instructions, and authorized cleanup results. Do not retain private conversations or build an evidence archive.
6. A recommendation: proceed to stack selection, request a specific product/integration decision, or perform one bounded follow-up experiment with a named question.

If all required gates pass, describe only the resulting integration constraints for a later stack decision. Do not choose Go/Phoenix or start production work as part of this plan. If any required gate fails or remains unverified, do not declare the full scope feasible.

## 4. Parallelism and dependency summary

```text
I1: backend interface research + fixture-only history research
  -> operator authorizes specified disposable experiments
  -> I2: identity / targeting
  -> I3: exact input / Stop
  -> I4: integrated history / ongoing-output proof
  -> I5: recovery / outcome boundaries
  -> I6: user decision
```

Herdr and tmux tracks may proceed independently through these gates with separate disposable targets. Fixture research does not authorize live tests. A backend failure stops its dependent track and triggers a decision; it does not authorize silently reducing first-version coverage.

## 5. Definition of done

The investigation ends with a coordinator-readable findings document and an explicit next decision. It is successful even if it demonstrates that the selected integration cannot meet the requirements. It is not complete merely because a happy-path demo works.

Production architecture/stack selection, UI implementation, tablet/accessibility acceptance, security implementation, deployment, and broad regression suites remain out of scope. Those later activities stay gated on the required feasibility results and any user-approved scope changes.
