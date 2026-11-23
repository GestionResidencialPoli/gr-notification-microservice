import { randomUUID } from "crypto";
import { WebSocket, type RawData } from "ws";
import config from "../config";
import Logger from "../lib/logger";
import {
  frameSchema,
  type EventFrame,
  type RequestFrame,
  type ResponseFrame,
  type ServiceName,
} from "../types/frames";
import BrowserHub from "./browser-hub";

interface PendingRequest {
  origin: WebSocket;
  target: WebSocket;
  originalId: string;
  timer: NodeJS.Timeout;
}

function send(socket: WebSocket, frame: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

function parse(data: RawData): unknown {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

class ServiceHub {
  private static readonly services = new Map<ServiceName, Set<WebSocket>>();

  private static readonly pending = new Map<string, PendingRequest>();

  public static add(socket: WebSocket, name: ServiceName): void {
    const sockets = this.services.get(name) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.services.set(name, sockets);
    Logger.info("Servicio conectado", { service: name });

    socket.on("message", (data) => this.receive(socket, name, data));
    socket.once("close", () => {
      sockets.delete(socket);
      this.abandon(socket);
      Logger.info("Servicio desconectado", { service: name });
    });
  }

  public static connected(): ServiceName[] {
    return [...this.services].filter(([, sockets]) => sockets.size > 0).map(([name]) => name);
  }

  private static receive(socket: WebSocket, name: ServiceName, data: RawData): void {
    const parsed = frameSchema.safeParse(parse(data));

    if (!parsed.success) {
      Logger.warn("Mensaje invalido descartado", { service: name });
      send(socket, { type: "error", error: { code: "MENSAJE_INVALIDO", message: "El mensaje no es valido." } });
      return;
    }

    const frame = parsed.data;
    if (frame.type === "request") this.forward(socket, name, frame);
    else if (frame.type === "response") this.resolve(socket, frame);
    else this.notify(name, frame);
  }

  private static forward(origin: WebSocket, source: ServiceName, frame: RequestFrame): void {
    const target = this.pick(frame.target);
    if (!target) {
      this.fail(origin, frame.id, "SERVICIO_NO_DISPONIBLE", `${frame.target} no esta conectado.`);
      return;
    }

    const hubId = randomUUID();
    const timer = setTimeout(() => {
      this.pending.delete(hubId);
      this.fail(origin, frame.id, "TIEMPO_AGOTADO", `${frame.target} no respondio a tiempo.`);
    }, config.requestTimeoutMs);

    this.pending.set(hubId, { origin, target, originalId: frame.id, timer });
    send(target, { type: "request", id: hubId, source, action: frame.action, payload: frame.payload ?? null });
  }

  private static resolve(socket: WebSocket, frame: ResponseFrame): void {
    const request = this.pending.get(frame.id);
    if (!request || request.target !== socket) return;

    clearTimeout(request.timer);
    this.pending.delete(frame.id);
    send(request.origin, { ...frame, id: request.originalId });
  }

  private static notify(source: ServiceName, frame: EventFrame): void {
    const delivered = BrowserHub.broadcast(frame);
    Logger.info("Evento distribuido", { source, event: frame.name, delivered });
  }

  private static pick(name: ServiceName): WebSocket | undefined {
    return [...(this.services.get(name) ?? [])].find((socket) => socket.readyState === WebSocket.OPEN);
  }

  private static abandon(socket: WebSocket): void {
    for (const [hubId, request] of this.pending) {
      if (request.origin !== socket && request.target !== socket) continue;

      clearTimeout(request.timer);
      this.pending.delete(hubId);
      if (request.target === socket) {
        this.fail(request.origin, request.originalId, "SERVICIO_NO_DISPONIBLE", "El servicio destino se desconecto.");
      }
    }
  }

  private static fail(socket: WebSocket, id: string, code: string, message: string): void {
    send(socket, { type: "response", id, ok: false, error: { code, message } });
  }
}

export default ServiceHub;
