import path from "node:path";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { isSessionId, newSessionId, PtySessionStore } from "./pty.js";
import { listProjects, servePreview } from "./preview.js";
import { attachPortProxyWebsocket, registerPortProxy } from "./proxy.js";
import { attachWebsocketRoutes } from "./socket.js";
import { WorkspaceWatcher } from "./watcher.js";

const app = Fastify({
  logger: process.env.NODE_ENV !== "test"
});
const sessions = new PtySessionStore();
const distRoot = process.env.DIST_ROOT || "/app/dist";
const injectRoot = process.env.INJECT_ROOT || "/app/dist-inject";
const workspaceRoot = process.env.WORKSPACE_DIR || "/workspace";
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const sessionCookie = "sandbox_session";
const watcher = new WorkspaceWatcher(workspaceRoot, (error) => {
  app.log.error(error, "workspace watcher error");
});

await app.register(fastifyCookie);
attachWebsocketRoutes(app, sessions, watcher, sessionCookie);

app.addHook("onClose", async () => {
  sessions.dispose();
  await watcher.close();
});

app.get("/healthz", async (_request, reply) => {
  return reply.type("text/plain; charset=utf-8").send("ok\n");
});

app.get("/api/session", async (request, reply) => {
  const current = request.cookies[sessionCookie];
  const id = isSessionId(current) ? current : newSessionId();

  if (id !== current) {
    reply.setCookie(sessionCookie, id, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax"
    });
  }

  return reply.send({ ok: true });
});

app.get("/api/projects", async (_request, reply) => {
  return reply.send({ projects: await listProjects(workspaceRoot) });
});

app.get("/__dev/client.js", async (_request, reply) => {
  try {
    const client = await readFile(path.join(injectRoot, "client.js"), "utf8");
    return reply
      .type("text/javascript; charset=utf-8")
      .header("Cache-Control", "no-store, max-age=0")
      .send(client);
  } catch {
    return reply.code(500).type("text/plain; charset=utf-8").send("preview client unavailable\n");
  }
});

const previewHandler = async (request: Parameters<typeof servePreview>[0], reply: Parameters<typeof servePreview>[1]) => {
  return servePreview(request, reply, { workspaceRoot });
};

app.get("/preview/:project", previewHandler);
app.get("/preview/:project/*", previewHandler);

await registerPortProxy(app);
attachPortProxyWebsocket(app);

await app.register(fastifyStatic, {
  cacheControl: false,
  index: "index.html",
  maxAge: 0,
  root: path.resolve(distRoot)
});

app.setNotFoundHandler((_request, reply) => {
  return reply.code(404).type("text/plain; charset=utf-8").send("not found\n");
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
