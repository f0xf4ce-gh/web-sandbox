type FrameId = "desktop" | "mobile";
type ConsoleLevel = "log" | "info" | "warn" | "error";

interface ConsoleEntry {
  args: unknown[];
  frame: FrameId;
  level: ConsoleLevel;
  timestamp: number;
}

const MAX_ENTRIES = 500;

function isConsoleEntry(value: unknown): value is ConsoleEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<ConsoleEntry>;
  return (
    Array.isArray(entry.args) &&
    (entry.frame === "desktop" || entry.frame === "mobile") &&
    (entry.level === "log" || entry.level === "info" || entry.level === "warn" || entry.level === "error") &&
    typeof entry.timestamp === "number" &&
    Number.isFinite(entry.timestamp)
  );
}

function displayArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 0) || String(value);
  } catch {
    return "[Unserializable]";
  }
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export interface ConsoleController {
  clear: () => void;
  dispose: () => void;
  focus: () => void;
}

export function mountConsole(): ConsoleController | null {
  const list = document.querySelector<HTMLElement>("#console-list");
  const empty = document.querySelector<HTMLElement>("#console-empty");
  const count = document.querySelector<HTMLElement>("#console-count");
  const clearButton = document.querySelector<HTMLButtonElement>("#console-clear");
  const surface = document.querySelector<HTMLElement>("#console-surface");
  const appStatus = document.querySelector<HTMLElement>("#app-status");
  if (!list || !empty || !count || !clearButton || !surface) {
    return null;
  }

  let entries: ConsoleEntry[] = [];
  let levelFilter: ConsoleLevel | "all" = "all";
  let frameFilter: FrameId | "all" = "all";
  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let disposed = false;

  const entryKey = (entry: ConsoleEntry): string => {
    return `${entry.frame}|${entry.level}|${entry.timestamp}|${entry.args.map(displayArg).join("\u001f")}`;
  };

  const append = (entry: ConsoleEntry) => {
    if (entries.some((existing) => entryKey(existing) === entryKey(entry))) {
      return;
    }
    entries.push(entry);
    entries.sort((left, right) => left.timestamp - right.timestamp);
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(-MAX_ENTRIES);
    }
    render();
  };

  const filteredEntries = () => entries.filter((entry) => {
    return (levelFilter === "all" || entry.level === levelFilter) &&
      (frameFilter === "all" || entry.frame === frameFilter);
  });

  const render = () => {
    const visible = filteredEntries();
    count.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
    clearButton.disabled = entries.length === 0;
    empty.hidden = visible.length > 0;
    list.replaceChildren();

    for (const entry of visible) {
      const row = document.createElement("div");
      row.className = "console-entry";
      row.dataset.level = entry.level;
      row.dataset.frame = entry.frame;

      const tag = document.createElement("span");
      tag.className = "console-frame-tag";
      tag.textContent = entry.frame === "desktop" ? "D" : "M";
      tag.setAttribute("aria-label", entry.frame === "desktop" ? "Desktop" : "Mobile");

      const level = document.createElement("span");
      level.className = "console-level";
      level.textContent = entry.level;

      const args = document.createElement("span");
      args.className = "console-args";
      args.textContent = entry.args.map(displayArg).join(" ");

      const timestamp = document.createElement("time");
      timestamp.className = "console-time";
      timestamp.dateTime = new Date(entry.timestamp).toISOString();
      timestamp.textContent = timeLabel(entry.timestamp);

      row.append(tag, level, args, timestamp);
      list.append(row);
    }
  };

  const setSocketStatus = (value: string) => {
    if (appStatus) {
      appStatus.textContent = value;
    }
  };

  const scheduleReconnect = () => {
    if (disposed || retryTimer !== undefined) {
      return;
    }
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, 1200);
  };

  const connect = () => {
    if (disposed || socket?.readyState === WebSocket.OPEN) {
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocket(`${protocol}//${window.location.host}/ws/events?role=app`);
    socket = nextSocket;
    setSocketStatus("events connecting");
    nextSocket.onopen = () => setSocketStatus("events connected");
    nextSocket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const value = JSON.parse(event.data) as unknown;
        if (!isConsoleEntry(value)) {
          return;
        }
        append(value);
      } catch {
        // Ignore malformed console events.
      }
    };
    nextSocket.onerror = () => setSocketStatus("events reconnecting");
    nextSocket.onclose = () => {
      if (socket === nextSocket) {
        socket = null;
      }
      setSocketStatus("events reconnecting");
      scheduleReconnect();
    };
  };

  const onParentMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") {
      return;
    }
    const value = event.data as Record<string, unknown>;
    if (value.source !== "web-dev-sandbox" || value.type !== "console") {
      return;
    }
    const entry = {
      args: value.args,
      frame: value.frame,
      level: value.level,
      timestamp: value.timestamp
    };
    if (isConsoleEntry(entry)) {
      append(entry);
    }
  };

  document.querySelectorAll<HTMLButtonElement>("[data-console-level]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.consoleLevel;
      levelFilter = next === "log" || next === "info" || next === "warn" || next === "error" ? next : "all";
      document.querySelectorAll<HTMLButtonElement>("[data-console-level]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-console-frame]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.consoleFrame;
      frameFilter = next === "desktop" || next === "mobile" ? next : "all";
      document.querySelectorAll<HTMLButtonElement>("[data-console-frame]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      render();
    });
  });

  const clear = () => {
    entries = [];
    render();
  };

  clearButton.addEventListener("click", clear);
  window.addEventListener("message", onParentMessage);
  render();
  connect();

  return {
    clear,
    dispose: () => {
      disposed = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      window.removeEventListener("message", onParentMessage);
      socket?.close();
    },
    focus: () => surface.focus()
  };
}
