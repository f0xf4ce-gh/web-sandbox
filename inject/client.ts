type ConsoleLevel = "log" | "info" | "warn" | "error";

interface PreviewContext {
  frame: string;
  project: string;
}

interface ChangeMessage {
  type: "change";
  event: string;
  path: string;
}

interface EarlyConsoleMessage {
  args: unknown[];
  level: ConsoleLevel;
  timestamp: number;
}

interface PreviewWindow extends Window {
  __sandboxEarlyConsole?: {
    originalConsole: Console;
    queue: EarlyConsoleMessage[];
  };
}

const context = getPreviewContext();
let eventsSocket: WebSocket | null = null;
let retryTimer: number | undefined;
let animationFrame = 0;
const pendingConsoleMessages: string[] = [];

function getPreviewContext(): PreviewContext {
  const url = new URL(window.location.href);
  const parts = url.pathname.split("/").filter(Boolean);
  const project = parts[0] === "preview" && parts[1] ? decodePart(parts[1]) : "";
  return {
    frame: url.searchParams.get("frame") || "desktop",
    project
  };
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function postToParent(message: Record<string, unknown>): void {
  window.parent.postMessage(
    {
      source: "web-dev-sandbox",
      ...message
    },
    window.location.origin
  );
}

function sendEvent(message: Record<string, unknown>): void {
  const serialized = JSON.stringify(message);
  if (eventsSocket?.readyState === WebSocket.OPEN) {
    eventsSocket.send(serialized);
    return;
  }

  if (message.type === "console" && pendingConsoleMessages.length < 100) {
    pendingConsoleMessages.push(serialized);
  }
}

function sendConsole(level: ConsoleLevel, args: unknown[], timestamp = Date.now()): void {
  const message = {
    args: args.map((value) => safeSerialize(value)),
    frame: context.frame,
    level,
    timestamp,
    type: "console"
  };
  postToParent(message);
  sendEvent(message);
}

function safeSerialize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (depth > 4 || typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (typeof Node !== "undefined" && value instanceof Node) {
    return `[Node ${value.nodeName.toLowerCase()}]`;
  }
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack || ""
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => safeSerialize(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, 50)) {
    try {
      output[key] = safeSerialize((value as Record<string, unknown>)[key], seen, depth + 1);
    } catch {
      output[key] = "[Unserializable]";
    }
  }
  return output;
}

function installConsoleCapture(): void {
  const levels: ConsoleLevel[] = ["log", "info", "warn", "error"];
  const previewWindow = window as PreviewWindow;
  const earlyCapture = previewWindow.__sandboxEarlyConsole;
  const originalConsole = earlyCapture?.originalConsole || window.console;
  const capturedConsole = Object.create(originalConsole) as Console;
  const consoleMethods = capturedConsole as unknown as Record<string, (...args: unknown[]) => void>;
  for (const level of levels) {
    const method = originalConsole[level];
    if (typeof method !== "function") {
      continue;
    }
    const original = method.bind(originalConsole);
    const wrapped = (...args: unknown[]) => {
      try {
        original(...args);
      } finally {
        sendConsole(level, args);
      }
    };
    try {
      Object.defineProperty(consoleMethods, level, {
        configurable: true,
        value: wrapped,
        writable: true
      });
    } catch {
      try {
        consoleMethods[level] = wrapped;
      } catch {
        // Some browser consoles expose non-configurable methods.
      }
    }
  }

  try {
    Object.defineProperty(window, "console", {
      configurable: true,
      value: capturedConsole,
      writable: true
    });
  } catch {
    // Fall back to patching the browser-provided console object in place.
    for (const level of levels) {
      try {
        Object.defineProperty(originalConsole, level, {
          configurable: true,
          value: consoleMethods[level],
          writable: true
        });
      } catch {
        // Ignore consoles that do not allow replacement.
      }
    }
  }

  if (earlyCapture) {
    delete previewWindow.__sandboxEarlyConsole;
    for (const message of earlyCapture.queue) {
      sendConsole(message.level, message.args, message.timestamp);
    }
  }

  const originalOnError = window.onerror;
  window.onerror = (message, source, line, column, error) => {
    sendConsole("error", [
      message,
      {
        column,
        error: safeSerialize(error),
        line,
        source
      }
    ]);
    if (typeof originalOnError === "function") {
      return originalOnError(message, source, line, column, error);
    }
    return false;
  };

  window.addEventListener("unhandledrejection", (event) => {
    sendConsole("error", ["Unhandled promise rejection", event.reason]);
  });
}

function workspacePathFromUrl(value: string): string {
  const url = new URL(value, window.location.href);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "preview" || decodePart(parts[1] || "") !== context.project) {
    return "";
  }

  const relative = parts.slice(2).map(decodePart).join("/") || "index.html";
  return `${context.project}/${relative}`;
}

function isCurrentProject(filePath: string): boolean {
  return filePath === context.project || filePath.startsWith(`${context.project}/`);
}

function hotSwapStylesheet(changedPath: string): void {
  const cacheBust = Date.now().toString();
  document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    if (workspacePathFromUrl(link.href) !== changedPath) {
      return;
    }
    const nextUrl = new URL(link.href, window.location.href);
    nextUrl.searchParams.set("__sandbox", cacheBust);
    link.href = nextUrl.toString();
  });
}

function handleChange(message: ChangeMessage): void {
  if (message.type !== "change" || !isCurrentProject(message.path)) {
    return;
  }
  if (/\.css$/i.test(message.path)) {
    hotSwapStylesheet(message.path);
    return;
  }
  window.location.reload();
}

function scheduleEventsReconnect(): void {
  if (retryTimer !== undefined) {
    return;
  }
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    connectEvents();
  }, 1000);
}

function connectEvents(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/events?frame=${encodeURIComponent(context.frame)}`;
  const socket = new WebSocket(url);
  eventsSocket = socket;

  socket.onopen = () => {
    socket.send(JSON.stringify({ frame: context.frame, project: context.project, type: "hello" }));
    while (pendingConsoleMessages.length > 0 && socket.readyState === WebSocket.OPEN) {
      socket.send(pendingConsoleMessages.shift() || "");
    }
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    try {
      handleChange(JSON.parse(event.data) as ChangeMessage);
    } catch {
      // Ignore malformed development events.
    }
  };
  socket.onclose = () => {
    if (eventsSocket === socket) {
      eventsSocket = null;
    }
    scheduleEventsReconnect();
  };
  socket.onerror = () => {
    socket.close();
  };
}

function reportViewport(): void {
  const root = document.documentElement;
  const maximumScroll = Math.max(0, root.scrollHeight - window.innerHeight);
  const scrollRatio = maximumScroll === 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / maximumScroll));
  postToParent({ frame: context.frame, scrollRatio, type: "scroll" });
  postToParent({ documentHeight: root.scrollHeight, frame: context.frame, type: "height" });
}

function scheduleViewportReport(): void {
  if (animationFrame !== 0) {
    return;
  }
  animationFrame = window.requestAnimationFrame(() => {
    animationFrame = 0;
    reportViewport();
  });
}

window.addEventListener("scroll", scheduleViewportReport, { passive: true });
window.addEventListener("resize", scheduleViewportReport);
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.origin !== window.location.origin) {
    return;
  }
  if (event.data?.type !== "setScrollRatio") {
    return;
  }
  const ratio = Number(event.data.scrollRatio);
  const maximumScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ behavior: "auto", top: Math.min(1, Math.max(0, ratio)) * maximumScroll });
});

installConsoleCapture();
connectEvents();
window.addEventListener("load", reportViewport, { once: true });
window.setTimeout(reportViewport, 0);
