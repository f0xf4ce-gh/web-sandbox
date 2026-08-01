import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import fastifyHttpProxy from "@fastify/http-proxy";
import type { FastifyInstance, FastifyReply } from "fastify";
import { WebSocket, WebSocketServer } from "ws";

interface ProxyParams {
  port?: string;
}

function parsePort(value: string | undefined): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function getProxyPort(request: { params: unknown }): number | null {
  return parsePort((request.params as ProxyParams).port);
}

export async function registerPortProxy(app: FastifyInstance): Promise<void> {
  await app.register(fastifyHttpProxy, {
    upstream: "",
    prefix: "/p/:port",
    rewritePrefix: "/",
    websocket: false,
    preHandler: async (request, reply) => {
      if (getProxyPort(request) === null) {
        return (reply as FastifyReply).code(400).type("text/plain; charset=utf-8").send("invalid proxy port\n");
      }
    },
    replyOptions: {
      getUpstream: (request) => {
        const port = getProxyPort(request);
        return `http://127.0.0.1:${port ?? 1}`;
      }
    }
  });
}

function websocketTarget(request: IncomingMessage): string | null {
  let url: URL;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/p\/(\d{1,5})(\/.*)?$/);
  const port = parsePort(match?.[1]);
  if (!port) {
    return null;
  }
  return `ws://127.0.0.1:${port}${match?.[2] || "/"}${url.search}`;
}

export function attachPortProxyWebsocket(app: FastifyInstance): void {
  const server = new WebSocketServer({ noServer: true });
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const target = websocketTarget(request);
    if (!target) {
      return;
    }

    server.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(target);
      const closeBoth = () => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.close();
        }
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close();
        }
      };

      client.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        }
      });
      upstream.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      });
      client.on("close", closeBoth);
      client.on("error", closeBoth);
      upstream.on("close", () => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });
      upstream.on("error", () => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1011, "port proxy unavailable");
        }
      });
    });
  };

  app.server.on("upgrade", onUpgrade);
  app.addHook("onClose", async () => {
    app.server.off("upgrade", onUpgrade);
    for (const client of server.clients) {
      client.close(1001, "server shutting down");
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
}
