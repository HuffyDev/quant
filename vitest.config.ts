import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/tests/**/*.test.ts"],
    environment: "node",
    // vitest sets MODE=test by default; tests never touch the network or a real DB
    env: { MODE: "sim", LLM_PROVIDER: "mock", DATABASE_URL: process.env.DATABASE_URL || "postgres://test:test@127.0.0.1:1/none" },
  },
});
