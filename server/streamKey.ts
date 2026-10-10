import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** /stream access: the request's key must equal STREAM_KEY. Unset STREAM_KEY disables /stream entirely. */
export function streamKeyOk(key: string | undefined, secret = env.STREAM_KEY): boolean {
  if (!secret || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
