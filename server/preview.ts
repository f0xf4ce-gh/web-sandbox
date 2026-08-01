import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const BLOCK_EXTERNAL_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'"
].join("; ");

export interface PreviewConfig {
  workspaceRoot: string;
}

interface PreviewParams {
  project?: string;
  "*"?: string;
}

interface PreviewQuery {
  blockExternal?: string;
}

const EARLY_CONSOLE_BOOTSTRAP = `<script>(function () {
  var key = "__sandboxEarlyConsole";
  if (window[key]) return;
  var levels = ["log", "info", "warn", "error"];
  var originalConsole = window.console;
  var queue = [];
  var capturedConsole = Object.create(originalConsole);
  levels.forEach(function (level) {
    var method = originalConsole[level];
    if (typeof method !== "function") return;
    var original = method.bind(originalConsole);
    var wrapped = function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        original.apply(null, args);
      } finally {
        if (queue.length < 100) queue.push({ args: args, level: level, timestamp: Date.now() });
      }
    };
    try {
      Object.defineProperty(capturedConsole, level, { configurable: true, value: wrapped, writable: true });
    } catch (_) {
      capturedConsole[level] = wrapped;
    }
  });
  var state = { originalConsole: originalConsole, queue: queue };
  try {
    Object.defineProperty(window, key, { configurable: true, value: state, writable: true });
    Object.defineProperty(window, "console", { configurable: true, value: capturedConsole, writable: true });
  } catch (_) {
    window[key] = state;
    window.console = capturedConsole;
  }
})();</script>`;

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function decodePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isSafeProjectName(project: string): boolean {
  return Boolean(
    project &&
      project !== "." &&
      project !== ".." &&
      !project.startsWith(".") &&
      !project.includes("\\") &&
      !project.includes("\0") &&
      path.basename(project) === project
  );
}

function contentType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function injectClient(html: string): string {
  const script = '<script src="/__dev/client.js"></script>';
  const openingHead = /<head(?:\s[^>]*)?>/i;
  const openingBody = /<body(?:\s[^>]*)?>/i;
  const closingBody = /<\/body\s*>/i;
  const earlyMatch = openingHead.exec(html) || openingBody.exec(html);
  const withEarlyCapture = earlyMatch && earlyMatch.index !== undefined
    ? `${html.slice(0, earlyMatch.index + earlyMatch[0].length)}${EARLY_CONSOLE_BOOTSTRAP}${html.slice(earlyMatch.index + earlyMatch[0].length)}`
    : `${EARLY_CONSOLE_BOOTSTRAP}${html}`;
  const match = closingBody.exec(withEarlyCapture);
  if (!match || match.index === undefined) {
    return `${withEarlyCapture}\n${script}\n`;
  }

  return `${withEarlyCapture.slice(0, match.index)}${script}${withEarlyCapture.slice(match.index)}`;
}

function applyPreviewHeaders(reply: FastifyReply, query: PreviewQuery): void {
  reply.header("Cache-Control", "no-store, max-age=0");
  reply.header("X-Content-Type-Options", "nosniff");
  if (query.blockExternal === "1" || query.blockExternal === "true") {
    reply.header("Content-Security-Policy", BLOCK_EXTERNAL_CSP);
  }
}

async function resolvePreviewFile(
  workspaceRoot: string,
  params: PreviewParams
): Promise<{ filePath: string; isHtml: boolean } | null> {
  const projectValue = params.project ? decodePart(params.project) : null;
  const wildcardValue = params["*"] || "";
  const relativeValue = decodePart(wildcardValue.replace(/^\/+/, ""));
  if (!projectValue || relativeValue === null || !isSafeProjectName(projectValue)) {
    return null;
  }

  const workspacePath = path.resolve(workspaceRoot);
  const projectPath = path.resolve(workspacePath, projectValue);
  if (!isWithin(workspacePath, projectPath)) {
    return null;
  }

  try {
    const realWorkspace = await fs.realpath(workspacePath);
    const realProject = await fs.realpath(projectPath);
    if (!isWithin(realWorkspace, realProject)) {
      return null;
    }

    let requestedPath = path.resolve(realProject, relativeValue || "index.html");
    if (!isWithin(realProject, requestedPath)) {
      return null;
    }

    requestedPath = await fs.realpath(requestedPath);
    if (!isWithin(realProject, requestedPath)) {
      return null;
    }

    let stats = await fs.stat(requestedPath);
    if (stats.isDirectory()) {
      requestedPath = await fs.realpath(path.join(requestedPath, "index.html"));
      if (!isWithin(realProject, requestedPath)) {
        return null;
      }
      stats = await fs.stat(requestedPath);
    }

    if (!stats.isFile()) {
      return null;
    }

    return {
      filePath: requestedPath,
      isHtml: contentType(requestedPath).startsWith("text/html")
    };
  } catch {
    return null;
  }
}

export async function listProjects(workspaceRoot: string): Promise<string[]> {
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name !== "node_modules" && isSafeProjectName(entry.name)
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function servePreview(
  request: FastifyRequest,
  reply: FastifyReply,
  config: PreviewConfig
): Promise<FastifyReply> {
  const params = request.params as PreviewParams;
  const query = request.query as PreviewQuery;
  const resolved = await resolvePreviewFile(config.workspaceRoot, params);
  if (!resolved) {
    return reply.code(404).type("text/plain; charset=utf-8").send("preview file not found\n");
  }

  applyPreviewHeaders(reply, query);
  if (resolved.isHtml) {
    const html = await fs.readFile(resolved.filePath, "utf8");
    return reply.type("text/html; charset=utf-8").send(injectClient(html));
  }

  return reply.type(contentType(resolved.filePath)).send(createReadStream(resolved.filePath));
}
