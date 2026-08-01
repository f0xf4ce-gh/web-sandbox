import http from "node:http";
import https from "node:https";
import WebSocket from "ws";

const baseUrl = new URL(process.env.SANDBOX_URL || "https://localhost");
const sessionUrl = new URL("/api/session", baseUrl);
const socketUrl = new URL("/ws/pty", baseUrl);
socketUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";

const transport = baseUrl.protocol === "https:" ? https : http;
const tlsOptions = baseUrl.protocol === "https:" ? { rejectUnauthorized: false } : {};

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`terminal smoke failed: ${message}`);
  process.exitCode = 1;
}

try {
  await new Promise((resolve, reject) => {
    const request = transport.get(sessionUrl, tlsOptions, (response) => {
      response.resume();
      if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
        reject(new Error(`session endpoint returned HTTP ${response.statusCode}`));
        return;
      }

      const cookie = response.headers["set-cookie"]?.[0]?.split(";")[0];
      if (!cookie) {
        reject(new Error("session endpoint did not set a cookie"));
        return;
      }

      const socket = new WebSocket(socketUrl, {
        ...tlsOptions,
        headers: { Cookie: cookie }
      });
      let output = "";
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error("timed out waiting for PTY output"));
      }, 8000);

      socket.on("open", () => {
        socket.send(JSON.stringify({ type: "input", data: "echo sandbox-terminal-smoke-ok\n" }));
      });
      socket.on("message", (data) => {
        output += data.toString();
        if (output.includes("sandbox-terminal-smoke-ok")) {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }
      });
      socket.on("error", reject);
    });

    request.on("error", reject);
  });

  console.log("Terminal websocket check passed");
} catch (error) {
  fail(error);
}
