/**
 * /stream query params (all optional). Geometry is in the 1920×1080 stage's pixels.
 *   x, y, w, h        monitor rectangle (top-left + size)
 *   rotate            degrees, clockwise
 *   skewX, skewY      degrees
 *   rx, ry            3D tilt in degrees (perspective), for a monitor seen at an angle
 *   fs                chat font size (px at 1080p, min 22 so it stays readable on a stream)
 *   lines             max visible lines (default 8; older ones fade out)
 *   cps               reply typing speed (characters / second)
 *   ticker            right | left | off
 *   video             video path (default /media/hacker.mp4)
 *   calibrate         1 = drag/resize the monitor box and copy the resulting URL
 *   key               the STREAM_KEY (checked by the server; kept in the calibration URL)
 */
export interface StreamParams {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  skewX: number;
  skewY: number;
  rx: number;
  ry: number;
  fs: number;
  lines: number;
  cps: number;
  ticker: "right" | "left" | "off";
  video: string;
  calibrate: boolean;
}

/**
 * Defaults fit the monitor in public/media/hacker.mp4 (screen ≈ x388–1153, y378–766, top edge tilted ~0.45°),
 * inset from the right and bottom edges where his right shoulder overlaps the screen.
 */
export const STREAM_DEFAULTS: StreamParams = {
  x: 408,
  y: 398,
  w: 640,
  h: 320,
  rotate: 0.45,
  skewX: 0,
  skewY: 0,
  rx: 0,
  ry: 0,
  fs: 26,
  lines: 8,
  cps: 32,
  ticker: "left",
  video: "/media/hacker.mp4",
  calibrate: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(q: URLSearchParams, k: string, d: number, lo: number, hi: number): number {
  const raw = q.get(k);
  if (raw === null || raw.trim() === "") return d;
  const v = Number(raw);
  return Number.isFinite(v) ? clamp(v, lo, hi) : d;
}

export function parseStreamParams(search: string): StreamParams {
  const q = new URLSearchParams(search);
  const t = q.get("ticker");
  const video = q.get("video");
  return {
    x: num(q, "x", STREAM_DEFAULTS.x, -1920, 1920),
    y: num(q, "y", STREAM_DEFAULTS.y, -1080, 1080),
    w: num(q, "w", STREAM_DEFAULTS.w, 40, 1920),
    h: num(q, "h", STREAM_DEFAULTS.h, 40, 1080),
    rotate: num(q, "rotate", STREAM_DEFAULTS.rotate, -180, 180),
    skewX: num(q, "skewX", 0, -60, 60),
    skewY: num(q, "skewY", 0, -60, 60),
    rx: num(q, "rx", 0, -80, 80),
    ry: num(q, "ry", 0, -80, 80),
    fs: num(q, "fs", STREAM_DEFAULTS.fs, 22, 64),
    lines: Math.round(num(q, "lines", STREAM_DEFAULTS.lines, 2, 8)),
    cps: num(q, "cps", STREAM_DEFAULTS.cps, 4, 400),
    ticker: t === "right" || t === "off" ? t : "left",
    // same-origin paths only
    video: video && /^\/(?!\/)[\w\-./]+$/.test(video) && !video.includes("..") ? video : STREAM_DEFAULTS.video,
    calibrate: q.get("calibrate") === "1",
  };
}

/** Query string for a params object (only non-default values), for the calibration "copy URL" box. */
export function streamQuery(p: StreamParams): string {
  const q = new URLSearchParams();
  const r = (v: number) => String(Math.round(v * 10) / 10);
  for (const k of ["x", "y", "w", "h", "rotate", "skewX", "skewY", "rx", "ry", "fs", "lines", "cps"] as const) q.set(k, r(p[k]));
  if (p.ticker !== "left") q.set("ticker", p.ticker);
  if (p.video !== STREAM_DEFAULTS.video) q.set("video", p.video);
  return q.toString();
}

/** CSS transform for the monitor box (origin: its centre). */
export function monitorTransform(p: StreamParams): string {
  const parts = [`rotate(${p.rotate}deg)`];
  if (p.skewX || p.skewY) parts.push(`skew(${p.skewX}deg, ${p.skewY}deg)`);
  if (p.rx || p.ry) parts.unshift(`perspective(1600px) rotateX(${p.rx}deg) rotateY(${p.ry}deg)`);
  return parts.join(" ");
}

/** How many characters of a reply are visible `elapsedMs` after it arrived. */
export function typedLength(text: string, elapsedMs: number, cps: number): number {
  return Math.max(0, Math.min(text.length, Math.floor((elapsedMs / 1000) * cps)));
}

/** Opacity of a monitor line by its position from the newest (0 = newest): older lines fade out. */
export function lineOpacity(fromNewest: number, max: number): number {
  const solid = Math.max(1, Math.ceil(max / 2));
  if (fromNewest < solid) return 1;
  const k = (fromNewest - solid + 1) / (max - solid + 1);
  return Math.max(0.12, 1 - k * 0.85);
}
