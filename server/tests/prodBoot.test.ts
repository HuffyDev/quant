/**
 * Boots the PRODUCTION build (`npm run build` output + NODE_ENV=production server) against a throwaway database and
 * requests the public pages. Guards the /stream regression (500 in production) and the stream key.
 * Needs TEST_ADMIN_DATABASE_URL (a role that can CREATE/DROP DATABASE); skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { io as ioClient } from "socket.io-client";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbName = `root_prod_test_${process.pid}`;
const port = 5600 + (process.pid % 300);
const base = `http://127.0.0.1:${port}`;
const KEY = "test";

async function admin(sql: string) {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

describe.skipIf(!ADMIN)("production build boot", () => {
  let server: ChildProcess | null = null;
  let log = "";

  beforeAll(async () => {
    if (!fs.existsSync(path.join(root, "dist/index.html"))) execSync("npm run build", { cwd: root, stdio: "ignore" });
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${dbName}`);
    const url = new URL(ADMIN!);
    url.pathname = `/${dbName}`;
    server = spawn(path.join(root, "node_modules/.bin/tsx"), ["server/index.ts"], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_URL: url.toString(), MODE: "sim", LLM_PROVIDER: "mock", ADMIN_TOKEN: "t", STREAM_KEY: KEY, SIM_SPEED: "10" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout!.on("data", (d) => (log += d));
    server.stderr!.on("data", (d) => (log += d));
    for (let i = 0; i < 120; i++) {
      const ok = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`server did not start:\n${log}`);
  }, 90_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  }, 30_000);

  it.each(["/", "/core", `/stream?key=${KEY}`])("GET %s → 200 html", async (p) => {
    const r = await fetch(base + p);
    expect(r.status, log.slice(-2000)).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(await r.text()).toContain('<div id="root">');
  });

  it("/stream is never indexed", async () => {
    const r = await fetch(`${base}/stream?key=${KEY}&calibrate=1`);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(await r.text()).toMatch(/<meta name="robots" content="noindex/);
    // and the public pages stay indexable
    expect((await fetch(`${base}/`).then((x) => x.text())).includes('name="robots"')).toBe(false);
  });

  it.each(["/stream", "/stream?key=wrong", "/stream?key=", "/stream/", "/stream/x"])("GET %s → 404", async (p) => {
    expect((await fetch(base + p)).status).toBe(404);
  });

  it("serves the stream video", async () => {
    const r = await fetch(`${base}/media/hacker.mp4`, { headers: { range: "bytes=0-99" } });
    expect([200, 206]).toContain(r.status);
    expect(r.headers.get("content-type")).toMatch(/video\/mp4/);
  });

  it("only a socket with the key joins the probe room", async () => {
    const join = (key: string) =>
      new Promise<boolean>((resolve, reject) => {
        const s = ioClient(base, { transports: ["websocket"], forceNew: true });
        s.on("connect_error", reject);
        s.on("connect", () =>
          s.emit("stream:join", key, (ok: boolean) => {
            s.close();
            resolve(ok);
          }),
        );
      });
    expect(await join(KEY)).toBe(true);
    expect(await join("nope")).toBe(false);
  }, 20_000);
});
