import { randomUUID } from "node:crypto";
import { spawn, type IPty } from "node-pty";
import type { WebSocket } from "ws";

const MAX_HISTORY_BYTES = 256 * 1024;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/workspace";

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

interface PtySession {
  id: string;
  pty: IPty;
  history: Buffer;
  clients: Set<WebSocket>;
}

function shellEnvironment(): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  );

  return {
    ...Object.fromEntries(entries),
    TERM: "xterm-256color",
    COLORTERM: "truecolor"
  };
}

function rawMessageToText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  return String(raw);
}

function parseClientMessage(raw: unknown): ClientMessage | null {
  try {
    const parsed = JSON.parse(rawMessageToText(raw)) as Partial<ClientMessage>;
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return parsed as ClientMessage;
    }
    if (
      parsed.type === "resize" &&
      typeof parsed.cols === "number" &&
      typeof parsed.rows === "number"
    ) {
      return parsed as ClientMessage;
    }
  } catch {
    return null;
  }

  return null;
}

export class PtySessionStore {
  private readonly sessions = new Map<string, PtySession>();

  getOrCreate(id: string): PtySession {
    const existing = this.sessions.get(id);
    if (existing) {
      return existing;
    }

    const pty = spawn("tmux", ["new", "-A", "-s", "main"], {
      name: "xterm-256color",
      cols: 120,
      rows: 36,
      cwd: WORKSPACE_DIR,
      env: shellEnvironment()
    });

    const session: PtySession = {
      id,
      pty,
      history: Buffer.alloc(0),
      clients: new Set()
    };

    pty.onData((data) => this.broadcast(session, data));
    pty.onExit(() => {
      for (const client of session.clients) {
        if (client.readyState === 1) {
          client.close(1000, "terminal exited");
        }
      }
      session.clients.clear();
      if (this.sessions.get(session.id) === session) {
        this.sessions.delete(session.id);
      }
    });

    this.sessions.set(id, session);
    return session;
  }

  attach(id: string, socket: WebSocket): void {
    const session = this.getOrCreate(id);
    session.clients.add(socket);

    if (session.history.length > 0 && socket.readyState === 1) {
      socket.send(session.history);
    }

    const detach = () => {
      session.clients.delete(socket);
    };

    socket.on("close", detach);
    socket.on("error", detach);
    socket.on("message", (raw: unknown) => {
      const message = parseClientMessage(raw);
      if (!message) {
        return;
      }

      if (message.type === "input") {
        session.pty.write(message.data);
        return;
      }

      const cols = Math.max(2, Math.min(500, Math.floor(message.cols)));
      const rows = Math.max(2, Math.min(200, Math.floor(message.rows)));
      session.pty.resize(cols, rows);
    });
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill();
    }
    this.sessions.clear();
  }

  private broadcast(session: PtySession, data: string): void {
    const chunk = Buffer.from(data, "utf8");
    session.history = Buffer.concat([session.history, chunk]);
    if (session.history.length > MAX_HISTORY_BYTES) {
      session.history = session.history.subarray(-MAX_HISTORY_BYTES);
    }

    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }
}

export function newSessionId(): string {
  return randomUUID();
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}
