import "./styles/tokens.css";
import "./styles/app.css";
import { mountConsole, type ConsoleController } from "./panes/console";
import { mountTerminal, type TerminalController } from "./panes/terminal";
import { mountViewer, type ViewerController } from "./panes/viewer";

const shell = document.querySelector<HTMLElement>(".app-shell");
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
const themeIcon = themeToggle?.querySelector("use");
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const mobileTabs = document.querySelectorAll<HTMLButtonElement>("[data-tab]");
const accessory = document.querySelector<HTMLElement>("#terminal-accessory");
const consoleCollapse = document.querySelector<HTMLButtonElement>("#console-collapse");
const verticalSplit = document.querySelector<HTMLButtonElement>("#vertical-split");
const horizontalSplit = document.querySelector<HTMLButtonElement>("#horizontal-split");
const rightColumn = document.querySelector<HTMLElement>(".right-column");

const terminalController = mountTerminal(storedTheme());
const viewerController = mountViewer();
const consoleController = mountConsole();

function storedTheme(): "dark" | "light" {
  return localStorage.getItem("sandbox-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("sandbox-theme", theme);

  if (themeToggle) {
    themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  }
  themeIcon?.setAttribute("href", theme === "dark" ? "#icon-moon" : "#icon-sun");
  themeMeta?.setAttribute("content", theme === "dark" ? "#0A0A0A" : "#F2F2F2");
  terminalController?.setTheme(theme);
}

function setActivePane(pane: string, focus = true) {
  if (!shell) return;
  shell.dataset.activePane = pane;

  mobileTabs.forEach((tab) => {
    const selected = tab.dataset.tab === pane;
    tab.setAttribute("aria-selected", String(selected));
  });
  localStorage.setItem("sandbox-pane", pane);
  window.requestAnimationFrame(() => {
    terminalController?.fit();
    if (!focus) {
      return;
    }
    if (pane === "terminal") {
      terminalController?.focus();
    } else if (pane === "viewer") {
      viewerController?.focus();
    } else {
      consoleController?.focus();
    }
  });
}

function storedNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

let terminalSplit = storedNumber("sandbox-terminal-split", 38, 22, 70);
let consoleHeight = storedNumber("sandbox-console-height", 180, 28, 520);
let consoleWasCollapsed = localStorage.getItem("sandbox-console-collapsed") === "true";

function applySplitStyles() {
  shell?.style.setProperty("--terminal-split", `${terminalSplit}%`);
  shell?.style.setProperty("--console-height", `${consoleWasCollapsed ? 28 : consoleHeight}px`);
  if (verticalSplit) {
    verticalSplit.setAttribute("aria-valuenow", String(Math.round(terminalSplit)));
  }
  if (horizontalSplit && rightColumn) {
    const available = rightColumn.getBoundingClientRect().height;
    const ratio = available > 0 ? (consoleWasCollapsed ? 0 : consoleHeight / available) * 100 : 0;
    horizontalSplit.setAttribute("aria-valuenow", String(Math.round(ratio)));
  }
}

function toggleConsole() {
  consoleWasCollapsed = !consoleWasCollapsed;
  localStorage.setItem("sandbox-console-collapsed", String(consoleWasCollapsed));
  shell?.setAttribute("data-console-collapsed", String(consoleWasCollapsed));
  consoleCollapse?.setAttribute("aria-expanded", String(!consoleWasCollapsed));
  consoleCollapse?.setAttribute("aria-label", consoleWasCollapsed ? "Expand console" : "Collapse console");
  applySplitStyles();
}

interface SplitDrag {
  axis: "horizontal" | "vertical";
  start: number;
  startValue: number;
  rect: DOMRect;
}

let splitDrag: SplitDrag | null = null;

function beginSplitDrag(axis: SplitDrag["axis"], event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }
  const element = axis === "vertical" ? verticalSplit : horizontalSplit;
  const rect = axis === "vertical"
    ? document.querySelector<HTMLElement>(".workspace-grid")?.getBoundingClientRect()
    : rightColumn?.getBoundingClientRect();
  if (!element || !rect) {
    return;
  }
  splitDrag = {
    axis,
    rect,
    start: axis === "vertical" ? event.clientX : event.clientY,
    startValue: axis === "vertical" ? terminalSplit : consoleHeight
  };
  element.classList.add("dragging");
  element.setPointerCapture(event.pointerId);
  document.body.style.userSelect = "none";
}

function moveSplitDrag(event: PointerEvent) {
  if (!splitDrag) {
    return;
  }
  if (splitDrag.axis === "vertical") {
    const delta = event.clientX - splitDrag.start;
    terminalSplit = Math.min(70, Math.max(22, splitDrag.startValue + (delta / splitDrag.rect.width) * 100));
  } else {
    const delta = splitDrag.start - event.clientY;
    consoleHeight = Math.min(520, Math.max(28, splitDrag.startValue + delta));
    consoleWasCollapsed = false;
    localStorage.setItem("sandbox-console-height", String(Math.round(consoleHeight)));
    localStorage.setItem("sandbox-console-collapsed", "false");
    shell?.setAttribute("data-console-collapsed", "false");
    consoleCollapse?.setAttribute("aria-expanded", "true");
  }
  applySplitStyles();
}

function endSplitDrag() {
  if (!splitDrag) {
    return;
  }
  const element = splitDrag.axis === "vertical" ? verticalSplit : horizontalSplit;
  element?.classList.remove("dragging");
  localStorage.setItem("sandbox-terminal-split", String(Math.round(terminalSplit)));
  localStorage.setItem("sandbox-console-height", String(Math.round(consoleHeight)));
  splitDrag = null;
  document.body.style.userSelect = "";
}

function setupAccessoryKeys() {
  if (!accessory || !terminalController) {
    return;
  }
  const keyMap: Record<string, string> = {
    dash: "-",
    down: "\u001b[B",
    escape: "\u001b",
    left: "\u001b[D",
    pipe: "|",
    right: "\u001b[C",
    slash: "/",
    tab: "\t",
    up: "\u001b[A"
  };
  accessory.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const data = keyMap[button.dataset.key || ""];
      if (data) {
        terminalController.sendInput(data);
        terminalController.focus();
      }
    });
  });
  accessory.querySelectorAll<HTMLButtonElement>("[data-modifier]").forEach((button) => {
    button.addEventListener("click", () => {
      const modifier = button.dataset.modifier;
      if (modifier === "ctrl" || modifier === "alt") {
        terminalController.armModifier(modifier);
        terminalController.focus();
      }
    });
  });
  terminalController.onModifiersChange((modifiers) => {
    accessory.querySelectorAll<HTMLButtonElement>("[data-modifier]").forEach((button) => {
      const modifier = button.dataset.modifier;
      button.setAttribute("aria-pressed", String(modifier === "ctrl" ? modifiers.ctrl : modifiers.alt));
    });
  });
}

themeToggle?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
});

mobileTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActivePane(tab.dataset.tab || "viewer"));
});

consoleCollapse?.addEventListener("click", toggleConsole);
verticalSplit?.addEventListener("pointerdown", (event) => beginSplitDrag("vertical", event));
horizontalSplit?.addEventListener("pointerdown", (event) => beginSplitDrag("horizontal", event));
document.addEventListener("pointermove", moveSplitDrag);
document.addEventListener("pointerup", endSplitDrag);

document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "1" || key === "2" || key === "3") {
    event.preventDefault();
    setActivePane(key === "1" ? "terminal" : key === "2" ? "viewer" : "console");
  } else if (key === "r") {
    event.preventDefault();
    viewerController?.reload();
  } else if (event.code === "Backslash") {
    event.preventDefault();
    toggleConsole();
  } else if (key === "k") {
    event.preventDefault();
    consoleController?.clear();
  }
});

applyTheme(storedTheme());
shell?.setAttribute("data-console-collapsed", String(consoleWasCollapsed));
consoleCollapse?.setAttribute("aria-expanded", String(!consoleWasCollapsed));
consoleCollapse?.setAttribute("aria-label", consoleWasCollapsed ? "Expand console" : "Collapse console");
applySplitStyles();
setupAccessoryKeys();
setActivePane(localStorage.getItem("sandbox-pane") || "viewer", false);
