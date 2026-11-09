# RAI Integration Investigation Findings

**Status:** I1 desk investigation found blocking gaps; dependent live work stopped. Independent correctness review complete: no blocking findings. Awaiting operator decision.
**Baseline:** [Investigation plan](investigation-plan.md), [design](design.md), and [product scope](design-notes.md). The design has not been changed.

## 1. Scope, environment, and authority

- Host inspected: macOS (`Darwin x86_64`). Linux and all live integration combinations remain **unverified**, not supported by implication.
- Pi **1.5.0**, supplied by the operator. `pi --version` failed when the new Node process could not read its package configuration. No successful CLI version measurement is claimed. Work stopped at that denial and resumed only after operator guidance; the blocked command was not retried.
- Herdr **0.9.3** client and running server, private protocol **22**, endpoint generation **1**, confirmed with `herdr --version` and `herdr status`. Current server socket: `/Users/ricardo/.config/herdr/herdr.sock`.
- tmux **3.7b**, confirmed with `tmux -V`.
- Existing Herdr Pi integration: **v9**, reported current by `herdr integration status`. Its installed source is `/Users/ricardo/.pi/agent/extensions/herdr-agent-state.ts`.
- Authority: installed help/skill/API schema and Pi docs describe public interfaces; installed JavaScript/TypeScript explains implementation behavior, not a new supported attachment API. The supplied Pi version does not independently establish source/build equivalence.
- Only desk research, read-only metadata inspection, and synthetic-history research were authorized. No disposable integration test sessions, fault injection, input payloads, or pane resizes were authorized or executed. Research-agent launches are coordination, not contract tests.

**Evidence notation:** `PI/` means `/Users/ricardo/.local/lib/node_modules/@earendil-works/pi-coding-agent/`. Herdr schema references below are JSON pointers in the output of `herdr api schema --json`, protocol 22/schema version 1. Reproduce from the installed tools rather than relying on old command examples. No private conversations were copied into this repository.

## 2. Gate disposition

I1 permits an identified blocker to return for user decision instead of proceeding into I2. That is the outcome here. There is no justified live-control path to test against the frozen contracts yet. Repetitions of terminal input would not establish the missing association or validation-to-control guarantee.

| Required contract | Herdr | tmux | Evidence / rationale |
| --- | --- | --- | --- |
| Pane-level discovery, labels, backend context | **unverified** end-to-end | **unverified** end-to-end | Public enumeration/metadata interfaces exist (§3); duplicate names, missing names, nested visibility, and replacement cases were not tested. |
| Authoritative current file **and selected branch/leaf** | **fail** for the inspected file-report + JSONL mechanism | **fail** for JSONL-based leaf recovery; file association also **unverified** | In-process leaf changes need not write a record; Herdr reports file/ID, not leaf (§4.1). This is not a claim that every conceivable future interface is impossible. |
| Stale-target Send/Stop protection through control | **unverified**; blocking | **unverified**; blocking | No supported expected-Pi-process/conversation/leaf conditional mutation identified. Pane identity and preflight metadata alone are insufficient (§4.2). |
| Exact ordinary input, replacing desktop draft | **fail** for unmodified default Pi submit path | **fail** for unmodified default Pi submit path | Pi trims editor submission before acceptance; draft replacement and Unicode/multiline behavior remain untested (§4.3). |
| Interrupt plus steering discard at ordered boundary | **unverified** | **unverified** | Interactive abort has promising queue-clear behavior, but no tested combined remote guarantee (§4.4). |
| Read-only completed history, correct branch, bounded paging | **unverified** integration | **unverified** integration | Useful retained format; loader side effects and live-leaf gap prevent claiming a pass (§5). |
| Coherent ongoing output + saved history | **unverified** | **unverified** | Snapshot facilities are candidates, not a demonstrated single-conversation projection. No presentation work performed. |
| Honest outcomes, recovery, and no automatic replay | **unverified** | **unverified** | No harness/service/browser transport selected or tested. Retry defaults not verified. |

“Fail” applies to the named inspected mechanism under the frozen requirement; “unverified” must not be read as pass. Neither backend passes the required gates. I2–I5 live phases were **not run**, not failed experiments. I6 is a blocked-work synthesis pending the operator's explicit next decision.

## 3. Supported-interface capability sketches

### Herdr

- `workspace list`, `tab list --workspace …`, `pane list --workspace …`, `agent list/get`, and `pane process-info` expose topology, existing labels, current agent classification, shell PID, foreground process group/process metadata, and terminal/pane identifiers. A read of the coordinator's own process metadata confirmed that the foreground process list can contain more than Pi; do not assume its first PID is the agent.
- The installed `--skill` says public pane IDs are server-scoped, closed IDs are not reused, and moves can change workspace-qualified IDs. Names follow the current occupant and are cleared on exit/release/replacement. These are useful guarantees, but neither a pane nor a reusable name identifies a particular conversation state.
- Existing integration v9 reports the Pi file path (or ID fallback) from `ctx.sessionManager.getSessionFile()/getSessionId()`. Coordination launch responses actually contained `agent_session.kind=path`, `source=herdr:pi`. This corrects the old notes' assumption that Herdr association was wholly unknown. It is **not** proof of switch/fork freshness, branch association, or coverage of Pi processes without that integration.
- `agent prompt` rejects an already-classified blocked agent and documents one ordered text + encoded Enter submission honoring bracketed paste. Success means the submission was written, not that Pi accepted it. `--wait` tracks lifecycle state, not a specific turn; it cannot correlate an individual operation acknowledgment. It does not promise to replace an existing editor draft.
- `agent send-keys` validates key names before writing. `pane.send_input` exists in the schema with `pane_id`, optional `text` and `keys`; this is not evidence of a process/conversation transaction.
- Read sources include `visible`, `recent`, `recent-unwrapped`, and agent `detection`; read results include revision and truncation fields. Prefer a current visible snapshot for a nonintrusive candidate. The skill explicitly warns that some idle-agent history collection can manipulate application-owned history and restore the viewport afterward: a command named “read” is not proof that every source is nonintrusive. No history backfill/read experiment was invoked.
- Activity hooks in integration v9 report working at `agent_start` and idle at `agent_settled` when `ctx.isIdle()` is true. Blocked depends on `herdr:blocked` events. The skill distinguishes server seen-state `done` from `idle`, and says `unknown` does not prove completion. Snapshot quietness is not an Idle source. Hook delivery/freshness and all dialog coverage remain unverified.

References: installed `herdr --skill`; help for `agent`, `pane`, `agent prompt`, `agent read`, `pane process-info`; schema `/schemas/success_response/$defs/{AgentInfo,PaneInfo,PaneProcessInfo,PaneProcessInfoProcess,PaneReadResult}`; integration source lines 74–140 and 177–261.

### tmux

- Pane enumeration/formats, explicit socket selection, literal-key input, paste buffers, and screen capture are candidates for discovery, display labels, input, and a current snapshot. Pane/window/session names are display metadata, not conversation identities. `list-panes -a` enumerates one server, not every arbitrary `-S` socket. Complete server/socket discovery remains unverified.
- A server/socket plus pane ID can address a PTY, but does not by itself bind input to a validated Pi process or in-memory branch. `pane_pid` is documented as the first process in the pane, not the current foreground Pi. Ordinary terminal input can be consumed by a replacement foreground program; `respawn-pane` can reuse the same pane. Additional process inspection before sending does not close that interval. Per-client command ordering, `if-shell`, and `wait-for` locks do not establish a Pi-side consumption boundary.
- `capture-pane` can supply rendered content, not role-attributed live Pi events or complete history. Do not install `pipe-pane`: it can take over an existing output pipe. No tmux server/pane was created or controlled.
- There is no verified Pi activity or per-operation acceptance source in this track; Unknown and acceptance-unconfirmed remain permissible limitations, not cures for unsafe targeting.

References: installed `tmux(1)` manual, OPTIONS `-L/-S/-N`; COMMANDS pane/window/session ID rules; `list-panes`, `capture-pane`, `send-keys`, `paste-buffer`, `respawn-pane`, `pipe-pane`, `if-shell`, `wait-for`; FORMATS `pane_pid`, `pane_tty`, `pane_current_command`, `socket_path`, `pid`, `start_time`, `pane_title`, `session_name`, `window_name`. The man tool staged this at `/Users/ricardo/cache/pi-extensions/toolbox/artifacts/1794268645323/manpage.txt`: lines 75–100,235–244,505–524,1368–1396,1619–1628,1739–1756,1801–1809,1959–1982,3413–3519,4097–4109,4136–4145,4172–4178. `send-keys -l` documents literal UTF-8 transport, not literal Pi editor interpretation; `paste-buffer` can transform line endings and sanitize controls.

## 4. Blocking evidence and important distinctions

### 4.1 Saved file is not the current branch

`PI/dist/core/session-manager.js:1173–1186` implements `branch()` and `resetLeaf()` by changing `this.leafId` only. `_buildIndex()` at lines 733–743 instead restores the last physical non-header entry as the leaf when loading. Two live states can therefore have identical file bytes but different selected leaves. More polling or a different JSONL parser cannot recover information that has not been written.

Herdr integration v9 reads only session file/ID (lines 74–92), reports at `session_start` and `agent_start` (229–251), and has no leaf report or tree-navigation handler. Its API `AgentSessionInfo` is `{source, agent, kind, value}`; `PaneReportAgentSessionParams` has file/ID fields but no selected-leaf field. A correct file report therefore does not solve this blocker.

Pi documents in-process extension access (`PI/docs/extensions.md:1201–1211`: file, ID, `getLeafId()`, branch) and subprocess RPC (`PI/docs/rpc.md:3–20`; `rpc-commands.md:154–184,689–742`), not an external attachment API for an arbitrary already-running interactive Pi. The ordinary no-summary/no-label navigation path actually invokes `branch()`/`resetLeaf()` and emits `session_tree` with `newLeafId` (`PI/dist/core/agent-session.js:3380–3431`), so the in-memory-only case is reachable, not merely an unused helper.

`PI/docs/environment-variables.md:18–48` documents current file/ID injected into LLM-callable shell children at invocation time, not a passive external query or inherited process-start identity; no leaf is provided. `/tree` stays in-file while `/fork`/`clone` create files (`PI/docs/sessions.md:14–40`). Introducing a required bridge/launcher is an integration decision, not an authorized workaround. Do not substitute directory matching, most-recent file, last disk entry, terminal-text guessing, or historical `/session` output.

### 4.2 No proven validation-to-control boundary

Herdr schema `/schemas/request/$defs/AgentPromptParams` has only `target`, `text`, and optional `wait`; `AgentSendKeysParams` has only `target` and `keys`. Raw pane text/key/input mutations likewise have no expected process incarnation, saved file, selected leaf, or previously observed revision. Read-side revisions are not a mutation precondition. Agent-name validation is useful, but does not establish that a browser's old conversation association still holds.

No supported guarantee was identified that ties these mutations to the previously validated Pi conversation through the eventual editor consumption of bytes. Internal server ordering has not been source-audited; absence of request fields alone is not a proof about all internals. What is missing is a supported guarantee sufficient for this design. tmux has the same unresolved PTY-recipient/conversation boundary. Do not build the control path on a process preflight check.

### 4.3 Default ordinary submission is not byte-exact

`PI/dist/modes/interactive/interactive-mode.js:2594–2598` starts the default editor submit handler with `text = text.trim()` and rejects empty results. For example, nonempty `"  hello\n"` becomes `"hello"` before ordinary prompt processing. This contradicts design §5.1's exact nonempty text including newlines, even if terminal delivery itself were perfect. It is a source-inspected conflict, not a live observation.

Preserving interior multiline text would not prove preservation of boundary whitespace. A custom editor or changed input path has not been selected, authorized, or tested. The independent requirement to replace rather than append/submit a desktop draft also remains unverified. Do not silently normalize the remote draft or weaken “exact” to make a demo pass.

### 4.4 Stop is not established, but do not misreport abort as queue-retaining

`PI/docs/usage.md` (“Change direction”) says aborting returns queued messages to the editor. Source `interactive-mode.js:2470–2475,3926–3979` shows the normal streaming Escape path calling `restoreQueuedMessagesToEditor({abort:true})`: it synchronously clears session/compaction queues, restores their text into the desktop editor, and invokes asynchronous abort. This is materially different from claiming the interactive path simply leaves steering queued.

It still does not prove RAI Stop. Restored text is not discarded editor content; exact subsequent Send must safely replace it. Compaction/retry have distinct Escape handlers (3027–3031,3088–3103); custom dialogs/keybindings may differ. No remote-operation ordering, consumption boundary, partial input, queue refilling, idle-with-queue, acknowledgment, or connection-loss experiment passed. Stop remains unverified, not “proven impossible” and not “Escape is sufficient.”

## 5. Saved-history desk findings

The current v3 JSONL entry graph is useful for retained completed history, tools, and compaction originals once a trustworthy leaf is supplied (`PI/docs/session-format.md:1–75,123–155,209–248`; `sessions.md:30–56`). Walk `parentId`, not a branch summary's `fromId`, to avoid mixing siblings. Fork/clone can preserve entry IDs, so keys need session identity as well as entry ID. Compaction does not delete originals; context edits affect future model input, not raw history. `buildContextEntries`/`buildSessionProjection` are model-context projections, not full historical readers (`PI/dist/core/session-manager.js:194–286,1069–1086,1215–1322`).

Already-truncated stored output cannot be reconstructed from JSONL; expose available truncation/full-output references instead of promising missing bytes (`PI/docs/message-types.md:200–217`). Pending streaming output is not a complete saved event feed. No coherent history/snapshot reconciliation was demonstrated.

**Do not call the installed loader on live source files.** `PI/dist/core/session-manager.js:313–369` skips malformed lines and, with a valid parsed header, appends a newline when trailing pending text exists. That includes incomplete/malformed final text. `_loadEntries()` at 718–730 can migrate and rewrite a file. A read-only history adapter must read bytes as data, preserve the source unchanged, defer incomplete trailing records, and surface malformed completed records rather than copy those helper semantics.

Other helper hazards: `buildSessionPath` falls back to the last entry for an unknown leaf and tolerates a missing parent (`session-manager.js:124–144`); `SessionManager.open` calls loading paths that may repair, initialize, or migrate storage (`666–685,718–765,1338–1360`). Successful loading is not validation of future formats. No live transcript was opened through these helpers.

**Executed synthetic reference checks (history investigator; all in memory, no installed parser invoked):** a nine-record v3 fixture contained header, `u → a → t`, sibling children `left`/`right` of `t`, then `right → c → after → e`. `a` included explicit thinking/tool call; `t` was an error tool result with >131,000 JavaScript characters including Unicode, escaped newline, U+2028/U+2029. `c` compacted with first-kept `t`; `e` context-edited `u` out of future model input.

Assertions passed: leaf `e` raw ancestry was `[u,a,t,right,c,after,e]`, excluding `left` while retaining originals; the compaction-aware entry sequence was `[c,t,right,after,e]` (not final model messages). Three-entry older-page calculations yielded `[[u],[a,t,right],[c,after,e]]`; concatenation and full long-result content were preserved. LF-only framing produced nine records despite Unicode line separators. Both incomplete JSON and valid JSON without final LF stayed pending; malformed LF-complete JSON was classified as an error. The same serialized graph supported different in-memory leaves `e` and `a`: no file-based calculation can distinguish them.

These checks establish reference expectations, **not** a tested production parser, bounded-byte transport, or live reader. Reproduce using the stated graph and `parentId` ancestry, changing only the externally supplied leaf; no private fixture is needed. A future reader must retain incomplete UTF-8/LF tails, report malformed completed records, and page content without silently truncating long blocks. Entry-count paging alone does not bound a huge record; full retained content needs separately accessible expansion.

**Still untested:** branch-summary ancestry; retain-none/successive compaction; null leaf/multiple roots; old/future formats and unsupported entries; duplicate IDs, missing parents, cycles; UTF-8 split across reads; completion of an append tail; unavailable/permission-denied/replaced/truncated files; actual byte-bounded paging and full-result expansion; OS concurrency and source-byte nonmutation; live branch/fork association; ongoing-output reconciliation. No disk fixtures or reusable parser/harness were created because the live identity gate is blocked.

## 6. Outcome/status implications and recovery limits

- **Not sent:** only when an operation is known to have failed before its earliest write. An unverified association must disable control, not be guessed.
- **Input sent; acceptance unconfirmed:** candidate Herdr prompt write-success wording under its documented boundary, not a tested RAI end-to-end result. tmux command success alone likewise does not prove Pi acceptance.
- **Sent / Steering queued:** no per-operation Pi acceptance/queue correlation established; text equality and settled-state waits are insufficient.
- **Outcome unknown / Stop outcome unknown:** required when a connection is lost after a possible effect. No automatic retries may be inferred safe.
- **Stopped · steering cleared:** not currently justified for either backend.
- Herdr's integration retries metadata reports (`herdr-agent-state.ts:22–54`). This is not evidence that a future action transport retries, nor evidence it does not. Browser/service/adapter retry defaults and restart recovery remain untested; no production transport has been chosen.

These are conservative boundary statements, not I5 passes. No browser/service harness, receipt store, transcript archive, production stack, or dashboard was built.

## 7. Decision and deferred experiment authorization

**Recommendation:** do not proceed to stack selection or production implementation. First decide whether to reopen the integration direction to obtain a supported current-conversation identity and conditional control boundary. A required Pi bridge or launcher is outside the frozen scope and needs explicit agreement. Alternatively, identify an existing documented interface that supplies those guarantees for both backends. Separately decide whether ordinary Pi boundary-whitespace normalization is acceptable or the exact-input requirement must remain unchanged. Neither choice has been made here.

More live Send tests cannot repair the missing leaf information. If scope stays frozen and no additional supported interface is identified, stop the investigation as **no-go for the inspected mechanisms**. A read-only UI or dropping one backend would be a separate product-scope decision, not an implicit fallback.

**Deferred authorization request — not permission to execute:** only after the identity/control question has a plausible contract, authorize one named disposable Herdr instance and one separately named tmux server (both `rai-investigation`), two Pi panes per backend, and repo-local disposable directories under `.rai-investigation/`. Never use the coordinator/research panes or existing conversations as test targets. The coordinator owns the Herdr test targets; a named investigator owns tmux targets, without shared writes.

Proposed phases, each needing an agreed budget and permission before starting:

1. **I2, up to 20 minutes/backend:** same-directory Pi instances, duplicate/absent labels and rename; conversation switch/fork/tree navigation; deliberate process replacement and unrelated foreground receiver between validation and control; disposable backend restart; nested visibility only within those disposable targets. Stop immediately if no supported ordering guarantee explains safety. Harmless recipient markers only.
2. **I3, up to 20 minutes/backend after I2 passes:** single/multiline text, `hello`, `  hello\n`, Unicode `café 雪 🧪`, literal `$() ; | & < >` and shortcut-like text; disposable nonempty desktop drafts; bounded echo/file-read workloads to create active turns and multiple queued steering messages. Never inject blindly into dialogs. Exercise partial submission, repeated Stop, abort/clearance partial failure, and disconnect without process termination as a Stop substitute.
3. **I4–I5, up to 20 minutes/backend after prior gates pass:** long benign output, visible snapshots, wrapping and explicitly disposable-pane resize, saved-history reconciliation, conversation changes during recovery, loss after input but before acknowledgment, and harness restart. No automatic action replay. Use ordinary saved files and the smallest ephemeral harness only.

Cleanup authority requested would cover **only** the disposable instances, Pi processes/panes, harness, test directories, and test conversation files created by these phases. Record exact returned IDs/paths at creation; do not delete by broad label/path guesses, touch existing agents, stop the default Herdr server, or change installed integrations/keybindings. No such test resources or files exist yet, and none of these phases is currently authorized. If a proposed fault cannot be injected with supported tooling inside this envelope, return for a decision rather than developing a workaround.

## 8. Coordination, review, and cleanup

Research agents were launched with `--presets:preset eng` in background tabs of the coordinator's inherited workspace `w12`, with explicit repository cwd. Writes are coordinator-only in this document; workers/reviewer are read-only.

| Role | Tab / pane | Session |
| --- | --- | --- |
| tmux/Pi identity investigator | `w12:t3` / `w12:p3` | `01a1c2be-26c9-71e1-bb3d-96a3f5e00e43` |
| history investigator | `w12:t4` / `w12:p4` | `01a1c2be-3326-737a-b210-c7fcc902437a` |
| fresh correctness reviewer | `w12:t5` / `w12:p5` | `01a1c2bf-c75a-7377-a1fc-6c21fa3b375e` |

No live-test cleanup was needed. After the investigators and reviewer finished, all three coordinator-created tabs above were closed successfully using their returned IDs. No pre-existing agents/tabs were interrupted. Generated tool/cache artifacts are ordinary transient tool outputs, not a new retained evidence archive. No repository build/test suite is applicable to this documentation-only investigation; source inspection and synthetic checks are explicitly distinguished from live validation.

**Review:** the fresh read-only reviewer independently verified the reachable in-memory-only tree-navigation path, default submit trimming, Herdr's file-only reports and public mutation schema, and streaming Escape queue-clear/editor-restore behavior. No blocking findings; the reviewer confirmed that the evidence supports stopping at I1, not full-scope feasibility or a claim that all future integrations are impossible. **Operator decision:** pending; no live phase or scope change has been authorized.
