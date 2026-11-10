# RAI bridge prototype

One Go service and a TypeScript extension inside participating Pi sessions.
Herdr/tmux retain ownership of Pi. **This is a P2 diagnostic prototype, not the
tablet application. No live Pi validation or extension installation has occurred.**

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

**Live validation still needs operator authorization for exact disposable
targets, payloads, fault injection, and cleanup. Do not load/reload into existing
coordinator, worker, or production sessions.** Once authorized, a *new disposable*
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

## Current limits and gate

- Operator accepted delayed Send-after-Stop and the settlement-deferred
  Send/navigation race. Pi 1.5.2's normal async-input preflight navigation
  reservation is source-inspected, **not live-tested here**.
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
  Unintegrated tmux discovery identifies foreground `pi` only; node-hosted or
  nested sessions can be unidentifiable. No directory/title-based Pi inference.
- Observations are bounded (256 KiB current turn, 64 tools, 1 MiB wire frames);
  gaps and unavailable live content are explicit. Reconnect gets fresh endpoint
  identity and a snapshot, never replayed commands. Control IDs are transient,
  capped per connection; after 1024 local operations, reconnect is required.
  Persisted tool-ID samples above 128 IDs are explicitly unavailable, not silently partial.
- Only a small ancestry sample and conservative lower-bound cutoff are present.
  Later Pi boundary-handler proposals can extend the leaf beyond that cutoff;
  P3 must reconcile that persisted tail. Retained history, coherent browser
  history/provisional reconciliation, full UI, and drafts are not implemented.

**Next gate:** separately authorized disposable Pi tests under both multiplexers
on macOS, followed by correctness review. Linux and all real-browser/tablet
behavior remain provisional. P3 fixture preparation is allowed, but P3 integrated
acceptance and P4/P5 UI work remain gated. See [execution status and authorization
request](docs/execution-plan.md#current-execution-result-and-live-gate).
