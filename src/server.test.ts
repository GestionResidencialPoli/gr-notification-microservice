import type { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import config from "./config";
import { encryptNestedJwt } from "./lib/jwe";
import Server from "./server";

interface Frame {
  type: string;
  id?: string;
  ok?: boolean;
  source?: string;
  action?: string;
  payload?: unknown;
  error?: { code: string };
}

let server: Server;
let base: string;
let sockets: WebSocket[];

function open(path: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${path}`, { headers });
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function service(name: string, token: string = config.internalServiceToken): Promise<WebSocket> {
  return open("/internal/ws", { "X-Internal-Token": token, "X-Service-Name": name });
}

function browser(uid: number, roles: string[], expiresIn = 60): Promise<WebSocket> {
  const signed = jwt.sign({ sub: `${uid}@example.com`, uid, roles }, config.jwtSecret, { expiresIn });
  const token = encryptNestedJwt(signed, config.jwtEncryptionKey);
  return open("/api/v1/notificaciones/ws", { Cookie: `access_token=${token}` });
}

function next(socket: WebSocket): Promise<Frame> {
  return new Promise((resolve) => socket.once("message", (data) => resolve(JSON.parse(data.toString()))));
}

function request(socket: WebSocket, id: string, target = "user-microservice"): Promise<Frame> {
  const response = next(socket);
  socket.send(JSON.stringify({ type: "request", id, target, action: "users.get", payload: { id: 1 } }));
  return response;
}

describe("Server", () => {
  beforeEach(async () => {
    sockets = [];
    server = new Server();
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    base = `ws://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.terminate());
    await new Promise((resolve) => server.httpServer.close(resolve));
  });

  it("enruta la peticion y devuelve la respuesta con el id original", async () => {
    const user = await service("user-microservice");
    const wall = await service("wall-microservice");
    user.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      user.send(JSON.stringify({ type: "response", id: frame.id, ok: true, payload: { frame } }));
    });

    const response = await request(wall, "a-1");

    expect(response.id).toBe("a-1");
    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({ frame: { source: "wall-microservice", action: "users.get" } });
  });

  it("no mezcla respuestas cuando dos servicios usan el mismo id", async () => {
    const user = await service("user-microservice");
    const wall = await service("wall-microservice");
    const gate = await service("gate-microservice");
    user.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      user.send(JSON.stringify({ type: "response", id: frame.id, ok: true, payload: frame.source }));
    });

    const [first, second] = await Promise.all([request(wall, "1"), request(gate, "1")]);

    expect(first.payload).toBe("wall-microservice");
    expect(second.payload).toBe("gate-microservice");
  });

  it("informa cuando el destino no esta conectado", async () => {
    const wall = await service("wall-microservice");
    expect((await request(wall, "1")).error?.code).toBe("SERVICIO_NO_DISPONIBLE");
  });

  it("informa cuando el destino no responde a tiempo", async () => {
    await service("user-microservice");
    const wall = await service("wall-microservice");
    expect((await request(wall, "1")).error?.code).toBe("TIEMPO_AGOTADO");
  });

  it("informa de inmediato cuando el destino se desconecta con peticiones pendientes", async () => {
    const user = await service("user-microservice");
    const wall = await service("wall-microservice");
    user.on("message", () => user.close());
    expect((await request(wall, "1")).error?.code).toBe("SERVICIO_NO_DISPONIBLE");
  });

  it("ignora respuestas de un servicio que no recibio la peticion", async () => {
    const user = await service("user-microservice");
    const gate = await service("gate-microservice");
    const wall = await service("wall-microservice");
    user.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      gate.send(JSON.stringify({ type: "response", id: frame.id, ok: true, payload: "suplantada" }));
    });

    expect((await request(wall, "1")).error?.code).toBe("TIEMPO_AGOTADO");
  });

  it("entrega los eventos solo a la audiencia indicada", async () => {
    const contact = await service("contact-microservice");
    const admin = await browser(1, ["ADMINISTRACION"]);
    const resident = await browser(7, ["RESIDENTE"]);
    const target = await browser(8, ["RESIDENTE"]);
    let unexpected = 0;
    resident.on("message", () => (unexpected += 1));

    const received = Promise.all([next(admin), next(target)]);
    contact.send(
      JSON.stringify({
        type: "event",
        name: "contacto.creado",
        audience: { roles: ["ADMINISTRACION"], userIds: [8] },
        payload: { id: 5 },
      }),
    );

    expect(await received).toEqual([
      { type: "contacto.creado", payload: { id: 5 } },
      { type: "contacto.creado", payload: { id: 5 } },
    ]);
    expect(unexpected).toBe(0);
  });

  it("rechaza mensajes invalidos sin cerrar la conexion", async () => {
    const wall = await service("wall-microservice");
    const response = next(wall);
    wall.send("no es json");
    expect((await response).error?.code).toBe("MENSAJE_INVALIDO");
    expect(wall.readyState).toBe(WebSocket.OPEN);
  });

  it("cierra la conexion del navegador cuando vence la sesion", async () => {
    const socket = await browser(1, ["RESIDENTE"], 1);
    const code = await new Promise((resolve) => socket.once("close", resolve));
    expect(code).toBe(4401);
  });

  it.each([
    ["token interno invalido", () => service("wall-microservice", "otro")],
    ["servicio desconocido", () => service("intruso")],
    ["navegador sin sesion", () => open("/api/v1/notificaciones/ws", {})],
    ["ruta desconocida", () => open("/otra", {})],
  ])("rechaza la conexion: %s", async (_name, connect) => {
    await expect(connect()).rejects.toThrow(/401|404/);
  });
});
