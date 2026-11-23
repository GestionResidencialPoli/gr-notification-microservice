import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }

  return value;
}

function requiredSecret(name: string): string {
  const value = required(name);

  if (value.length < 32) {
    throw new Error(`${name} debe tener al menos 32 caracteres`);
  }

  return value;
}

function requiredEncryptionKey(name: string): Buffer {
  const value = required(name);
  const key = Buffer.from(value, "base64url");

  if (key.length !== 32 || key.toString("base64url") !== value) {
    throw new Error(`${name} debe ser una clave de 32 bytes en base64url sin relleno (43 caracteres)`);
  }

  return key;
}

const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4600),
  jwtSecret: requiredSecret("JWT_SECRET"),
  jwtEncryptionKey: requiredEncryptionKey("JWT_ENCRYPTION_KEY"),
  internalServiceToken: requiredSecret("INTERNAL_SERVICE_TOKEN"),
  accessTokenCookieName: process.env.ACCESS_TOKEN_COOKIE_NAME ?? "access_token",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 5_000),
  heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 25_000),
  maxPayloadBytes: Number(process.env.MAX_PAYLOAD_BYTES ?? 1_048_576),
} as const;

export default config;
