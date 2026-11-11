# RAI · Remote Agent Interface

One Go service and a small TypeScript extension inside participating Pi sessions.
The browser provides a session menu, retained conversation history plus ongoing
output, a multiline message input, Send, and Stop. **No React, separate frontend service,
database, terminal capture, or automatic Pi launching.** Herdr/tmux own Pi.

## Build and check

Prerequisites: Go 1.25+, Node 24+, Bun, and Just. Pi extension types are pinned to
1.5.2; the running extension uses its host's public API and Node built-ins.

```sh
bun install --frozen-lockfile
just build
just lint
just test
```

Pi's `build`, `lint`, `test`, and `deps` tools use these same workflows. Build
produces `bin/rai` with embedded HTML/CSS/JavaScript and type-checks the extension.
Test builds the current executable, runs race-enabled Go tests, then Node
extension/client-state/DOM tests. `linkedom` is a development-only DOM fixture,
not a production browser dependency. Temporary test files are repo-local under
ignored `.rai-investigation/`.

Focused examples: `just test internal/history`, `just test internal/web`,
`just test internal/web/assets/client.test.js`, `just lint extension/index.ts`.

## Run

```sh
./bin/rai serve
```

Open **http://localhost:8484** (or **http://127.0.0.1:8484**). The light session
sheet puts **Connected** sessions first, with a count and connection badge.
Other discovered Pi sessions are folded under **Other Pi sessions**; that does
not prove the extension is uninstalled, only that no RAI connection is active.
The chooser is a light sheet without a dark veil, retaining native modal
keyboard focus/Escape behavior. Discovery diagnostics are available separately
rather than obscuring the usable sessions.

**The service does not install/reload into existing sessions.** For an operator-
chosen **new** interactive Pi session, use its supported explicit extension load:

```sh
pi --presets:preset eng -e /absolute/path/to/pi-webui/extension/index.ts
```

For regular installation, add the absolute path to `extension/index.ts` to the
existing `"extensions"` array in `~/.pi/agent/settings.json`, preserving all other
entries/settings. New interactive Pi sessions load it automatically; explicitly
run `/reload` in each chosen idle existing session to load it there. No copying
of the extension's individual files is needed. Building/starting RAI never
installs it or reloads Pi. Only interactive TUI mode participates.

If nothing is connected, check that the extension loaded without terminal errors
and that Pi's `RAI_SOCKET` matches the service's bridge socket. After rebuilding
RAI, stop/restart **only the RAI service** and refresh the browser to load its
new embedded assets. Pi can stay running; the extension reconnects automatically.

The default bridge socket is `~/.local/state/rai/bridge.sock`. Its directory must
be user-owned mode 0700 without symlink components; the socket is mode 0600.
Startup refuses any existing socket path. After a crash, confirm its service is
stopped before removing that exact abandoned socket. Graceful shutdown removes
the service-owned socket.

### Configuration and tablet access

`./bin/rai serve -config PATH` reads JSON with `address`, `port`, and optional
absolute `socket`. See [loopback example](configs/example.json). Defaults are
`127.0.0.1:8484` and the private socket above.

For tablet access, explicitly choose **the host's private LAN or Tailscale IP**,
then browse to that exact IP and port on the tablet. For example:

```json
{"address":"100.90.1.2","port":8484}
```

That IP must belong to your host. Wildcard/public binding is refused. There is
**no login or TLS**: expose only to a trusted LAN/Tailscale network and apply
appropriate firewall controls. Origin/Host/CSRF checks are not authentication
against another untrusted LAN client. A proxy/alternate hostname/HTTPS origin is
not configured by this literal-IP deployment surface; do not expose it publicly.

When overriding `socket`, give participating Pi processes the same
`RAI_SOCKET=/absolute/private/bridge.sock` environment value. Starting/stopping
RAI never starts/stops Pi. Ctrl-C or SIGTERM stops only RAI-owned work.

## Browser behavior

- Select by existing labels plus context; labels never become control targets.
  Discovery, connection, history, and activity failures stay distinct. An old
  selection never silently redirects to another process after it disappears.
- A new session with no conversation shows **No messages yet**. Pi may keep
  setup/name metadata in memory without creating its planned JSONL file until
  the first user/assistant message. Missing previously observed/saved history
  remains an error, not an empty conversation.
- Read the current retained `parentId` ancestry, including stored compaction
  originals. The normal timeline shows conversation messages, not model/thinking
  configuration, internal custom data or system setup. **View → Show session
  records** exposes those as quiet collapsed details. Errors and meaningful
  compaction/branch boundaries remain visible. Load older bounded pages and
  expand full retained entries. Thinking
  and tools have independent individual/bulk disclosures. Unknown content and
  unavailable sources are explicit.
- Ongoing assistant/tool content is provisional. Confirmed persisted IDs and a
  safe cutoff replace it together; `message_end`, text matching and timers are
  not persistence evidence. Reading older content does not force-follow new
  output; **Go to latest** explicitly resynchronizes an over-one-page update gap.
- One ordinary textarea expands on focus; Send and Stop are the only composer
  actions. There is no Review message dialog, receipt archive, draft menu or
  reuse/unlock step. Unsent input stays with its conversation while this page
  remains open; reload loses it. Navigation never copies text into a new target.
  Escape compacts the editor without deleting the text.
- Send preserves exact nonempty Unicode text and uses ordinary Pi steering,
  without reading/submitting/clearing the desktop draft. It collapses the
  composer and dismisses the keyboard. Its honest result is **Submitted;
  acceptance unconfirmed**, not an invented Sent/queued receipt.
- Lost/failed Send leaves the text directly editable with an inline warning;
  another Send is an ordinary deliberate action, not a recovery workflow.
  There is no automatic control retry or replay. Send uncertainty
  and Stop feedback can coexist; Stop does not wait for Send's result.
- Stop uses `ctx.abort(); ctx.ui.setEditorText("")`. It may discard desktop text
  restored from queued input. A remote draft is untouched. **Stop requested**
  is dispatch evidence, not a guarantee that all work/independent workers ended.
- Idle is not a task-completion or safe-shutdown verdict.

All content is rendered through inert DOM text/code, without active HTML,
terminal controls or automatic remote images/resources. Same-origin requests and
per-start CSRF protection guard POST controls; no permissive CORS or control GET.

## Validation and known limits

First-phase real-Pi smoke tests passed on macOS x86_64, Pi 1.5.2, Herdr 0.9.3,
and tmux 3.7b: Send/reply, draft preservation, queued-steering discard/Stop,
identity invalidation, duplicate/renamed labels, unsupported extension dialogs,
missing-extension discovery and one joint service restart without observed
replay. A real Node-host tmux discovery omission was fixed and rechecked.

History/projection, browser request security, input/dispatch state, DOM rendering and
client interactions have synthetic tests and independent source reviews. The
Go/TS fixture exercises the real service, literal HTTP controls, duplicate-ID
rejection, restart and stale targets. **DOM geometry is synthetic: actual browser
scrolling, a real tablet/software keyboard, and full live history reconciliation
have not been accepted yet.** No real-browser automation tool was available.
The operator explicitly deferred the broad second smoke phase to proceed with
history/UI implementation; untested cases are not silently called passed.

Remaining limits:

- Delayed Send-after-Stop and settlement-deferred Send/navigation races were
  explicitly accepted. Normal held-input navigation rejection was live-checked;
  the settlement-deferred race was not reproduced by the smoke fixture. There
  is no atomic targeting/acceptance guarantee beyond the available API.
- Observed manual compaction conservatively disables Send until an authoritative
  later agent event or explicit reload. A later extension cancelling navigation
  can likewise require resynchronization. Built-in terminal-only dialogs and
  nested ownership are not fully observable/validated; no terminal fallback.
- Extension load midturn cannot recover output before it loaded; history is
  withheld until an authoritative boundary. Older bridge versions lacking
  `historyReady` require an explicit extension reload for history support.
- Discovery covers inherited/default mux servers. Node-host tmux candidates use
  tty-scoped exact foreground `pi` process metadata, never terminal/title
  scraping. Other launchers/nesting can remain unidentifiable. Ambiguous
  ownership disables browser controls.
- Reader bounds: 64 MiB source file, 16 MiB record, 100,000 entries and 1,024
  remembered associations. Unsupported sizes/formats, malformed completed
  records, unavailable/replaced/truncated sources are explicit errors. Reads
  never migrate, repair, or write the source. The reader assumes Pi's normal
  append-only writer; arbitrary concurrent same-inode/same-size overwrites are
  not transactionally protected. Expansion transfers up to 64 KiB
  per chunk; pages contain at most 32 entries / 256 KiB. Large entries are
  deferred, not silently truncated. A changed source needs a fresh association.
- Bridge bounds: 256 KiB provisional content, 64 tools and 1 MiB frames; overflow
  is explicit. Control IDs are connection-local and capped at 1,024 operations;
  reconnect is required on exhaustion. No permanent receipt/archive store.
- Linux, real-Pi slow readers/response loss/manual compaction/nesting, leading
  command cases and real-tablet interaction remain provisional.

The useful next check is a small real-browser conversation loop, with exact
operator-chosen disposable/new targets if the agent runs it—not another broad
hour-long smoke gate. See [execution status](docs/execution-plan.md).

## Local diagnostic interface

Read-only: `GET /health`, `/sessions`, `/sessions/ENDPOINT_ID`, and
`/conversation/ENDPOINT_ID?association=ASSOCIATION_ID`. History expansion is
ancestry-checked at `/conversation/ENDPOINT_ID/entries/ENTRY_ID?...&offset=N`.
No browser-provided file paths are accepted. Browser POST `/control` additionally
requires exact Origin and the current `/api/bootstrap` CSRF token.

The private-socket CLI remains available for operator-chosen targets:

```sh
printf '%s' 'exact message text' | ./bin/rai send -endpoint ENDPOINT_ID -association ASSOCIATION_ID
./bin/rai stop -endpoint ENDPOINT_ID -association ASSOCIATION_ID
```

Use freshly verified opaque IDs, never labels/panes. Pass `-config PATH` to both
service and CLI for overridden defaults. Send accepts at most 128 KiB of text.
