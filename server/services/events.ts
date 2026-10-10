import { EventEmitter } from "node:events";
import type { Server as IOServer } from "socket.io";
import { db } from "../db/client";
import { events } from "../db/schema";
import type { EventType, PublicEvent, Source } from "../../shared/types";
import { ageS } from "./clock";

let io: IOServer | null = null;

/** Internal bus: "changed" means public state should be recomputed. */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function attachIO(server: IOServer) {
  io = server;
}

export function broadcast(channel: string, payload: unknown) {
  io?.emit(channel, payload);
}

export interface EmitInput {
  type: EventType;
  source: Source;
  message: string;
  data?: Record<string, unknown>;
  proofUrl?: string | null;
}

/** Persist an event, push it to every connected client, and mark state dirty. */
export async function emit(e: EmitInput): Promise<PublicEvent> {
  const [row] = await db
    .insert(events)
    .values({
      type: e.type,
      source: e.source,
      message: e.message,
      data: e.data ?? null,
      proofUrl: e.proofUrl ?? null,
      ageS: ageS(),
    })
    .returning();
  const pub: PublicEvent = {
    id: row.id,
    ts: row.ts.toISOString(),
    ageS: row.ageS,
    type: row.type as EventType,
    source: row.source as Source,
    message: row.message,
    data: (row.data as Record<string, unknown>) ?? null,
    proofUrl: row.proofUrl,
  };
  const tag = `[${pub.type}]`.padEnd(14);
  console.log(`${tag}${pub.source.padEnd(9)}${pub.message}`);
  broadcast("event", pub);
  markDirty();
  return pub;
}

export function markDirty() {
  bus.emit("changed");
}
