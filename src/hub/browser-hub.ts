import { WebSocket } from "ws";
import type { SessionClaims } from "../lib/token-service";
import type { EventFrame } from "../types/frames";

const CLOSE_SESSION_EXPIRED = 4401;
const MAX_TIMER_MS = 2_147_483_647;

class BrowserHub {
  private static readonly sessions = new Map<WebSocket, SessionClaims>();

  public static add(socket: WebSocket, claims: SessionClaims): void {
    this.sessions.set(socket, claims);

    const remaining = Math.min(Math.max(claims.expiresAt - Date.now(), 0), MAX_TIMER_MS);
    const expiration = setTimeout(() => socket.close(CLOSE_SESSION_EXPIRED, "Sesion vencida"), remaining);

    socket.once("close", () => {
      clearTimeout(expiration);
      this.sessions.delete(socket);
    });
  }

  public static broadcast(event: EventFrame): number {
    const message = JSON.stringify({ type: event.name, payload: event.payload ?? null });
    let delivered = 0;

    for (const [socket, claims] of this.sessions) {
      if (socket.readyState !== WebSocket.OPEN || !this.isRecipient(event, claims)) continue;
      socket.send(message);
      delivered += 1;
    }

    return delivered;
  }

  private static isRecipient(event: EventFrame, claims: SessionClaims): boolean {
    const { roles, userIds } = event.audience;
    return Boolean(roles?.some((role) => claims.roles.includes(role)) || userIds?.includes(claims.uid));
  }
}

export default BrowserHub;
