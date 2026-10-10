import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { proceduralBrain, rng } from "./geometry";
import { regionOf, regionOfFront } from "./regions";

export const BRAIN_MODEL_URL = "/models/brain.glb";
declare const __HAS_BRAIN_MODEL__: boolean;
export const BRAIN_IMAGE_URL = "/root.png";

export interface BrainCloud {
  /** xyz, normalised (centred, max half-extent 1, +Z front) */
  positions: Float32Array;
  region: Float32Array;
  seed: Float32Array;
  /** 0–1 brightness per point (image luminance; constant for meshes) */
  bright: Float32Array;
  /** 1 = interior point (not on the surface) */
  inner: Uint8Array;
  count: number;
  /** neural filaments: 2 vertices per segment */
  lines: { positions: Float32Array; region: Float32Array; seed: Float32Array; t: Float32Array; count: number };
  /** translucent outer surface (GLB only) */
  shell: THREE.BufferGeometry | null;
  /** image cloud only: where root.png itself sits, as a glowing backplate (normalised coords) */
  plate: { cx: number; cy: number; w: number; h: number } | null;
  /** region centroids, for labels */
  centroids: THREE.Vector3[];
  /** model = real GLB (full rotation); image = sampled from root.png (front-facing, ±55°); procedural = last resort */
  source: "model" | "image" | "procedural";
}

/** Load /models/brain.glb (meshopt supported, not Draco). Rejects if missing or unparsable. */
async function loadModelGeometry(url: string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", mesh.geometry.attributes.position.clone());
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
    g.applyMatrix4(mesh.matrixWorld);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (!parts.length) throw new Error("brain.glb has no meshes");
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("could not merge brain.glb meshes");
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  const c = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const s = 1 / Math.max(half.x, half.y, half.z, 1e-6);
  merged.translate(-c.x, -c.y, -c.z);
  merged.scale(s, s, s);
  return merged;
}

function sampleModel(geo: THREE.BufferGeometry, count: number, seed: number) {
  const rand = rng(seed);
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geo));
  // present at runtime, missing from @types/three
  (sampler as unknown as { setRandomGenerator(f: () => number): void }).setRandomGenerator(rand);
  sampler.build();
  const positions = new Float32Array(count * 3);
  const inner = new Uint8Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(v);
    if (rand() < 0.1) {
      v.multiplyScalar(0.2 + rand() * 0.45);
      inner[i] = 1;
    }
    positions.set([v.x, v.y, v.z], i * 3);
  }
  return { positions, inner, bright: new Float32Array(count).fill(0.55) };
}

/**
 * Sample root.png's bright pixels into a 2.5D cloud: luminance → point density and brightness, a gentle front
 * bulge inside the brain's silhouette plus depth noise so it has volume within ±55°.
 */
async function sampleImage(url: string, count: number, seed: number) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const N = 420;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N).data;
  const lum = new Float32Array(N * N);
  let minX = N, maxX = 0, minY = N, maxY = 0;
  for (let i = 0; i < N * N; i++) {
    const l = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.55 + data[i * 4 + 2] * 0.15) / 255;
    lum[i] = l;
    if (l > 0.12) {
      const x = i % N, y = (i / N) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX) throw new Error("root.png has no bright content");
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) / 2;
  // importance sampling ∝ luminance^0.7: follows the folds without piling everything onto the bright midline
  const cdf = new Float64Array(N * N);
  let acc = 0;
  for (let i = 0; i < N * N; i++) {
    const l = lum[i] > 0.08 ? Math.pow(lum[i], 0.7) : 0;
    acc += l;
    cdf[i] = acc;
  }
  const rand = rng(seed);
  const positions = new Float32Array(count * 3);
  const bright = new Float32Array(count);
  const inner = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    const r = rand() * acc;
    let lo = 0, hi = N * N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const px = (lo % N) + rand(), py = ((lo / N) | 0) + rand();
    const x = (px - cx) / half;
    const y = -(py - cy) / half;
    const rr = Math.min(1, x * x * 0.8 + y * y);
    const z = Math.sqrt(1 - rr) * 0.42 + (rand() - 0.5) * 0.12 * (1 - lum[lo]);
    positions.set([x, y, z], k * 3);
    bright[k] = lum[lo];
  }
  // the image square, in the same normalised coordinates (backplate)
  const plate = { cx: (N / 2 - cx) / half, cy: -(N / 2 - cy) / half, w: N / half, h: N / half };
  return { positions, inner, bright, plate };
}

function buildLines(pos: Float32Array, region: Float32Array, n: number, maxSeg: number, seed: number) {
  const rand = rng(seed + 1);
  const cell = 0.12;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  const out = { positions: new Float32Array(maxSeg * 6), region: new Float32Array(maxSeg * 2), seed: new Float32Array(maxSeg * 2), t: new Float32Array(maxSeg * 2), count: 0 };
  for (let tries = 0; tries < maxSeg * 4 && out.count < maxSeg; tries++) {
    const i = Math.floor(rand() * n);
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const bucket = grid.get(`${Math.floor(x / cell) + Math.round(rand() * 2 - 1)},${Math.floor(y / cell) + Math.round(rand() * 2 - 1)},${Math.floor(z / cell) + Math.round(rand() * 2 - 1)}`);
    if (!bucket) continue;
    const j = bucket[Math.floor(rand() * bucket.length)];
    const d = Math.hypot(pos[j * 3] - x, pos[j * 3 + 1] - y, pos[j * 3 + 2] - z);
    if (j === i || d < 0.035 || d > 0.17) continue;
    const s = out.count;
    out.positions.set([x, y, z, pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], s * 6);
    out.region[s * 2] = out.region[s * 2 + 1] = region[i];
    out.seed[s * 2] = out.seed[s * 2 + 1] = rand();
    out.t[s * 2] = 0;
    out.t[s * 2 + 1] = 1;
    out.count++;
  }
  return out;
}

/**
 * Build the brain cloud: /models/brain.glb if present, else root.png sampled into points, else procedural.
 * Points are shuffled so drawing any prefix (setDrawRange) gives an even sample — used for adaptive quality.
 */
export async function buildBrain(count: number, maxLines: number): Promise<BrainCloud> {
  let pts: { positions: Float32Array; inner: Uint8Array; bright: Float32Array };
  let shell: THREE.BufferGeometry | null = null;
  let plate: BrainCloud["plate"] = null;
  let source: BrainCloud["source"];
  try {
    if (!__HAS_BRAIN_MODEL__) throw new Error("no brain.glb in this build");
    const geo = await loadModelGeometry(BRAIN_MODEL_URL);
    pts = sampleModel(geo, count, 11);
    const indexed = mergeVertices(geo);
    indexed.computeVertexNormals();
    shell = indexed;
    source = "model";
  } catch {
    try {
      const s = await sampleImage(BRAIN_IMAGE_URL, count, 11);
      pts = s;
      plate = s.plate;
      source = "image";
    } catch (e) {
      console.info("[brain] no brain.glb and root.png unusable, using procedural brain:", (e as Error).message);
      const p = proceduralBrain(count, 7);
      pts = { ...p, bright: new Float32Array(count).fill(0.55) };
      source = "procedural";
    }
  }

  // shuffle (keeps prefixes even)
  const rand = rng(3);
  const P = pts.positions, I = pts.inner, Br = pts.bright;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (let k = 0; k < 3; k++) [P[i * 3 + k], P[j * 3 + k]] = [P[j * 3 + k], P[i * 3 + k]];
    [I[i], I[j]] = [I[j], I[i]];
    [Br[i], Br[j]] = [Br[j], Br[i]];
  }

  const front = source === "image";
  const region = new Float32Array(count);
  const seed = new Float32Array(count);
  const sums = Array.from({ length: 6 }, () => ({ v: new THREE.Vector3(), n: 0 }));
  for (let i = 0; i < count; i++) {
    const r = front ? regionOfFront(P[i * 3], P[i * 3 + 1]) : regionOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], I[i] === 1);
    region[i] = r;
    seed[i] = rand();
    if (!I[i]) {
      sums[r].v.add(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
      sums[r].n++;
    }
  }
  const centroids = sums.map((s) => (s.n ? s.v.divideScalar(s.n) : new THREE.Vector3()));
  if (!front) centroids[2] = new THREE.Vector3(0, -0.05, 0.05); // memory sits in the core

  return { positions: P, region, seed, bright: Br, inner: I, count, lines: buildLines(P, region, Math.min(count, 9000), maxLines, 5), shell, plate, centroids, source };
}
