import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { actions } from "../db/schema";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function page(title: string, banner: string, row: Record<string, unknown> | undefined) {
  const body = row
    ? `<table>${Object.entries(row)
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v instanceof Date ? v.toISOString() : String(v ?? "—"))}</td></tr>`)
        .join("")}</table>`
    : "<p>not found</p>";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{background:#030405;color:#eef2f6;font:13px/1.6 "JetBrains Mono",ui-monospace,monospace;padding:16px;max-width:820px;margin:auto}
.b{border:1px solid #f2d18b;color:#f2d18b;padding:8px 12px;margin:12px 0}td{padding:4px 12px 4px 0;vertical-align:top;word-break:break-all}td:first-child{color:#8b939d}a{color:#9fd8ff}</style></head>
<body><a href="/">← baby brain</a><h1 style="font-size:14px;letter-spacing:.2em">${esc(title)}</h1><div class="b">${esc(banner)}</div>${body}</body></html>`;
}

/** Proof pages for simulated txs/posts and for failed actions (which have no tx). */
export async function proofRoutes(app: FastifyInstance) {
  app.get<{ Params: { sig: string } }>("/sim/tx/:sig", async (req, reply) => {
    const [row] = await db.select().from(actions).where(eq(actions.txSig, req.params.sig)).limit(1);
    reply.type("text/html").send(page("SIMULATED TRANSACTION", "MODE=sim — this transaction was simulated and is NOT on chain. In live mode this links to Solscan.", row));
  });
  app.get<{ Params: { id: string } }>("/sim/x/:id", async (req, reply) => {
    const [row] = await db.select().from(actions).where(eq(actions.xPostId, req.params.id)).limit(1);
    reply.type("text/html").send(page("SIMULATED X POST", "MODE=sim — this post was logged, not sent to X. In live mode this links to the real post.", row));
  });
  app.get<{ Params: { id: string } }>("/proof/action/:id", async (req, reply) => {
    const [row] = await db.select().from(actions).where(eq(actions.id, Number(req.params.id) || 0)).limit(1);
    reply.type("text/html").send(page("ACTION RECORD", "No transaction exists for this action (it did not execute). This is the public record of why.", row));
  });
}
