import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    env: {
      JWT_SECRET: "test-jwt-secret-de-al-menos-32-caracteres",
      JWT_ENCRYPTION_KEY: "Y2xhdmUtZGUtcHJ1ZWJhcy1kZS0zMi1ieXRlcy1vayE",
      INTERNAL_SERVICE_TOKEN: "test-internal-service-token-de-32-caracteres",
      REQUEST_TIMEOUT_MS: "200",
    },
  },
});
