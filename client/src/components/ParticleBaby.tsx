import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Particle baby: /baby.png sampled into a point cloud.
 *  - brainLevel (0–1) → visible particle count (~1.4k at birth → all at T+60), brightness, breathing
 *  - each capability unlock → growth burst: newly visible particles stream in from the edges
 *  - neural cluster in the head: 5 regions light up per unlocked capability group
 */

import { REGIONS } from "./regions";
export { REGIONS };

const ASPECT = 1355 / 1161;

interface Cloud {
  positions: Float32Array; // u, v, z (u,v in 0..1)
  bright: Float32Array;
  seed: Float32Array;
  index: Float32Array;
  count: number;
}

async function sampleImage(url: string, maxPoints: number): Promise<Cloud> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = 452; // sample on a downscaled copy (1/3)
  const H = Math.round(W / ASPECT);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const pts: [number, number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = (data[i] * 0.3 + data[i + 1] * 0.55 + data[i + 2] * 0.15) / 255;
      if (l > 0.18 && Math.random() < l * 1.6) pts.push([(x + Math.random()) / W, (y + Math.random()) / H, l]);
    }
  // shuffle so any prefix is an even sample of the whole body
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  const n = Math.min(maxPoints, pts.length);
  const positions = new Float32Array(n * 3);
  const bright = new Float32Array(n);
  const seed = new Float32Array(n);
  const index = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pts[i][0];
    positions[i * 3 + 1] = pts[i][1];
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.08; // slight z-depth noise
    bright[i] = pts[i][2];
    seed[i] = Math.random();
    index[i] = i;
  }
  return { positions, bright, seed, index, count: n };
}

const bodyVert = /* glsl */ `
  attribute float aBright; attribute float aSeed; attribute float aIndex;
  uniform vec2 uSize; uniform float uTime; uniform float uDpr; uniform float uLevel;
  uniform float uCount; uniform float uPrevCount; uniform float uBurstStart;
  varying float vAlpha; varying float vBright;
  void main() {
    vec3 p = position;
    float visible = step(aIndex, uCount - 1.0);
    // breathing: gentle swell around the torso + tiny per-particle drift
    float breath = sin(uTime * 1.25) * 0.004 * (0.4 + uLevel);
    vec2 c = vec2(0.55, 0.55);
    p.xy = c + (p.xy - c) * (1.0 + breath);
    p.x += sin(uTime * 0.7 + aSeed * 40.0) * 0.0009;
    p.y += cos(uTime * 0.6 + aSeed * 30.0) * 0.0009;
    // growth burst: newly visible particles stream in from the edges and settle
    float isNew = step(uPrevCount, aIndex) * visible;
    float t = clamp((uTime - uBurstStart - aSeed * 0.9) / 1.6, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - t, 3.0);
    vec2 dir = normalize(p.xy - vec2(0.5) + vec2(0.0001));
    vec2 edge = vec2(0.5) + dir * (0.9 + aSeed * 0.4);
    p.xy = mix(p.xy, mix(edge, p.xy, e), isNew);
    vec2 xy = (p.xy - 0.5) * vec2(1.0, -1.0) * uSize;
    xy.x += p.z * sin(uTime * 0.25) * uSize.x * 0.6; // parallax sway from z-depth
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, p.z * 100.0, 1.0);
    float scale = uSize.x / 720.0;
    gl_PointSize = visible * uDpr * scale * (1.1 + aBright * 1.9 + (1.0 - uLevel) * 0.8) * (1.0 + isNew * (1.0 - e) * 1.5);
    float twinkle = 0.85 + 0.15 * sin(uTime * 2.0 + aSeed * 60.0);
    vAlpha = visible * (0.8 + 0.2 * uLevel) * twinkle * mix(1.0, e, isNew);
    vBright = aBright;
  }
`;
const bodyFrag = /* glsl */ `
  varying float vAlpha; varying float vBright;
  void main() {
    vec2 d = gl_PointCoord - 0.5; float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 ice = vec3(0.80, 0.82, 0.86);
    vec3 col = mix(ice, vec3(1.0), vBright);
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

const neuralVert = /* glsl */ `
  attribute float aRegion; attribute float aSeed;
  uniform vec2 uSize; uniform float uTime; uniform float uDpr; uniform float uActive[5];
  varying float vA;
  void main() {
    int r = int(aRegion + 0.5);
    float act = 0.0;
    for (int i = 0; i < 5; i++) if (i == r) act = uActive[i];
    vec3 p = position;
    p.xy += vec2(sin(uTime * 1.3 + aSeed * 20.0), cos(uTime * 1.1 + aSeed * 17.0)) * 0.003 * (0.5 + act);
    vec2 xy = (p.xy - 0.5) * vec2(1.0, -1.0) * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, 50.0, 1.0);
    float pulse = 0.6 + 0.4 * sin(uTime * 3.0 + aRegion * 1.7 + aSeed * 6.0);
    gl_PointSize = uDpr * (uSize.x / 720.0) * (1.4 + act * 4.5 * pulse);
    vA = mix(0.06, 0.95 * pulse, act);
  }
`;
const neuralFrag = /* glsl */ `
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
    gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.0, r) * vA);
  }
`;

function particleCount(level: number, total: number) {
  const f = Math.max(0, Math.min(1, (level - 0.05) / 0.95));
  return Math.round(Math.min(total, 1400 + (total - 1400) * Math.pow(f, 1.3)));
}

function Scene({ cloud, level, active, burstKey, onFps }: { cloud: Cloud; level: number; active: number[]; burstKey: number; onFps: (fps: number) => void }) {
  const { size, gl } = useThree();
  const body = useRef<THREE.ShaderMaterial>(null);
  const neural = useRef<THREE.ShaderMaterial>(null);
  const prev = useRef({ count: particleCount(level, cloud.count), burstKey });
  const frames = useRef({ n: 0, t0: performance.now(), reported: false });

  const bodyGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("aBright", new THREE.BufferAttribute(cloud.bright, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(cloud.seed, 1));
    g.setAttribute("aIndex", new THREE.BufferAttribute(cloud.index, 1));
    return g;
  }, [cloud]);

  const neuralGeo = useMemo(() => {
    const per = 140;
    const pos = new Float32Array(REGIONS.length * per * 3);
    const reg = new Float32Array(REGIONS.length * per);
    const seed = new Float32Array(REGIONS.length * per);
    REGIONS.forEach((r, ri) => {
      for (let i = 0; i < per; i++) {
        const k = ri * per + i;
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 0.7) * 0.032;
        pos[k * 3] = r.u + Math.cos(a) * d;
        pos[k * 3 + 1] = r.v + Math.sin(a) * d * ASPECT;
        pos[k * 3 + 2] = 0;
        reg[k] = ri;
        seed[k] = Math.random();
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRegion", new THREE.BufferAttribute(reg, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);

  const bodyUniforms = useMemo(
    () => ({
      uSize: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDpr: { value: 1 },
      uLevel: { value: level },
      uCount: { value: prev.current.count },
      uPrevCount: { value: prev.current.count },
      uBurstStart: { value: -100 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const neuralUniforms = useMemo(() => ({ uSize: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uDpr: { value: 1 }, uActive: { value: [0, 0, 0, 0, 0] } }), []);

  // growth burst on unlock or when the count jumps
  useEffect(() => {
    const u = bodyUniforms;
    const next = particleCount(level, cloud.count);
    if (next !== prev.current.count || burstKey !== prev.current.burstKey) {
      u.uPrevCount.value = burstKey !== prev.current.burstKey ? Math.max(0, Math.min(prev.current.count, next - 400)) : prev.current.count;
      u.uCount.value = next;
      u.uBurstStart.value = u.uTime.value;
      prev.current = { count: next, burstKey };
    }
    u.uLevel.value = level;
  }, [level, burstKey, cloud.count, bodyUniforms]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const dpr = gl.getPixelRatio();
    for (const u of [bodyUniforms, neuralUniforms]) {
      u.uTime.value = t;
      u.uDpr.value = dpr;
      u.uSize.value.set(size.width, size.height);
    }
    const a = neuralUniforms.uActive.value as number[];
    for (let i = 0; i < 5; i++) a[i] += ((active[i] ?? 0) - a[i]) * 0.04; // ease regions on
    // FPS watchdog: report average after a warm-up window
    const f = frames.current;
    f.n++;
    const el = performance.now() - f.t0;
    if (!f.reported && el > 4000) {
      f.reported = true;
      onFps((f.n * 1000) / el);
    }
  });

  return (
    <>
      <points geometry={bodyGeo} frustumCulled={false}>
        <shaderMaterial ref={body} uniforms={bodyUniforms} vertexShader={bodyVert} fragmentShader={bodyFrag} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points geometry={neuralGeo} frustumCulled={false}>
        <shaderMaterial ref={neural} uniforms={neuralUniforms} vertexShader={neuralVert} fragmentShader={neuralFrag} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  );
}

export default function ParticleBaby({ level, active, burstKey, maxPoints, onLowFps }: { level: number; active: number[]; burstKey: number; maxPoints: number; onLowFps: () => void }) {
  const [cloud, setCloud] = useState<Cloud | null>(null);
  useEffect(() => {
    let alive = true;
    sampleImage("/baby.png", maxPoints)
      .then((c) => alive && setCloud(c))
      .catch(onLowFps);
    return () => {
      alive = false;
    };
  }, [maxPoints, onLowFps]);
  if (!cloud) return null;
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 500], zoom: 1, near: 0.1, far: 2000 }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <Scene cloud={cloud} level={level} active={active} burstKey={burstKey} onFps={(fps) => fps < 30 && onLowFps()} />
    </Canvas>
  );
}
