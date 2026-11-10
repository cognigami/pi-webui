# RAI bridge prototype

One Go service and a TypeScript extension inside participating Pi sessions.
Herdr/tmux retain ownership of Pi. **This is a P2 diagnostic prototype, not the
tablet application. First-phase live smoke tests passed in disposable macOS
Herdr/tmux sessions; full bridge acceptance is still pending.**

## Build and check

Prerequisites: Go 1.25+, Node 24+, Bun, and Just. Development Pi types are pinned
to 1.5.2; the extension uses host-provided types and Node built-ins, not a second Pi runtime.

```sh
bun install --frozen-lockfile
just build
just lint
just test
```

Pi's `build`, `lint`, `test`, and `deps` tools use the same package/Justfile
workflows. Build produces `bin/rai` and type-checks the extension. Lint formats
Go/TS and checks both. Tests use synthetic data, fake Pi contexts, private
repo-local sockets, and the real service; **they do not prove Pi concurrency,
multiplexer integration, or tablet behavior**. Run build before tests.

Focused checks: `just test ./internal/bridge`,
`just test extension/observation.test.ts`, `just lint extension/index.ts`.
Test automatically builds the current executable, including for focused extension
checks. Temporary build/test files stay under ignored `.rai-investigation/`.

## Service / local diagnostic client

`./bin/rai serve` defaults to `127.0.0.1:8484` and
`~/.local/state/rai/bridge.sock`. It does not launch or install into Pi.
Optional `-config PATH` reads JSON; [example](configs/example.json) uses defaults.
Fields: `address` (literal loopback IP), `port`, and `socket` (absolute path).

The socket's directory must be user-owned mode 0700 without symlink components;
the socket is mode 0600. Startup refuses any existing socket path. After a crash,
confirm that its service stopped before manually removing that exact abandoned
socket. Normal graceful shutdown removes the service-owned socket.

Read-only HTTP diagnostics, with exact Host/Origin checking:

- `GET /health`
- `GET /sessions` — existing labels, participation, independent discovery failures
- `GET /sessions/ENDPOINT_ID` — one bounded current observation

No HTTP Send/Stop endpoint, browser UI, history reader, automatic remote resource
loading, LAN/public binding, authentication, or transcript/input logging is present.
Do not expose this prototype via a proxy; P5 must implement the browser control
boundary before LAN/Tailscale access.

Local controls use the **private socket only**. Copy a freshly verified
`endpointId` / `associationId` from diagnostics, never a label or pane ID:

```sh
printf '%s' 'exact message text' | ./bin/rai send -endpoint ENDPOINT_ID -association ASSOCIATION_ID
./bin/rai stop -endpoint ENDPOINT_ID -association ASSOCIATION_ID
```

Pass `-config PATH` to both service and client when overriding defaults.
Send preserves stdin bytes as UTF-8 text, including whitespace/newlines; it
rejects whitespace-only or over-128-KiB input. There is no automatic retry.
Results are **Submitted; acceptance unconfirmed**, **Stop requested**, rejected
before dispatch, or outcome unknown. A void Pi API return is not acceptance.
After uncertain results, check Pi before deliberately sending again.

## Extension load boundary

**The first disposable live phase was explicitly authorized and completed.
Further live phases need an agreed bounded scope. Do not load/reload into existing
coordinator, worker, or production sessions.** With authorization, a *new disposable*
interactive Pi can use its supported `-e /absolute/path/to/extension/index.ts`
option and `RAI_SOCKET=/absolute/private/bridge.sock` for an isolated test service.
Nothing here automatically modifies Pi settings or installed extensions.
Pi's supported discovery/package mechanism can be selected by the operator
only after validation; copying a file does not attach it to running sessions.

Only interactive TUI mode participates, because the inspected Stop path is
`ctx.abort(); ctx.ui.setEditorText("")`. Stop may discard the desktop editor's
restored queued text/draft, does not terminate Pi, and does not promise to cancel
independent workers. Ordinary Send never reads/submits/clears the desktop draft.
Stopping the RAI service with Ctrl-C or SIGTERM closes only RAI-owned sockets;
Pi remains independently owned by its multiplexer.

## Live smoke coverage

Tested on macOS x86_64 with Pi 1.5.2, Herdr 0.9.3 and tmux 3.7b:

- Both backends: real Send produced a saved user message and `RAI_OK` response.
  Unicode/multiline/whitespace plus an **embedded** command-looking line reached
  an ordinary input hook unchanged; the desktop draft remained untouched.
- A benign waiting tool plus queued steering was interrupted by Stop. Observed
  tool cancellation, empty pending queue/editor, and no queued user message in
  the active ancestry corroborated the dispatch result. Pi stayed alive.
- Navigation during held input was rejected by Pi; after release, navigation,
  reload, and fork invalidated old associations/endpoints. Duplicate/renamed
  labels did not redirect controls. Extension dialogs rejected Send.
- Service absence/restart preserved the four observed Pi PIDs/session IDs/input
  counts and established fresh endpoints, with no observed replay in that run.
- Missing-extension discovery worked for Herdr. A demonstrated tmux Node-host
  discovery omission was fixed using tty-scoped foreground process metadata,
  then checked against the actual disposable Pi without the RAI extension.

Independent correctness review accepted these as **bounded smoke evidence**, not
full P2 acceptance. See the [execution results](docs/execution-plan.md#current-execution-result-and-live-gate)
for limitations, phase scope, and cleanup. No regular-session installation occurred.

## Current limits and gate

- Operator accepted delayed Send-after-Stop and the settlement-deferred
  Send/navigation race. Pi 1.5.2's normal async-input preflight navigation
  reservation was source-inspected and checked with held-input navigation.
  The settlement-deferred race was not reproduced by the smoke fixture; no
  atomic-targeting guarantee is claimed.
- Before-tree invalidation rejects stale/transition controls without vetoing
  desktop navigation. If a later extension cancels navigation, RAI stays
  conservatively unavailable until a later agent lifecycle event or explicit
  reload resynchronizes it.
- Observed manual compaction disables Send. Success is not a public settled
  boundary, so a later agent start/settlement or explicit reload is required
  before Send is re-enabled. Stop remains available. Built-in terminal-only
  dialogs are not fully observable; unrecognized rejection stays unconfirmed.
- Extension UI prompts disable Send; historical prompts do not assert current
  pending input. `pending` is the public aggregate, not a complete TUI queue view.
- Discovery covers the service's inherited/default Herdr/tmux servers. Nested
  inherited contexts are explicitly ambiguous, not guessed ownership.
  Unintegrated tmux discovery uses command `pi`, or for Node hosts an exact
  foreground `pi` process on that pane's tty. Other launchers/nesting may remain
  unidentifiable. No directory, terminal-title, or terminal-output inference.
- Observations are bounded (256 KiB current turn, 64 tools, 1 MiB wire frames);
  gaps and unavailable live content are explicit. Reconnect gets fresh endpoint
  identity and a snapshot, never replayed commands. Control IDs are transient,
  capped per connection; after 1024 local operations, reconnect is required.
  Persisted tool-ID samples above 128 IDs are explicitly unavailable, not silently partial.
- Only a small ancestry sample and conservative lower-bound cutoff are present.
  Later Pi boundary-handler proposals can extend the leaf beyond that cutoff;
  P3 must reconcile that persisted tail. Retained history, coherent browser
  history/provisional reconciliation, full UI, and drafts are not implemented.

**Next gate:** agree the next bounded P2 live-acceptance phase for leading command
input, manual compaction, nesting and response loss/backpressure. These were not
passed by the first smoke phase. History/live reconciliation follows P3 implementation. Linux and all
browser/tablet behavior remain provisional. P3 fixture preparation is allowed,
but P3 integrated acceptance and P4/P5 UI work remain gated. See [execution status](docs/execution-plan.md#current-execution-result-and-live-gate).
