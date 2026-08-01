import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import { isSessionId, newSessionId, type PtySessionStore } from "./pty.js";
import { type EventClientRole, type WorkspaceWatcher } from "./watcher.js";

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return value.join("=");
    }
  }
  return undefined;
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
}

function closeServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    client.close(1001, "server shutting down");
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export function attachWebsocketRoutes(
  app: FastifyInstance,
  sessions: PtySessionStore,
  watcher: WorkspaceWatcher,
  sessionCookie: string
): void {
  const ptyServer = new WebSocketServer({ noServer: true });
  const eventsServer = new WebSocketServer({ noServer: true });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = requestUrl(request);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname === "/ws/pty") {
      ptyServer.handleUpgrade(request, socket, head, (client) => {
        const current = cookieValue(request.headers.cookie, sessionCookie);
        const id = isSessionId(current) ? current : newSessionId();
        sessions.attach(id, client);
      });
      return;
    }

    if (url.pathname === "/ws/events") {
      eventsServer.handleUpgrade(request, socket, head, (client) => {
        const role: EventClientRole = url.searchParams.get("role") === "app" ? "app" : "preview";
        watcher.attach(client, role);
      });
    }
  };

  app.server.on("upgrade", onUpgrade);
  app.addHook("onClose", async () => {
    app.server.off("upgrade", onUpgrade);
    await Promise.all([closeServer(ptyServer), closeServer(eventsServer)]);
  });
}
