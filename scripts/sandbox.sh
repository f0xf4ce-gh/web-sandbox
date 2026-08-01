#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SANDBOX_URL=${SANDBOX_URL:-https://localhost}

cd "$REPO_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/sandbox.sh <command>

Commands:
  build    Build the pinned app image
  rebuild  Build the app image and recreate the running stack
  start    Start the stack, building only if the image is missing
  check    Run the local HTTPS and container smoke checks
  terminal Run one command through the real Caddy-to-PTY websocket
  demo     Copy the bundled preview-check project into /workspace
  preview  Check preview injection for SANDBOX_PROJECT or preview-check
  proxy    Check the loopback /p/:port HTTP proxy
  status   Show container status
  logs     Follow the latest app and Caddy logs
  ca       Copy Caddy's local root certificate to ./caddy-root.crt
  online   Run an explicitly online npm command in the online profile
  stop     Stop containers and keep the workspace volume
EOF
}

die() {
  printf '%s\n' "sandbox: $1" >&2
  exit 1
}

command_name=${1:-help}

case "$command_name" in
  build)
    docker compose build app
    ;;
  rebuild)
    docker compose build app
    docker compose up -d --force-recreate app caddy
    ;;
  start)
    docker compose up -d
    printf 'Sandbox is available at %s\n' "$SANDBOX_URL"
    ;;
  check)
    cookie_file=$(mktemp "${TMPDIR:-/tmp}/web-dev-sandbox-cookie.XXXXXX")
    trap 'rm -f "$cookie_file"' EXIT HUP INT TERM

    docker compose config --quiet
    docker compose up -d
    health=$(curl -4 -ksSf "$SANDBOX_URL/healthz")
    [ "$health" = "ok" ] || die "health check returned: $health"
    session=$(curl -4 -ksSf -c "$cookie_file" "$SANDBOX_URL/api/session")
    case "$session" in
      *'"ok":true'*) ;;
      *) die "session check returned: $session" ;;
    esac
    [ "$(docker compose exec -T app id -u)" = "1000" ] || die "app is not running as uid 1000"
    node scripts/terminal-smoke.mjs
    printf 'Sandbox checks passed at %s\n' "$SANDBOX_URL"
    ;;
  terminal)
    node scripts/terminal-smoke.mjs
    ;;
  demo)
    docker compose up -d
    docker compose exec -T app mkdir -p /workspace/preview-check
    COPYFILE_DISABLE=1 tar -C fixtures -cf - preview-check 2>/dev/null | docker compose exec -T app tar -C /workspace -xf -
    docker compose exec -T app find /workspace/preview-check -name '._*' -delete
    printf 'Copied preview-check to the workspace\n'
    ;;
  preview)
    project=${SANDBOX_PROJECT:-preview-check}
    encoded_project=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$project")
    html=$(curl -4 -ksSf "$SANDBOX_URL/preview/$encoded_project/?frame=desktop")
    case "$html" in
      *'/__dev/client.js'*) ;;
      *) die "preview HTML was not injected for $project" ;;
    esac
    css_code=$(curl -4 -ksS -o /dev/null -w '%{http_code}' "$SANDBOX_URL/preview/$encoded_project/style.css")
    [ "$css_code" = "200" ] || die "preview stylesheet returned HTTP $css_code"
    csp_headers=$(curl -4 -ksS -D - -o /dev/null "$SANDBOX_URL/preview/$encoded_project/?blockExternal=1")
    printf '%s\n' "$csp_headers" | grep -qi '^content-security-policy:' || die "CSP header was not returned"
    printf 'Preview checks passed for %s\n' "$project"
    ;;
  proxy)
    docker compose up -d
    docker compose exec -d app node -e 'const http=require("http"); const server=http.createServer((_request,response)=>response.end("proxy-smoke-ok\n")).listen(49173,"127.0.0.1"); setTimeout(()=>server.close(),10000)'
    sleep 1
    proxy_response=$(curl -4 -ksSf --max-time 5 "$SANDBOX_URL/p/49173/")
    [ "$proxy_response" = "proxy-smoke-ok" ] || die "port proxy returned: $proxy_response"
    printf 'Port proxy check passed at %s\n' "$SANDBOX_URL/p/49173/"
    ;;
  status)
    docker compose ps
    ;;
  logs)
    docker compose logs -f --tail=100
    ;;
  ca)
    docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
    printf 'Copied local CA to %s\n' "$REPO_DIR/caddy-root.crt"
    ;;
  online)
    shift
    [ "$#" -gt 0 ] || die "usage: ./scripts/sandbox.sh online npm install <package>"
    docker compose --profile online run --rm app-online "$@"
    ;;
  stop)
    docker compose down
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
