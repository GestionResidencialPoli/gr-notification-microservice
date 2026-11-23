import express, { type Application } from "express";
import helmet from "helmet";
import http, { type IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, type WebSocket } from "ws";
import config from "./config";
import BrowserHub from "./hub/browser-hub";
import ServiceHub from "./hub/service-hub";
import Logger from "./lib/logger";
import TokenService, { type SessionClaims } from "./lib/token-service";
import { isServiceName } from "./types/frames";

const INTERNAL_PATH = "/internal/ws";
const BROWSER_PATH = "/api/v1/notificaciones/ws";
const BROWSER_MAX_PAYLOAD_BYTES = 1_024;

function reject(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

function pathOf(request: IncomingMessage): string {
  return (request.url ?? "/").split("?")[0] ?? "/";
}

function sessionOf(request: IncomingMessage): SessionClaims | null {
  const prefix = `${config.accessTokenCookieName}=`;
  const cookie = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return cookie ? TokenService.verifyAccessToken(cookie.slice(prefix.length)) : null;
}

class Server {
  public readonly app: Application = express();

  public readonly httpServer = http.createServer(this.app);

  private readonly internal = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });

  private readonly browsers = new WebSocketServer({ noServer: true, maxPayload: BROWSER_MAX_PAYLOAD_BYTES });

  constructor() {
    this.app.use(helmet());
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", services: ServiceHub.connected() });
    });

    this.httpServer.on("upgrade", (request, socket, head) => this.upgrade(request, socket, head));
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = pathOf(request);

    if (path === INTERNAL_PATH) {
      this.acceptService(request, socket, head);
    } else if (path === BROWSER_PATH) {
      this.acceptBrowser(request, socket, head);
    } else {
      reject(socket, "404 Not Found");
    }
  }

  private acceptService(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const name = request.headers["x-service-name"];

    if (!TokenService.isInternalToken(request.headers["x-internal-token"]) || !isServiceName(name)) {
      reject(socket, "401 Unauthorized");
      return;
    }

    this.internal.handleUpgrade(request, socket, head, (webSocket) => {
      this.prepare(webSocket);
      ServiceHub.add(webSocket, name);
    });
  }

  private acceptBrowser(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const claims = sessionOf(request);

    if (!claims) {
      reject(socket, "401 Unauthorized");
      return;
    }

    this.browsers.handleUpgrade(request, socket, head, (webSocket) => {
      this.prepare(webSocket);
      BrowserHub.add(webSocket, claims);
    });
  }

  private prepare(socket: WebSocket): void {
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, config.heartbeatMs);

    socket.on("pong", () => {
      alive = true;
    });
    socket.on("error", (error) => Logger.error(error, { source: "websocket" }));
    socket.once("close", () => clearInterval(heartbeat));
  }
}

export default Server;
