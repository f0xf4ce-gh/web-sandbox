import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export interface TerminalController {
  armModifier: (modifier: "alt" | "ctrl") => void;
  dispose: () => void;
  fit: () => void;
  focus: () => void;
  onModifiersChange: (listener: (modifiers: { alt: boolean; ctrl: boolean }) => void) => void;
  sendInput: (data: string) => void;
  setTheme: (theme: "dark" | "light") => void;
}

const darkTheme = {
  background: "#151515",
  black: "#0A0A0A",
  blue: "#A0A0A0",
  brightBlack: "#6A6A6A",
  brightBlue: "#EDEDED",
  brightCyan: "#EDEDED",
  brightGreen: "#EDEDED",
  brightMagenta: "#EDEDED",
  brightRed: "#EDEDED",
  brightWhite: "#FFFFFF",
  brightYellow: "#EDEDED",
  cursor: "#EDEDED",
  cursorAccent: "#151515",
  cyan: "#9A9A9A",
  foreground: "#EDEDED",
  green: "#A0A0A0",
  magenta: "#9A9A9A",
  red: "#9A9A9A",
  selectionBackground: "#3A3A3A",
  white: "#D0D0D0",
  yellow: "#B0B0B0"
};

const lightTheme = {
  ...darkTheme,
  background: "#FFFFFF",
  black: "#1D1D1D",
  brightBlack: "#A1A1A1",
  brightWhite: "#1D1D1D",
  cursor: "#1D1D1D",
  cursorAccent: "#FFFFFF",
  foreground: "#1D1D1D",
  selectionBackground: "#C6C6C6",
  white: "#6E6E6E"
};

function sendSocketMessage(socket: WebSocket | null, message: object): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function mountTerminal(initialTheme: "dark" | "light"): TerminalController | null {
  const host = document.querySelector<HTMLElement>("#terminal-host");
  const status = document.querySelector<HTMLElement>("#terminal-status");
  if (!host) {
    return null;
  }

  const terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: 'ui-monospace, "SF Mono", Menlo, "JetBrains Mono", monospace',
    fontSize: 12,
    lineHeight: 1.35,
    scrollback: 10000,
    theme: initialTheme === "dark" ? darkTheme : lightTheme
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(host);

  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let connecting = false;
  let disposed = false;
  let modifiers = { alt: false, ctrl: false };
  let modifierListener: ((next: { alt: boolean; ctrl: boolean }) => void) | null = null;

  const notifyModifiers = () => {
    modifierListener?.({ ...modifiers });
  };

  const applyModifiers = (data: string): string => {
    if (!modifiers.alt && !modifiers.ctrl) {
      return data;
    }

    let next = data;
    if (modifiers.ctrl && data.length === 1) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        next = String.fromCharCode(code & 31);
      }
    }
    if (modifiers.alt) {
      next = `\u001b${next}`;
    }
    modifiers = { alt: false, ctrl: false };
    notifyModifiers();
    return next;
  };

  const setStatus = (value: string) => {
    if (status) {
      status.textContent = value;
    }
  };

  const sendResize = () => {
    sendSocketMessage(socket, {
      cols: terminal.cols,
      rows: terminal.rows,
      type: "resize"
    });
  };

  const fit = () => {
    if (host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }
    fitAddon.fit();
    sendResize();
  };

  const scheduleReconnect = () => {
    if (disposed || retryTimer !== undefined) {
      return;
    }
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, 1500);
  };

  const connect = async () => {
    if (disposed || connecting || socket?.readyState === WebSocket.OPEN) {
      return;
    }

    connecting = true;
    setStatus("connecting");

    try {
      const response = await fetch("/api/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error("session request failed");
      }
    } catch {
      connecting = false;
      setStatus("offline");
      scheduleReconnect();
      return;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocket(protocol + "//" + location.host + "/ws/pty");
    socket = nextSocket;

    nextSocket.onopen = () => {
      connecting = false;
      setStatus("connected");
      terminal.clear();
      fit();
    };

    nextSocket.onmessage = (event) => {
      if (typeof event.data === "string") {
        terminal.write(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new TextDecoder().decode(event.data));
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.text().then((data) => terminal.write(data));
      }
    };

    nextSocket.onerror = () => {
      setStatus("reconnecting");
    };

    nextSocket.onclose = () => {
      if (socket === nextSocket) {
        socket = null;
      }
      connecting = false;
      if (!disposed) {
        setStatus("reconnecting");
        scheduleReconnect();
      }
    };
  };

  const sendInput = (data: string) => {
    sendSocketMessage(socket, { data: applyModifiers(data), type: "input" });
  };

  terminal.onData(sendInput);
  terminal.onResize(sendResize);

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(host);
  window.addEventListener("resize", fit);
  const visualViewport = window.visualViewport;
  const fitVisualViewport = () => {
    const pane = host.closest<HTMLElement>(".terminal-pane");
    const height = visualViewport?.height || window.innerHeight;
    pane?.style.setProperty("--terminal-viewport-height", `${height}px`);
    fit();
  };
  visualViewport?.addEventListener("resize", fitVisualViewport);
  visualViewport?.addEventListener("scroll", fitVisualViewport);
  fitVisualViewport();
  fit();
  void connect();

  return {
    armModifier: (modifier) => {
      modifiers = { ...modifiers, [modifier]: !modifiers[modifier] };
      notifyModifiers();
    },
    dispose: () => {
      disposed = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", fit);
      visualViewport?.removeEventListener("resize", fitVisualViewport);
      visualViewport?.removeEventListener("scroll", fitVisualViewport);
      socket?.close();
      terminal.dispose();
    },
    fit,
    focus: () => terminal.focus(),
    onModifiersChange: (listener) => {
      modifierListener = listener;
      notifyModifiers();
    },
    sendInput,
    setTheme: (theme) => {
      terminal.options.theme = theme === "dark" ? darkTheme : lightTheme;
    }
  };
}
