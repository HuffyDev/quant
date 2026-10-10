import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/tests/**/*.test.ts"],
    environment: "node",
    // tests never touch the network. Only the opt-in integration tests use a real DB:
    //   TEST_DATABASE_URL (sim run, a throwaway DB — it is TRUNCATEd) / TEST_ADMIN_DATABASE_URL (migrations)
    env: { MODE: "sim", LLM_PROVIDER: "mock", SIM_SPEED: "10", DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://test:test@127.0.0.1:1/none" },
  },
});
