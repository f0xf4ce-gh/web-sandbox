# Web dev sandbox

Self-hosted single-user environment for developing and testing HTML, CSS, and
JavaScript projects in Docker.

The application provides:

- A real tmux-backed terminal with `nvim`, Git, and common shell tools.
- Simultaneous desktop and mobile preview frames for the same project.
- CSS hot swapping without reloading the page.
- Full reloads for HTML and JavaScript changes.
- A merged console for `console.*`, uncaught errors, and unhandled promises,
  tagged by viewport.
- Scroll-ratio linking between the two frames.
- A loopback port proxy at `/p/:port/` for local development servers and HMR.
- Local TLS through Caddy and a mobile PWA shell.

The runtime makes no requests outside the local machine. The default app
container is attached to an internal Docker network. Dependencies are vendored
in the image and the frontend is built with Vite during the image build.

## Requirements

- Docker Desktop or Docker Engine with Compose
- Internet access for the first image build only

After the image is built, the app can start and run without internet access.

## Run

From the repository root:

```sh
./scripts/sandbox.sh build
./scripts/sandbox.sh start
./scripts/sandbox.sh check
./scripts/sandbox.sh demo
```

Open [https://localhost](https://localhost). Caddy uses a local certificate;
trust it in the browser when prompted. To export the local root certificate:

```sh
./scripts/sandbox.sh ca
```

The `demo` command copies `fixtures/preview-check/` into the persistent
`/workspace` volume.

## Use

1. Select a project in the project menu.
2. Use the terminal to edit files under `/workspace`, for example:

   ```sh
   nvim /workspace/preview-check/index.html
   ```

3. Use the viewer to inspect the desktop and mobile frames simultaneously.
4. Edit CSS to test hot swapping and preserved form state.
5. Edit HTML or JavaScript to test full reloads.
6. Use the frame menu to copy a preview URL, open it in a new tab, or create a
   QR code for a phone.

To run a local development server inside the container, select `Port` as the
preview source and enter its port, for example `5173`. The viewer uses the
same-origin `/p/5173/` route, including WebSocket HMR traffic.

## Commands

```sh
./scripts/sandbox.sh build    # build the pinned Docker image
./scripts/sandbox.sh rebuild  # build and recreate the running stack
./scripts/sandbox.sh start    # start the stack
./scripts/sandbox.sh check    # HTTPS, Compose, uid, and PTY checks
./scripts/sandbox.sh demo     # install the bundled preview fixture
./scripts/sandbox.sh preview  # injection and CSP checks
./scripts/sandbox.sh proxy    # loopback port-proxy check
./scripts/sandbox.sh terminal  # PTY websocket check
./scripts/sandbox.sh status   # container status
./scripts/sandbox.sh logs     # follow Compose logs
./scripts/sandbox.sh ca       # export Caddy's local root certificate
./scripts/sandbox.sh stop     # stop containers; keep the workspace volume
```

The smoke checks are safe to rerun. `check` does not delete the workspace or
the tmux session. `proxy` starts a disposable loopback HTTP server and lets it
expire after the check.

## Laptop and phone access

For access from another device, set the Caddy hostname in `.env`:

```sh
cp .env.example .env
# Set SANDBOX_HOST to the machine hostname or VPN/LAN address.
./scripts/sandbox.sh rebuild
SANDBOX_URL=https://your-hostname ./scripts/sandbox.sh check
```

Install the certificate exported by `./scripts/sandbox.sh ca` on the laptop or
phone, then open the configured HTTPS address. Firewall or VPN access remains
the host's responsibility.

## Online dependency installation

The default app container has no outbound network. To install a workspace
dependency, use the separate `online` Compose profile:

```sh
./scripts/sandbox.sh online npm install <package>
```

The Docker socket is never mounted. The workspace is a named volume owned by
uid 1000 inside the app container.

## Development

Build the frontend, server, and injected preview client locally with:

```sh
npm ci
npm run build
```

The main source directories are:

```text
client/    Vite frontend
server/    Fastify service, PTY, preview, watcher, and proxy
inject/    preview client injected into served HTML
assets/    self-hosted fonts, icons, and PWA manifest
ui-base/   source UI framework and design tokens
fixtures/  bundled preview test project
```
