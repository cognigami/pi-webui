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
`just test internal/web/assets/client.test.js`, `just lint extensions/pi-webui/index.ts`.

## Run

```sh
./bin/rai serve
```

Open **http://localhost:8484** (or **http://127.0.0.1:8484**). The light session
sheet shows **only connected sessions**. There is no unreachable-session list,
Discovery details, or top-right debug Details panel. The icon-only **☰** button
opens the chooser (with an accessible Sessions label). Native modal keyboard
focus/Escape behavior remains; lookup failures stay visible without diagnostic
panels or stale unreachable choices.

**The service does not install/reload into existing sessions.** For an operator-
chosen **new** interactive Pi session, use its supported explicit extension load:

```sh
pi --presets:preset eng -e /absolute/path/to/pi-webui/extensions/pi-webui/index.ts
```

For regular installation, register the checkout as a local Pi package:

```sh
pi install /absolute/path/to/pi-webui
```

The package is named **pi-webui** and declares one entrypoint,
`extensions/pi-webui/index.ts`, so Pi displays `pi-webui/index.ts` instead of the
old generic `extension/index.ts`. Existing local-package installations keep the
same repository path and need no reinstall. If you configured the old entrypoint
directly in settings or launch arguments, replace it with the new path or use the
package installation above. There is no compatibility entrypoint that could load
a second copy. New interactive Pi sessions load it automatically; explicitly run
`/reload` in each chosen idle existing session to pick up the renamed resource.
No copying of the extension's individual files is needed. Building/starting RAI never
installs it or reloads Pi. Only interactive TUI mode participates.

If nothing is connected, check that the extension loaded without terminal errors
and that Pi's `RAI_SOCKET` matches the service's bridge socket. After rebuilding
RAI, stop/restart **only the RAI service** and refresh the browser to load its
new embedded assets. Pi can stay running; the extension reconnects automatically.

The default bridge socket is `~/.local/state/rai/bridge.sock`. Its directory must
be user-owned mode 0700 without symlink components; the socket is mode 0600.
Startup holds a private `bridge.sock.lock` until the listener closes. It refuses
live sockets, symlinks and non-socket paths, but recovers an owned abandoned socket
when a connection is refused. Graceful shutdown removes the socket and releases
the lock. The empty lock file stays in place; do not delete it while RAI runs.

### macOS LaunchAgent

[configs/launchd.example.plist](configs/launchd.example.plist) is the per-user job
`com.user.pi-webui`. Replace `/Users/you` with your home directory before copying
it to `~/Library/LaunchAgents/com.user.pi-webui.plist`. It runs `/opt/local/bin/rai`
with `~/.config/pi-webui/config.json`, writes to
`~/Library/Logs/pi-webui/pi-webui.log`, and supplies PATH for Herdr/tmux discovery.
Its `HERDR_SOCKET_PATH` must match the Herdr server used by participating Pi
sessions (the template uses `~/.config/herdr/herdr.sock`); discovery without the
same server namespace cannot establish pane ownership.
Create those configuration/log directories first (mode 0700) and copy your chosen
LAN config to the installed config path (mode 0600). Keep the checkout's original
config unchanged; the installed copy is the LaunchAgent's active configuration.

After a successful build, install the binary and load the prepared plist:

```sh
sudo install -m 755 bin/rai /opt/local/bin/rai
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.user.pi-webui.plist"
```

`KeepAlive` starts it on load and at login, and restarts it if it exits. No
separate kickstart or shell wrapper is needed. This is a user-login service, not a
root daemon, and it does not prevent machine sleep or start/manage Pi sessions.
The bridge address stays `~/.local/state/rai/bridge.sock` for compatibility with
already-loaded extensions; new install/config/log names use **pi-webui**.

After later builds, repeat the binary installation, then restart only this job:

```sh
launchctl kickstart -k "gui/$(id -u)/com.user.pi-webui"
```

Refresh the browser after updating. To stop the service (without KeepAlive
restarting it), use `launchctl bootout "gui/$(id -u)/com.user.pi-webui"`. Remove
only its plist if you also want to disable loading at future logins. Avoid running
a second manual RAI instance beside the job. Rebuilds do not automatically update
the installed binary. The active LAN address must still belong to this machine;
startup failures are recorded in the job's log and launchd retries are throttled.

### Configuration and tablet access

`./bin/rai serve -config PATH` reads JSON with `address`, `port`, and optional
absolute `socket`. The file path is explicit; there is no auto-loaded network
configuration. Defaults are `127.0.0.1:8484` and the private bridge socket above.

For tablet access:

1. Copy [configs/lan.example.json](configs/lan.example.json) to `configs/lan.json`.
2. Edit **address** to this machine's actual private LAN IP; **port** is the HTTP
   port you want. The example below is not an automatically detected address:

   ```json
   {"address":"192.168.1.50","port":8484}
   ```

3. Stop only the current RAI service (Ctrl-C in its terminal), then run:

   ```sh
   ./bin/rai serve -config configs/lan.json
   ```

4. On the tablet, open `http://192.168.1.50:8484`, substituting that actual
   host IP/port, or use the machine's DNS/mDNS name (for example,
   `http://your-mac.local:8484`). No hostname registration or allowlist is needed.
   The name must resolve to the listening address, the tablet must be able to
   reach it, and the firewall must allow the port. RAI still listens on one
   explicitly selected address, not every interface.

A Tailscale host IP is also supported. The address must belong to your host;
see [loopback example](configs/example.json) to revert to local-only access.
Changing address/port does not require reloading Pi or changing the bridge
socket. The extension reconnects when RAI restarts.

Wildcard/public binding is refused. There is **no login or TLS**: expose only
on a trusted LAN/Tailscale network and apply appropriate firewall controls.
HTTP hostname aliases and forwarded browser ports need no RAI configuration;
Origin must still match the browser's request Host, and controls require the
per-start CSRF token. Cross-site requests are rejected and no permissive CORS is
provided. HTTPS reverse-proxy support is not configured by this HTTP-only service.

This deliberately simple LAN mode has **no Host allowlist or DNS-rebinding
protection**. LAN-only binding does not itself protect against a hostile website
using DNS rebinding. Origin/CSRF checks are not authentication; anyone who can
reach RAI directly can access its sessions and controls. Do not expose it publicly.

When overriding `socket`, give participating Pi processes the same
`RAI_SOCKET=/absolute/private/bridge.sock` environment value. Starting/stopping
RAI never starts/stops Pi. Ctrl-C or SIGTERM stops only RAI-owned work.

## Visual treatment

Warm-neutral **private-tool** styling: warm light-gray ground, near-white
message cards/chrome, white input/control surfaces, dark neutral text,
locally bundled Google Sans, and one restrained slate Send action. This approved
middle ground replaces the earlier Sand/yellow treatment; it is not official
Google branding. No artwork, texture, animation, external font request or new
frontend framework. Code retains the system monospace stack. The fonts' OFL license is
included and served at `/fonts/GoogleSans-OFL.txt`.

Representative synthetic Chrome captures: [desktop at rest](docs/images/rai-warm-neutral-rest.png)
and [tablet-sized, editor focused](docs/images/rai-warm-neutral-focused.png). The test content is not a
live Pi conversation.

## Browser behavior

- Display the Herdr/tmux name first, then an existing Pi session name if the
  multiplexer has no name, then **Unnamed session**. Names are not generated,
  and labels like `node` or `1` are not judged or replaced. This is display-only:
  a Pi name does not establish ownership or enable controls. Older loaded
  extensions need an explicit `/reload` in each chosen idle session to report
  the optional name; new sessions load it normally.
- Select by existing labels plus brief project/folder context; labels and folders
  never become control targets. Folder context remains in the header; opaque
  workspace/pane IDs are not useful navigation labels and are not displayed.
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
  Token-only updates preserve completed-history DOM nodes, focus and text
  selection. Native summaries/load controls retain keyed focus on actual
  redraws; deferred expansion hands focus forward only if its loader still owns it.
- One ordinary textarea expands on focus and collapses on blur without clearing
  its text. A clean inset focus edge stays inside the field. Send and Stop are the only composer
  actions. There is no Review message dialog, receipt archive, draft menu or
  reuse/unlock step. Unsent input stays with its conversation while this page
  remains open; reload loses it. Navigation never copies text into a new target.
  Escape compacts the editor without deleting the text.
- Send preserves exact nonempty Unicode text and uses ordinary Pi steering,
  without reading/submitting/clearing the desktop draft. It collapses the
  composer and dismisses the keyboard. Normal dispatch clears the input quietly;
  no Submitted/acceptance notice is added to the conversation. This does not
  claim acceptance or queueing: the underlying API still returns no receipt.
  While pending, the Send button says Sending….
- Lost/failed Send leaves the text directly editable with an inline warning;
  another Send is an ordinary deliberate action, not a recovery workflow.
  There is no automatic control retry or replay. Send uncertainty
  and Stop failures can coexist; Stop does not wait for Send's result. Ordinary
  Send/Stop dispatch stays quiet; the footer is for actionable failure/uncertainty.
- Stop uses `ctx.abort(); ctx.ui.setEditorText("")`. It may discard desktop text
  restored from queued input. A remote draft is untouched. The protocol's
  `stop_requested` result is dispatch evidence, not a guarantee that all work/
  independent workers ended; it is not a visible success notice.
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
rejection, restart and stale targets. **Physical tablet/software-keyboard behavior and full live history
reconciliation remain unaccepted.** A later bounded headless-Chrome check using
synthetic content verified actual local font loading, text-selection/focus/scroll
stability during streaming, deferred-load focus and basic layout at desktop,
834×1194, 1024×420 and 512×384 CSS viewports. The latter two are shortened/zoom-
equivalent layout proxies, not a real OS keyboard or native 200% browser zoom.
Go tests separately cover actual embedded font routes/MIME/CSP. The visual fixture
never accessed live Pi conversations or controls. The operator explicitly deferred the broad second smoke phase to proceed with
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
