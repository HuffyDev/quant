/**
 * npm run placeholders — regenerate the placeholder media (only files that don't exist yet, unless --force):
 *   public/root.png            logo / favicon / OG image          (replace with the real one)
 *   public/models/brain.glb    brain mesh, built from the procedural brain   (replace with the real one)
 *   public/stream/hacker.mp4   1920×1080 loop: hooded figure at a monitor     (replace with the real one)
 *   public/stream/hacker.webm  same, VP9, for browsers without H.264  (replace too, or delete it)
 * Needs Chromium (CHROMIUM_PATH, default /opt/pw-browsers/chromium) for the PNG/MP4 and ffmpeg for the MP4.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { chromium } from "playwright-core";
import { cerebellumPoint, cortexPoint, stemPoint } from "../client/src/brain/geometry";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pub = (p: string) => path.join(root, "public", p);
const force = process.argv.includes("--force");
const need = (p: string) => force || !fs.existsSync(pub(p));
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

// ── brain.glb ────────────────────────────────────────────────────────────────
function mapGeometry(g: THREE.BufferGeometry, f: (x: number, y: number, z: number, i: number) => [number, number, number]) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = f(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    pos.setXYZ(i, x, y, z);
  }
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

async function makeGlb() {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) parts.push(mapGeometry(new THREE.SphereGeometry(1, 160, 120), (x, y, z) => cortexPoint(x, y, z, side)));
  parts.push(mapGeometry(new THREE.SphereGeometry(1, 96, 64), (x, y, z) => cerebellumPoint(x, y, z)));
  const stem = new THREE.CylinderGeometry(1, 1, 1, 32, 16, true);
  parts.push(mapGeometry(stem, (x, y, z) => stemPoint(0.5 - y, Math.atan2(z, x))));
  const merged = mergeGeometries(parts.map((g) => (g.index ? g : g)), false)!;
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x9fd6ff }));
  mesh.name = "brain_placeholder";
  const scene = new THREE.Scene();
  scene.add(mesh);

  // GLTFExporter's binary path uses FileReader (browser API): minimal Node shim
  (globalThis as unknown as { FileReader: unknown }).FileReader = class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(b: Blob) {
      void b.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(b: Blob) {
      void b.arrayBuffer().then((buf) => {
        (this as unknown as { result: string }).result = `data:application/octet-stream;base64,${Buffer.from(buf).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  fs.mkdirSync(pub("models"), { recursive: true });
  fs.writeFileSync(pub("models/brain.glb"), Buffer.from(glb));
  console.log(`wrote public/models/brain.glb (${(glb.byteLength / 1e6).toFixed(2)} MB)`);
}

// ── root.png ─────────────────────────────────────────────────────────────────
const LOGO_HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div style="width:1024px;height:1024px;display:grid;place-items:center;background:radial-gradient(50% 50% at 50% 45%,#0b2340 0,#000 70%);font-family:'DejaVu Sans Mono',monospace">
  <div style="text-align:center">
    <div style="font-size:300px;font-weight:700;line-height:1;color:#dff1ff;text-shadow:0 0 30px #5aa9f0,0 0 90px #2d6fbf;letter-spacing:-10px">#_</div>
    <div style="margin-top:40px;font-size:120px;font-weight:700;letter-spacing:24px;color:#e8f6ff;text-shadow:0 0 24px #5aa9f0">ROOT</div>
    <div style="margin-top:20px;font-size:28px;letter-spacing:10px;color:#5f88a8">PLACEHOLDER</div>
  </div></div></body></html>`;

// ── hacker.mp4 ───────────────────────────────────────────────────────────────
// A dark room: a monitor (where /stream overlays the chat; see STREAM_DEFAULTS) and a hooded figure from behind.
const SCENE_HTML = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1920" height="1080"></canvas>
<script>
const c = document.getElementById('c'), g = c.getContext('2d');
window.draw = (t) => {
  g.fillStyle = '#020306'; g.fillRect(0, 0, 1920, 1080);
  // monitor glow on the wall
  const flick = 0.9 + 0.1 * Math.sin(t * 2 * Math.PI * 3) * Math.sin(t * 2 * Math.PI * 0.5);
  let rg = g.createRadialGradient(1110, 440, 50, 1110, 440, 900);
  rg.addColorStop(0, 'rgba(70,140,230,' + (0.28 * flick) + ')'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 1920, 1080);
  // desk
  g.fillStyle = '#05080d'; g.fillRect(0, 760, 1920, 320);
  g.fillStyle = 'rgba(90,160,240,0.10)'; g.fillRect(0, 760, 1920, 3);
  // monitor (screen area matches STREAM_DEFAULTS: x760 y236 w700 h404, rotate -1.5deg)
  g.save(); g.translate(1110, 438); g.rotate(-1.5 * Math.PI / 180);
  g.fillStyle = '#0a0d12'; g.fillRect(-372, -224, 744, 448);
  g.fillStyle = 'rgba(40,90,160,' + (0.55 * flick) + ')'; g.fillRect(-350, -202, 700, 404);
  for (let y = -202; y < 202; y += 4) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(-350, y, 700, 1); }
  g.fillStyle = '#0a0d12'; g.fillRect(-40, 224, 80, 90); g.fillRect(-140, 310, 280, 18);
  g.restore();
  // keyboard glow
  g.fillStyle = 'rgba(80,150,230,0.12)'; g.fillRect(860, 800, 520, 50);
  // hooded figure (from behind, lower-left foreground), slight typing motion
  const bob = Math.sin(t * 2 * Math.PI * 2) * 3;
  g.save(); g.translate(560, 1080 + bob);
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(-420, 0); g.bezierCurveTo(-400, -260, -260, -380, -120, -420); // shoulder L
  g.bezierCurveTo(-150, -560, -80, -720, 30, -740);   // hood back
  g.bezierCurveTo(150, -745, 230, -640, 220, -500);   // hood top/front
  g.bezierCurveTo(215, -430, 200, -400, 180, -380);
  g.bezierCurveTo(330, -340, 420, -220, 460, 0);      // shoulder R
  g.closePath(); g.fill();
  // rim light from the monitor
  g.strokeStyle = 'rgba(120,190,255,' + (0.35 * flick) + ')'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(30, -740); g.bezierCurveTo(150, -745, 230, -640, 220, -500); g.stroke();
  g.beginPath(); g.moveTo(180, -380); g.bezierCurveTo(330, -340, 420, -220, 460, 0); g.stroke();
  // arm toward the keyboard
  g.fillStyle = '#000'; g.beginPath(); g.moveTo(300, -260); g.quadraticCurveTo(520, -330 + bob, 640, -280 + bob); g.lineTo(650, -230 + bob); g.quadraticCurveTo(500, -230, 380, -120); g.closePath(); g.fill();
  g.restore();
  // grain
  for (let i = 0; i < 1400; i++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.035) + ')'; g.fillRect(Math.random() * 1920, Math.random() * 1080, 2, 2); }
  g.fillStyle = 'rgba(120,170,220,0.35)'; g.font = '22px monospace'; g.fillText('PLACEHOLDER — replace public/stream/hacker.mp4', 40, 1050);
};
</script></body></html>`;

async function withBrowser<T>(fn: (b: import("playwright-core").Browser) => Promise<T>) {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  try {
    return await fn(b);
  } finally {
    await b.close();
  }
}

async function makePng() {
  await withBrowser(async (b) => {
    const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
    await p.setContent(LOGO_HTML);
    await p.screenshot({ path: pub("root.png") });
  });
  console.log("wrote public/root.png");
}

async function makeMp4() {
  const fps = 24;
  const seconds = 6;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "root-frames-"));
  await withBrowser(async (b) => {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.setContent(SCENE_HTML);
    for (let i = 0; i < fps * seconds; i++) {
      await p.evaluate((t) => (window as unknown as { draw: (t: number) => void }).draw(t), i / (fps * seconds));
      await p.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
    }
  });
  fs.mkdirSync(pub("stream"), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(dir, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-preset", "slow", "-movflags", "+faststart", pub("stream/hacker.mp4")]);
  // VP9 copy for browsers without an H.264 decoder (open-source Chromium); OBS/Chrome use the mp4
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(dir, "f%04d.png"), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "45", "-pix_fmt", "yuv420p", pub("stream/hacker.webm")]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`wrote public/stream/hacker.mp4 (${(fs.statSync(pub("stream/hacker.mp4")).size / 1e6).toFixed(2)} MB)`);
}

if (need("models/brain.glb")) await makeGlb();
if (need("root.png")) await makePng();
if (need("stream/hacker.mp4")) await makeMp4();
console.log("placeholders done");
