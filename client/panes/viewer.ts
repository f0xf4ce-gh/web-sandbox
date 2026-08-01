import qrcode from "qrcode-generator";

type FrameId = "desktop" | "mobile";
type PreviewSource = "static" | "proxy";

interface FrameSize {
  width: number;
  height: number;
}

interface FrameElements {
  card: HTMLElement;
  canvas: HTMLElement;
  frame: HTMLIFrameElement;
  holder: HTMLElement;
  input: HTMLInputElement;
  measure: HTMLElement;
  measureLabel: HTMLElement;
  overflow: HTMLElement;
  preset: HTMLSelectElement;
  stage: HTMLElement;
  status: HTMLElement;
}

interface ProjectsResponse {
  projects?: unknown;
}

interface ParentMessage {
  source?: string;
  type?: string;
  frame?: FrameId;
  scrollRatio?: number;
  documentHeight?: number;
}

const DEFAULT_SIZES: Record<FrameId, FrameSize> = {
  desktop: { height: 900, width: 1440 },
  mobile: { height: 844, width: 390 }
};

const MIN_SIZE = { height: 120, width: 160 };
const MAX_SIZE = { height: 3000, width: 4000 };
const FRAME_IDS: FrameId[] = ["desktop", "mobile"];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseSize(value: string): FrameSize | null {
  const match = value.trim().match(/^(\d{2,4})\s*[×x, ]\s*(\d{2,4})$/i);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return null;
  }
  return {
    height: clamp(height, MIN_SIZE.height, MAX_SIZE.height),
    width: clamp(width, MIN_SIZE.width, MAX_SIZE.width)
  };
}

function formatSize(size: FrameSize): string {
  return `${size.width} × ${size.height}`;
}

function readSizes(): Record<FrameId, FrameSize> {
  try {
    const stored = JSON.parse(localStorage.getItem("sandbox-frame-sizes") || "null") as Partial<Record<FrameId, FrameSize>> | null;
    return {
      desktop: normalizeSize(stored?.desktop, DEFAULT_SIZES.desktop),
      mobile: normalizeSize(stored?.mobile, DEFAULT_SIZES.mobile)
    };
  } catch {
    return structuredClone(DEFAULT_SIZES);
  }
}

function normalizeSize(value: FrameSize | undefined, fallback: FrameSize): FrameSize {
  if (!value || typeof value.width !== "number" || typeof value.height !== "number") {
    return { ...fallback };
  }
  return {
    height: clamp(Math.round(value.height), MIN_SIZE.height, MAX_SIZE.height),
    width: clamp(Math.round(value.width), MIN_SIZE.width, MAX_SIZE.width)
  };
}

function readSource(): PreviewSource {
  return localStorage.getItem("sandbox-preview-source") === "proxy" ? "proxy" : "static";
}

function readPort(): number {
  const port = Number(localStorage.getItem("sandbox-proxy-port") || "5173");
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 5173;
}

function previewUrl(
  project: string,
  source: PreviewSource,
  port: number,
  frame: FrameId,
  blockExternal: boolean,
  reloadToken?: number
): string {
  const path = source === "proxy"
    ? `/p/${port}/`
    : `/preview/${encodeURIComponent(project)}/`;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("frame", frame);
  if (source === "static" && blockExternal) {
    url.searchParams.set("blockExternal", "1");
  }
  if (reloadToken) {
    url.searchParams.set("reload", String(reloadToken));
  }
  return url.toString();
}

function validRatio(value: unknown): number | null {
  const ratio = Number(value);
  return Number.isFinite(ratio) ? clamp(ratio, 0, 1) : null;
}

export interface ViewerController {
  focus: () => void;
  refreshProjects: () => Promise<void>;
  reload: () => void;
}

export function mountViewer(): ViewerController | null {
  const select = document.querySelector<HTMLSelectElement>("#project-select");
  const sourceSelect = document.querySelector<HTMLSelectElement>("#source-select");
  const portInput = document.querySelector<HTMLInputElement>("#proxy-port");
  const portControl = document.querySelector<HTMLElement>("#proxy-port-control");
  const blockExternal = document.querySelector<HTMLInputElement>("#block-external");
  const linkScroll = document.querySelector<HTMLInputElement>("#link-scroll");
  const surface = document.querySelector<HTMLElement>("#viewer-surface");
  const grid = document.querySelector<HTMLElement>("#preview-grid");
  const empty = document.querySelector<HTMLElement>("#preview-empty");
  const status = document.querySelector<HTMLElement>("#preview-status");
  const reloadButton = document.querySelector<HTMLButtonElement>("#preview-reload-all");
  const rotateButton = document.querySelector<HTMLButtonElement>("#mobile-rotate");
  const qrDialog = document.querySelector<HTMLDialogElement>("#qr-dialog");
  const qrCode = document.querySelector<HTMLElement>("#qr-code");
  const qrUrl = document.querySelector<HTMLElement>("#qr-url");
  const qrClose = document.querySelector<HTMLButtonElement>("#qr-close");

  if (!select || !sourceSelect || !portInput || !portControl || !blockExternal || !linkScroll || !surface || !grid || !empty || !status || !reloadButton) {
    return null;
  }

  const frames = {} as Record<FrameId, FrameElements>;
  for (const id of FRAME_IDS) {
    const card = document.querySelector<HTMLElement>(`.frame-card[data-frame="${id}"]`);
    const canvas = document.querySelector<HTMLElement>(`#${id}-canvas`);
    const frame = document.querySelector<HTMLIFrameElement>(`#${id}-frame`);
    const holder = document.querySelector<HTMLElement>(`#${id}-holder`);
    const input = document.querySelector<HTMLInputElement>(`#${id}-size`);
    const measure = document.querySelector<HTMLElement>(`#${id}-measure`);
    const measureLabel = measure?.querySelector<HTMLElement>(".measure-label");
    const overflow = document.querySelector<HTMLElement>(`#${id}-overflow`);
    const preset = document.querySelector<HTMLSelectElement>(`#${id}-preset`);
    const stage = document.querySelector<HTMLElement>(`#${id}-stage`);
    const frameStatus = document.querySelector<HTMLElement>(`#${id}-frame-status`);
    if (!card || !canvas || !frame || !holder || !input || !measure || !measureLabel || !overflow || !preset || !stage || !frameStatus) {
      return null;
    }
    frames[id] = { card, canvas, frame, holder, input, measure, measureLabel, overflow, preset, stage, status: frameStatus };
  }

  const sizes = readSizes();
  let selectedProject = localStorage.getItem("sandbox-project") || "";
  let source = readSource();
  let proxyPort = readPort();
  let resizeObserver: ResizeObserver | null = null;
  let widthDrag: { frame: FrameId; startX: number; startWidth: number; scale: number } | null = null;
  const documentHeights: Partial<Record<FrameId, number>> = {};

  sourceSelect.value = source;
  portInput.value = String(proxyPort);
  blockExternal.checked = localStorage.getItem("sandbox-block-external") !== "false";
  linkScroll.checked = localStorage.getItem("sandbox-link-scroll") === "true";
  surface.tabIndex = 0;

  const setStatus = (value: string) => {
    status.textContent = value;
  };

  const currentUrl = (frame: FrameId): string => previewUrl(
    selectedProject,
    source,
    proxyPort,
    frame,
    blockExternal.checked
  );

  const persistSizes = () => {
    localStorage.setItem("sandbox-frame-sizes", JSON.stringify(sizes));
  };

  const setSize = (id: FrameId, next: FrameSize, reload = false) => {
    sizes[id] = normalizeSize(next, DEFAULT_SIZES[id]);
    frames[id].input.value = formatSize(sizes[id]);
    frames[id].measureLabel.textContent = `${sizes[id].width} px`;
    persistSizes();
    layout();
    if (reload && selectedProject) {
      loadFrame(id);
    }
  };

  const loadFrame = (id: FrameId, reloadToken?: number) => {
    const frame = frames[id];
    if (!selectedProject && source === "static") {
      frame.frame.removeAttribute("src");
      frame.status.textContent = "no project";
      return;
    }
    frame.status.textContent = source === "proxy" ? `port ${proxyPort}` : "loading";
    frame.frame.src = previewUrl(selectedProject, source, proxyPort, id, blockExternal.checked, reloadToken);
  };

  const loadAllFrames = (reloadToken?: number) => {
    for (const id of FRAME_IDS) {
      loadFrame(id, reloadToken);
    }
  };

  const renderEmptyState = () => {
    const hasPreview = source === "proxy" || Boolean(selectedProject);
    grid.hidden = !hasPreview;
    empty.hidden = hasPreview;
    reloadButton.disabled = !hasPreview;
    if (!hasPreview) {
      setStatus("no project");
    }
  };

  const renderProject = (project: string) => {
    selectedProject = project;
    if (project) {
      localStorage.setItem("sandbox-project", project);
    }
    renderEmptyState();
    if (!grid.hidden) {
      setStatus(source === "proxy" ? `port ${proxyPort}` : "loading");
      loadAllFrames();
    }
  };

  const refreshProjects = async () => {
    try {
      const response = await fetch("/api/projects", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error("project request failed");
      }
      const data = (await response.json()) as ProjectsResponse;
      const projects = Array.isArray(data.projects)
        ? data.projects.filter((project): project is string => typeof project === "string")
        : [];
      const previous = selectedProject;
      select.replaceChildren();
      if (projects.length === 0) {
        select.add(new Option("No projects", ""));
        select.disabled = true;
        selectedProject = "";
      } else {
        for (const project of projects) {
          select.add(new Option(project, project));
        }
        select.disabled = false;
        selectedProject = projects.includes(previous) ? previous : projects[0];
        select.value = selectedProject;
        localStorage.setItem("sandbox-project", selectedProject);
      }
      renderProject(selectedProject);
    } catch {
      select.replaceChildren(new Option("Projects unavailable", ""));
      select.disabled = true;
      if (source === "static") {
        selectedProject = "";
      }
      renderProject(selectedProject);
      setStatus("offline");
    }
  };

  function layout() {
    const mobileLayout = window.matchMedia("(max-width: 760px)").matches;
    const availableWidth = Math.max(180, surface.clientWidth - (mobileLayout ? 24 : 32));
    const availableHeight = Math.max(120, surface.clientHeight - 92);
    const gap = 16;
    const scaled: Record<FrameId, { height: number; scale: number; width: number }> = {
      desktop: { height: 0, scale: 1, width: 0 },
      mobile: { height: 0, scale: 1, width: 0 }
    };

    if (mobileLayout) {
      for (const id of FRAME_IDS) {
        const scale = Math.min(1, availableWidth / sizes[id].width);
        scaled[id] = {
          height: sizes[id].height * scale,
          scale,
          width: sizes[id].width * scale
        };
      }
    } else {
      const mobileScale = Math.min(1, availableHeight / sizes.mobile.height, Math.max(180, availableWidth * 0.28) / sizes.mobile.width);
      const mobileWidth = sizes.mobile.width * mobileScale;
      const mobileCardWidth = Math.max(304, mobileWidth + 2);
      const desktopScale = Math.min(1, availableHeight / sizes.desktop.height, Math.max(220, availableWidth - gap - mobileCardWidth) / sizes.desktop.width);
      const totalWidth = sizes.desktop.width * desktopScale + gap + mobileCardWidth;
      const fitScale = totalWidth > availableWidth ? availableWidth / totalWidth : 1;
      scaled.desktop = {
        height: sizes.desktop.height * desktopScale * fitScale,
        scale: desktopScale * fitScale,
        width: sizes.desktop.width * desktopScale * fitScale
      };
      scaled.mobile = {
        height: sizes.mobile.height * mobileScale * fitScale,
        scale: mobileScale * fitScale,
        width: mobileWidth * fitScale
      };
    }

    for (const id of FRAME_IDS) {
      const frame = frames[id];
      const metrics = scaled[id];
      frame.canvas.style.width = `${sizes[id].width}px`;
      frame.canvas.style.height = `${sizes[id].height}px`;
      frame.canvas.style.transform = `scale(${metrics.scale})`;
      frame.holder.style.width = `${metrics.width}px`;
      frame.holder.style.height = `${metrics.height}px`;
      frame.stage.style.width = mobileLayout ? "100%" : `${metrics.width + 2}px`;
      frame.stage.style.height = `${metrics.height + 2}px`;
      frame.measure.style.width = `${metrics.width}px`;
      frame.card.style.width = mobileLayout ? "100%" : `${Math.max(metrics.width + 2, id === "mobile" ? 304 : 0)}px`;
      frame.measureLabel.textContent = `${sizes[id].width} px`;
    }
  }

  const postScrollRatio = (id: FrameId, ratio: number) => {
    frames[id].frame.contentWindow?.postMessage(
      { scrollRatio: ratio, type: "setScrollRatio" },
      window.location.origin
    );
  };

  const handleParentMessage = (event: MessageEvent<ParentMessage>) => {
    if (event.origin !== window.location.origin || event.data?.source !== "web-dev-sandbox") {
      return;
    }
    const id = event.data.frame;
    if (!id || !FRAME_IDS.includes(id) || event.source !== frames[id].frame.contentWindow) {
      return;
    }
    if (event.data.type === "scroll") {
      const ratio = validRatio(event.data.scrollRatio);
      if (ratio !== null && linkScroll.checked) {
        postScrollRatio(id === "desktop" ? "mobile" : "desktop", ratio);
      }
      return;
    }
    if (event.data.type === "height") {
      const height = Number(event.data.documentHeight);
      if (!Number.isFinite(height)) {
        return;
      }
      documentHeights[id] = height;
      const overflow = height > sizes[id].height + 1;
      frames[id].overflow.textContent = overflow
        ? `overflow ${Math.max(1, height / sizes[id].height).toFixed(1)}×`
        : "fits viewport";
      return;
    }
    if (event.data.type === "console") {
      return;
    }
  };

  const beginWidthDrag = (id: FrameId, event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    const width = frames[id].holder.getBoundingClientRect().width;
    widthDrag = { frame: id, scale: width / sizes[id].width || 1, startWidth: sizes[id].width, startX: event.clientX };
    frames[id].measure.classList.add("dragging");
    frames[id].measure.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
  };

  const moveWidthDrag = (event: PointerEvent) => {
    if (!widthDrag) {
      return;
    }
    const delta = (event.clientX - widthDrag.startX) / widthDrag.scale;
    setSize(widthDrag.frame, { height: sizes[widthDrag.frame].height, width: Math.round(widthDrag.startWidth + delta) });
  };

  const endWidthDrag = () => {
    if (!widthDrag) {
      return;
    }
    frames[widthDrag.frame].measure.classList.remove("dragging");
    widthDrag = null;
    document.body.style.userSelect = "";
  };

  const copyText = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied LAN URL");
    } catch {
      setStatus("copy unavailable");
    }
  };

  const showQr = (id: FrameId) => {
    if (!qrDialog || !qrCode || !qrUrl) {
      return;
    }
    const url = currentUrl(id);
    const code = qrcode(0, "M");
    code.addData(url);
    code.make();
    qrCode.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    qrUrl.textContent = url;
    if (typeof qrDialog.showModal === "function") {
      qrDialog.showModal();
    } else {
      qrDialog.setAttribute("open", "");
    }
  };

  for (const id of FRAME_IDS) {
    const frame = frames[id];
    frame.input.value = formatSize(sizes[id]);
    frame.measureLabel.textContent = `${sizes[id].width} px`;
    frame.frame.addEventListener("load", () => {
      frame.status.textContent = source === "proxy" ? `port ${proxyPort}` : "ready";
      setStatus("ready");
      layout();
    });
    frame.frame.addEventListener("error", () => {
      frame.status.textContent = "preview unavailable";
      setStatus("preview unavailable");
    });
    const commitSizeInput = () => {
      const next = parseSize(frame.input.value);
      if (!next) {
        frame.input.value = formatSize(sizes[id]);
        return;
      }
      setSize(id, next, true);
    };
    frame.input.addEventListener("change", commitSizeInput);
    frame.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      commitSizeInput();
      frame.input.blur();
    });
    frame.preset.addEventListener("change", () => {
      const next = parseSize(frame.preset.value.replace("x", " × "));
      if (next) {
        setSize(id, next, true);
      }
      frame.preset.value = "";
    });
    frame.measure.addEventListener("pointerdown", (event) => beginWidthDrag(id, event));
  }

  document.addEventListener("pointermove", moveWidthDrag);
  document.addEventListener("pointerup", endWidthDrag);
  window.addEventListener("message", handleParentMessage);
  resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(surface);
  window.addEventListener("resize", layout);

  select.addEventListener("change", () => renderProject(select.value));
  sourceSelect.addEventListener("change", () => {
    source = sourceSelect.value === "proxy" ? "proxy" : "static";
    localStorage.setItem("sandbox-preview-source", source);
    portControl.hidden = source !== "proxy";
    renderEmptyState();
    if (!grid.hidden) {
      loadAllFrames(Date.now());
    }
  });
  portInput.addEventListener("change", () => {
    const next = Number(portInput.value);
    proxyPort = Number.isInteger(next) && next >= 1 && next <= 65535 ? next : 5173;
    portInput.value = String(proxyPort);
    localStorage.setItem("sandbox-proxy-port", String(proxyPort));
    if (source === "proxy") {
      loadAllFrames(Date.now());
    }
  });
  blockExternal.addEventListener("change", () => {
    localStorage.setItem("sandbox-block-external", String(blockExternal.checked));
    if (source === "static") {
      loadAllFrames(Date.now());
    }
  });
  linkScroll.addEventListener("change", () => {
    localStorage.setItem("sandbox-link-scroll", String(linkScroll.checked));
  });
  reloadButton.addEventListener("click", () => loadAllFrames(Date.now()));
  rotateButton?.addEventListener("click", () => {
    setSize("mobile", { height: sizes.mobile.width, width: sizes.mobile.height }, true);
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-frame-action]") : null;
    if (!target) {
      return;
    }
    const id = target.dataset.frame as FrameId;
    if (!FRAME_IDS.includes(id)) {
      return;
    }
    const action = target.dataset.frameAction;
    if (action === "open") {
      window.open(currentUrl(id), "_blank", "noopener,noreferrer");
    } else if (action === "copy") {
      void copyText(currentUrl(id));
    } else if (action === "qr") {
      showQr(id);
    }
    const details = target.closest("details");
    if (details) {
      details.open = false;
    }
  });
  qrClose?.addEventListener("click", () => qrDialog?.close());
  qrDialog?.addEventListener("click", (event) => {
    if (event.target === qrDialog) {
      qrDialog.close();
    }
  });

  portControl.hidden = source !== "proxy";
  renderEmptyState();
  void refreshProjects();
  window.requestAnimationFrame(layout);

  return {
    focus: () => surface.focus(),
    refreshProjects,
    reload: () => loadAllFrames(Date.now())
  };
}
