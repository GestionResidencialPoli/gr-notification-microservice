# gr-notification-microservice

Hub WebSocket de Gestion Residencial: comunica los backends entre si y entrega notificaciones al navegador.

| Ruta | Quien se conecta | Autenticacion |
|---|---|---|
| `/internal/ws` | Microservicios, por la red interna | `X-Internal-Token` y `X-Service-Name` |
| `/api/v1/notificaciones/ws` | Navegador, a traves del gateway | Cookie `access_token` (JWE) |
| `GET /health` | Sondas de salud | Ninguna |

## Mensajes entre backends

```json
{ "type": "request", "id": "1", "target": "user-microservice", "action": "users.get", "payload": { "id": 7 } }
{ "type": "response", "id": "1", "ok": true, "payload": { "id": 7 } }
{ "type": "response", "id": "1", "ok": false, "error": { "code": "NO_ENCONTRADO", "message": "..." } }
{ "type": "event", "name": "contacto.creado", "audience": { "roles": ["ADMINISTRACION"] }, "payload": {} }
```

El hub reemplaza el `id` por uno propio al reenviar y lo restaura en la respuesta. Si el destino no esta conectado
responde `SERVICIO_NO_DISPONIBLE`; si no contesta dentro de `REQUEST_TIMEOUT_MS`, `TIEMPO_AGOTADO`.

## Limites

- Debe correr con **una sola replica**: las conexiones viven en memoria.
- Los eventos no se persisten; un navegador desconectado no recibe los que ocurrieron en su ausencia.
- El token interno es compartido, igual que en el HTTP interno: el nombre del servicio es declarado, no probado.

## Desarrollo

`pnpm install`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
