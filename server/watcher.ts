import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { WebSocket } from "ws";

type WatchEvent = "add" | "change" | "unlink" | "addDir" | "unlinkDir";
export type EventClientRole = "preview" | "app";
type ConsoleLevel = "log" | "info" | "warn" | "error";

export interface WorkspaceChange {
  type: "change";
  event: WatchEvent;
  path: string;
}

export interface ConsoleMessage {
  type: "console";
  frame: "desktop" | "mobile";
  level: ConsoleLevel;
  timestamp: number;
  args: unknown[];
}

const DEBOUNCE_MS = 50;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isIgnored(workspaceRoot: string, target: string): boolean {
  const relative = path.relative(workspaceRoot, target);
  if (!relative || relative === ".") {
    return false;
  }

  return relative.split(path.sep).some((segment) => {
    return segment === "node_modules" || segment === ".git" || segment.startsWith(".");
  });
}

export class WorkspaceWatcher {
  private readonly workspaceRoot: string;
  private readonly watcher: FSWatcher;
  private readonly sockets = new Map<WebSocket, EventClientRole>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(workspaceRoot: string, onError: (error: unknown) => void) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.watcher = chokidar.watch(this.workspaceRoot, {
      awaitWriteFinish: false,
      ignored: (target) => isIgnored(this.workspaceRoot, target),
      ignoreInitial: true,
      persistent: true
    });
    this.watcher.on("all", (event, target) => {
      this.queueChange(event as WatchEvent, target);
    });
    this.watcher.on("error", onError);
  }

  attach(socket: WebSocket, role: EventClientRole = "preview"): void {
    this.sockets.set(socket, role);

    const detach = () => {
      this.sockets.delete(socket);
    };

    socket.on("close", detach);
    socket.on("error", detach);
    socket.on("message", (raw: unknown) => {
      if (role !== "preview") {
        return;
      }

      try {
        const message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : String(raw)) as Partial<ConsoleMessage>;
        if (!isConsoleMessage(message)) {
          return;
        }
        this.broadcastConsole(message);
      } catch {
        // Ignore malformed messages from a preview page.
      }
    });
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.sockets.clear();
    await this.watcher.close();
  }

  private queueChange(event: WatchEvent, absolutePath: string): void {
    const relativePath = toPosix(path.relative(this.workspaceRoot, absolutePath));
    if (!relativePath || relativePath.startsWith("../")) {
      return;
    }

    const previousTimer = this.timers.get(relativePath);
    if (previousTimer) {
      clearTimeout(previousTimer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(relativePath);
      this.broadcast({
        event,
        path: relativePath,
        type: "change"
      });
    }, DEBOUNCE_MS);

    this.timers.set(relativePath, timer);
  }

  private broadcast(change: WorkspaceChange): void {
    const message = JSON.stringify(change);
    for (const [socket, role] of this.sockets) {
      if (role === "preview" && socket.readyState === 1) {
        socket.send(message);
      }
    }
  }

  private broadcastConsole(message: ConsoleMessage): void {
    const serialized = JSON.stringify(message);
    for (const [socket, role] of this.sockets) {
      if (role === "app" && socket.readyState === 1) {
        socket.send(serialized);
      }
    }
  }
}

function isConsoleMessage(value: Partial<ConsoleMessage>): value is ConsoleMessage {
  return (
    value.type === "console" &&
    (value.frame === "desktop" || value.frame === "mobile") &&
    (value.level === "log" || value.level === "info" || value.level === "warn" || value.level === "error") &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    Array.isArray(value.args)
  );
}
