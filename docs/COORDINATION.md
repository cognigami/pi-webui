# Coordinating RAI work

Reusable guidance for planning, delegating, investigating, and reviewing work in this repository. Project instructions, the selected design, and the operator's actual authorization remain authoritative. A plan or review approval is not permission to execute everything it describes.

## 1. Scale coordination to the work

The coordinator owns sequencing, task boundaries, integration, review assignments, and decisions returned to the operator. It must understand and synthesize the evidence, not simply relay messages.

**Do small work directly.** Delegate only a concrete, bounded task that can proceed independently while useful work continues. Do not create a team merely because a plan has several headings. Substantial investigation and independent correctness review are separate responsibilities; the coordinator must not treat its own synthesis as an independent review.

Concurrent writers need non-overlapping files and responsibilities. If tasks need the same interface or file, agree the interface first, serialize them, or keep them with one owner. One owner controls each disposable live-test target and its cleanup; separate files alone do not make shared-target experiments independent.

## 2. Pi launch and Herdr placement — required

The operator launches the coordinator in a Herdr workspace. Every Pi agent it launches, including investigators and reviewers, must receive this exact Pi command-line option:

```text
--presets:preset eng
```

Supply research/review responsibilities in the task brief; the preset does not replace them. Descendant launches obey the same rule. Normally the coordinator owns agent creation.

Create **tabs in the coordinator's own workspace**, not splits in its tab or tabs in whichever workspace the UI currently displays. Use the coordinator's inherited `HERDR_WORKSPACE_ID`, with `HERDR_ENV=1`; never copy another session's ID. Create background tabs without stealing focus. A new tab's returned root terminal pane is the correct launch target, not an instruction to split it. Set the intended repository/cwd explicitly.

Use the installed Herdr tool for launch and placement. Consult its current `--skill` and relevant `--help` when needed; never run bare `herdr` for discovery. Use actual IDs returned by creation, not guessed pane names or tab order. This document does not establish CLI syntax or claim the installed launch interface has been verified. If the required context or capability is missing, ask the operator rather than silently changing placement or omitting the preset.

Do not use a convenience launcher unless it demonstrably satisfies the same workspace, tab, cwd, and preset requirements.

Prefer Pi session tools for assignments and follow-up. Use `session_list` to find live sessions and `session_send_message` with `report_back: true` when a response is needed. Continue useful work after sending; when the response is the next dependency and no independent work remains, end the turn and wait for it. Do not sleep, poll, or use Herdr wait commands as the normal coordination mechanism.

On stalled or timed-out work, inspect the agent's state before resubmitting: timeout is not proof the assignment never arrived. Do not answer approvals, cancel unrelated user sessions, close unrelated tabs, or stop the Herdr server on the operator's behalf.

## 3. Investigation responsibilities

Give an investigator a question, not just a sequence of commands. Its brief must specify permitted resources/targets, read-only versus write authority, authorized experiments, expected evidence, effort budget, and stopping conditions.

Investigators should:

- Answer the original question, including negative and inconclusive results.
- Evaluate discrepancies and plausible competing explanations within the agreed scope. Bounded follow-up is useful; searching indefinitely for a passing result is not.
- Distinguish supported interface contracts, source-inspected behavior, experimental observations, and unresolved assumptions. Repeated happy-path success does not establish an atomicity or race-safety guarantee.
- Report what prompted follow-up, what was tested, what changed the conclusion, and what remains unverified.
- Recommend the next useful experiment or decision. Request authorization before expanding targets, modifying existing agents, changing integration direction, or performing new fault injection outside the approved envelope.

The coordinator combines results across backends and checks dependencies. It must not quietly replace the question, hide a failed gate, or convert a permitted limitation into an unsupported success claim.

Live validation requires explicit authorization for disposable Pi sessions, multiplexers, payloads, fault injection, and cleanup. Never inject into the coordinator, existing workers, or production conversations. Reading documentation and fixture-only work do not authorize live control. Launching a worker is not permission for it to create or manipulate test sessions.

## 4. Review purposes and triggers

| Review | Trigger | Focus | Not its job |
| --- | --- | --- | --- |
| **Correctness** | A meaningful result becomes a downstream dependency; one fresh review of the assembled findings before presenting the feasibility recommendation | Requirement fidelity, actual evidence, alternative explanations, targeting/ordering guarantees, failure boundaries, and untested cases/platforms | General design polish, scope expansion, or declaring experimental authority |
| **Engineering** | Substantial code is integrated or a cross-module change needs an architectural check | Simplicity, ownership, interface clarity, duplicated mechanisms, unnecessary abstractions/dependencies, and stoppable work | A panel for every document edit or architecture for hypothetical requirements |

Review a meaningful slice early enough to avoid compounding defects; do not commission a new reviewer for every command or table. A reviewer may be reused for focused follow-up. An investigation-only handoff normally needs a fresh correctness review, not a standing engineering panel.

Reviewers are **read-only by default**, including no modifying lint commands. Give them the assignment, authoritative design/plan, exact result or changed files, relevant checks, evidence, and the same access/experiment restrictions as the worker. Prefer an independent argument or discriminating check over merely repeating the worker's procedure. A reviewer does not gain permission to run live tests because a report describes them.

Findings should identify a concrete defect, its consequence, and the smallest warranted correction. The coordinator evaluates recommendations as evidence, implements warranted fixes, and requests focused re-review. Review advice is not automatically a new requirement. An engineering review examines the integrated result, not only isolated worker patches.

## 5. Assignment and integration minimum

Each task brief should state:

- Objective, authoritative design/plan, and expected result.
- Exact repository/cwd and allowed write scope, or **read-only**.
- Established dependencies/interfaces and what other agents own, including live targets.
- Permitted resources, execution authority, required checks, and effort budget.
- Review role where relevant, stopping conditions, and decisions requiring operator input.

Keep results and durable decisions in repository Markdown and ordinary source control. Use the project's `vc_*` workflow for changes. Do not build a scheduler, registry, dashboard, review controller, or additional approval system. A small task/status table is sufficient when needed.

Ask the operator before contacting agents in another project unless that communication has been explicitly authorized. A sibling repository dependency or permission to read its documents does not authorize directing its agents.

## 6. Plan and handoff minimum

A plan should contain scope/exclusions, unresolved choices, ordered verifiable slices, dependencies, ownership/write boundaries, appropriate validation/review, and a coordinator start brief stating what is actually authorized. Stop dependent work when a prerequisite fails; return a specific decision rather than silently weakening the contract.

Each plan should link to this document and own its task-specific start brief, sequence, status, and authorization boundaries. Keep current-task instructions out of this reusable guide.
