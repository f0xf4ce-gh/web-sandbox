# Web dev sandbox

This checkout is the complete private sandbox: a real tmux-backed terminal,
simultaneous desktop and mobile previews, CSS hot swapping, console capture,
scroll linking, a loopback port proxy, and a mobile-friendly PWA shell behind
Caddy’s local TLS certificate.

## Quick start

The easiest path is:

~~~sh
./scripts/sandbox.sh build
./scripts/sandbox.sh start
./scripts/sandbox.sh check
./scripts/sandbox.sh demo
~~~

Then open <https://localhost>. Caddy’s first certificate is private, so a
browser will ask you to trust its local certificate. The helper uses `curl -k`
for its local-only checks, but browsers and phones need the local CA trusted.

For laptop or phone access, copy `.env.example` to `.env`, set
`SANDBOX_HOST` to the hostname or VPN/LAN address you will use, and pass the
same URL to the checker:

~~~sh
cp .env.example .env
# edit SANDBOX_HOST in .env
SANDBOX_URL=https://your-hostname ./scripts/sandbox.sh check
~~~

After code changes, rebuild the image and restart the app with:

~~~sh
./scripts/sandbox.sh rebuild
~~~

Useful commands:

~~~sh
./scripts/sandbox.sh status       # container state
./scripts/sandbox.sh logs        # follow app and Caddy logs
./scripts/sandbox.sh terminal    # send one command through the PTY websocket
./scripts/sandbox.sh demo        # install the bundled preview-check project
./scripts/sandbox.sh preview     # verify HTML injection and CSP
./scripts/sandbox.sh proxy      # verify /p/5173/ through the single origin
./scripts/sandbox.sh ca          # copy Caddy's local root certificate
./scripts/sandbox.sh stop        # stop containers; keep the workspace volume
~~~

The `check` command validates the Compose file, starts the stack if needed,
checks the HTTPS health route and session endpoint, confirms the app is
running as uid 1000, and sends a harmless command through the real terminal
websocket. `proxy` starts a disposable loopback HTTP fixture for ten seconds,
checks it through Caddy, and lets it expire. Neither command deletes the
workspace or its tmux session.

For a quick direct check without the helper:

~~~sh
curl -k https://localhost/healthz
~~~

The response should be `ok`.

To inspect the local CA that needs to be installed on a laptop or phone:

~~~sh
./scripts/sandbox.sh ca
~~~

The default app is attached only to the internal Docker network. When a
workspace dependency needs to be installed, run the dedicated online helper
for that command and then remove it:

~~~sh
docker compose --profile online run --rm app-online npm install <package>
~~~

The Docker socket is not mounted. No application code makes an external
request. The first image build needs internet access to download the pinned
base image and npm packages; once the image is built, `start`, `check`, and the
running app do not need internet access.

The bundled `fixtures/preview-check/` project is only a test project. Install
it into the workspace with `./scripts/sandbox.sh demo`, or create your own
directory from the terminal. It is useful for testing CSS hot-swap without
having to prepare a project first. Once it is installed, open the app, leave
the project selected, type in the input in both frames, edit
`/workspace/preview-check/style.css` from nvim, and confirm both borders change
without losing the input values. Edit the HTML or JavaScript next to verify a
full reload.

For the fastest final smoke pass:

~~~sh
./scripts/sandbox.sh check
./scripts/sandbox.sh demo
./scripts/sandbox.sh preview
./scripts/sandbox.sh proxy
~~~

The desktop app keeps both frames visible. On a phone, use the bottom tabs;
the terminal tab adds Esc, Tab, Ctrl, Alt, and arrow keys above the keyboard.
The mobile frame emulates width-based media queries only. Use its menu’s QR
code to test touch, pointer, user agent, and device pixel ratio on real
hardware.
