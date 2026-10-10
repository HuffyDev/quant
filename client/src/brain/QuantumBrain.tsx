import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BRAIN_IMAGE_URL, buildBrain, type BrainCloud } from "./cloud";
import { onPulse } from "../store";

/**
 * Quantum brain. Sampled from root.png (or a real brain.glb): luminous points sized by the image's brightness, the
 * image itself as a faint backplate, neural filaments with travelling signals, dust, bloom. Powers on node by node,
 * tilts toward the cursor, lights regions as capabilities unlock, pulses on live events, flashes red on a Guardian
 * rejection. Quality adapts to the device; the caller swaps in a static image if even the lowest tier can't hold up.
 */

export type Tier = "high" | "mid" | "low";
export const TIERS: Record<Tier, { points: number; lines: number; bloom: number; dpr: number }> = {
  high: { points: 42000, lines: 2200, bloom: 1, dpr: 1.75 },
  mid: { points: 24000, lines: 1400, bloom: 0.75, dpr: 1.4 },
  low: { points: 14000, lines: 800, bloom: 0, dpr: 1.25 },
};
export const ORDER: Tier[] = ["high", "mid", "low"];

export interface LabelAnchor {
  update: (i: number, x: number, y: number, front: number) => void;
}

const REGION_UNIFORMS = /* glsl */ `
  uniform float uActive[6]; uniform float uPulse[6];
  float regionVal(float r, float arr[6]) {
    float v = 0.0;
    for (int i = 0; i < 6; i++) if (abs(float(i) - r) < 0.5) v = arr[i];
    return v;
  }
`;

const pointsVert = /* glsl */ `
  attribute float aRegion; attribute float aSeed; attribute float aBright;
  uniform float uTime; uniform float uLevel; uniform float uSize; uniform float uDpr; uniform float uAll; uniform float uDensity; uniform float uBoot; uniform float uGain;
  ${REGION_UNIFORMS}
  varying float vAlpha; varying float vAct; varying float vPulse; varying float vBright;
  void main() {
    float act = regionVal(aRegion, uActive);
    float pulse = max(regionVal(aRegion, uPulse), uAll);
    vec3 p = position;
    // power-on: nodes ignite outward from the centre, slightly out of order
    float d = length(p.xy) * 0.75 + aSeed * 0.3;
    float on = smoothstep(d, d + 0.12, uBoot * 1.25);
    vec3 n = normalize(p + vec3(0.0001));
    p += n * (sin(uTime * 0.8 + aSeed * 50.0) * 0.003 + pulse * 0.03 * (0.5 + 0.5 * sin(aSeed * 31.0)) + (1.0 - on) * 0.25);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float visible = step(aSeed, 0.2 + 0.8 * uLevel) * on;
    float node = smoothstep(0.55, 0.95, aBright);
    gl_PointSize = visible * uDpr * uSize * (0.7 + 0.9 * aBright + 1.6 * node + 0.25 * act + 1.6 * pulse) / -mv.z;
    float tw = 0.8 + 0.2 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 80.0);
    vAlpha = uGain * visible * tw * uDensity * (0.08 + 0.62 * aBright * aBright + 0.3 * node) * mix(0.7, 1.0, act) * (1.0 + pulse) * (0.6 + 0.4 * uLevel);
    vAct = act; vPulse = pulse; vBright = aBright;
  }
`;
const pointsFrag = /* glsl */ `
  uniform float uAlarm;
  varying float vAlpha; varying float vAct; varying float vPulse; varying float vBright;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 cold = vec3(0.55, 0.70, 0.92);
    vec3 glow = vec3(0.81, 0.90, 1.0);
    vec3 col = mix(cold, glow, clamp(vBright * 1.2 + vAct * 0.2, 0.0, 1.0)) + vPulse * 0.35;
    col = mix(col, vec3(1.0, 0.22, 0.22), uAlarm);
    gl_FragColor = vec4(col, soft * soft * vAlpha);
  }
`;

const linesVert = /* glsl */ `
  attribute float aRegion; attribute float aSeed; attribute float aT;
  uniform float uLevel; uniform float uAll; uniform float uBoot;
  ${REGION_UNIFORMS}
  varying float vT; varying float vSeed; varying float vAct; varying float vPulse; varying float vVis;
  void main() {
    vT = aT; vSeed = aSeed;
    vAct = regionVal(aRegion, uActive);
    vPulse = max(regionVal(aRegion, uPulse), uAll);
    float d = length(position.xy) * 0.75 + aSeed * 0.3;
    vVis = step(aSeed, 0.1 + 0.9 * uLevel) * smoothstep(d + 0.1, d + 0.3, uBoot * 1.25);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const linesFrag = /* glsl */ `
  uniform float uTime; uniform float uAlarm;
  varying float vT; varying float vSeed; varying float vAct; varying float vPulse; varying float vVis;
  void main() {
    float head = fract(uTime * (0.2 + vSeed * 0.45) + vSeed * 7.0);
    float signal = smoothstep(0.16, 0.0, abs(vT - head));
    float a = vVis * ((0.015 + 0.03 * vAct) + signal * (0.06 + 0.3 * vAct) + vPulse * 0.3);
    vec3 col = mix(vec3(0.5, 0.66, 0.9), vec3(0.85, 0.93, 1.0), vAct * signal + vPulse);
    col = mix(col, vec3(1.0, 0.22, 0.22), uAlarm);
    gl_FragColor = vec4(col, a);
  }
`;

const shellVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const shellFrag = /* glsl */ `
  uniform float uLevel; uniform float uAlarm; uniform float uBoot;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 3.2);
    vec3 col = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.22, 0.22), uAlarm);
    gl_FragColor = vec4(col, f * (0.04 + 0.09 * uLevel) * uBoot);
  }
`;

// root.png as a glowing backplate behind the points (image cloud only): gives the exact translucent look
const plateVert = /* glsl */ `
  varying vec2 vUv; varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFacing = abs(normalize(normalMatrix * vec3(0.0, 0.0, 1.0)).z);
    gl_Position = projectionMatrix * mv;
  }
`;
const plateFrag = /* glsl */ `
  uniform sampler2D uMap; uniform float uBoot; uniform float uLevel; uniform float uAlarm; uniform float uAll; uniform float uGain;
  varying vec2 vUv; varying float vFacing;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb;
    float l = dot(c, vec3(0.3, 0.55, 0.15));
    // ignite from the centre with the nodes
    float d = length(vUv - 0.5) * 2.6;
    float on = smoothstep(d, d + 0.35, uBoot * 1.25);
    vec3 col = mix(c, vec3(l) * vec3(1.0, 0.25, 0.25) * 1.6, uAlarm);
    gl_FragColor = vec4(col, 1.0) * uGain * (0.3 + 0.18 * uLevel + 0.25 * uAll) * on * pow(vFacing, 2.0);
  }
`;

const dustVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime; uniform float uDpr; uniform float uSize; uniform float uBoot;
  varying float vA;
  void main() {
    vec3 p = position;
    p.y += mod(uTime * 0.03 * (0.4 + aSeed) + aSeed * 3.0, 3.2) - 1.6;
    p.x += sin(uTime * 0.2 + aSeed * 20.0) * 0.06;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uDpr * uSize * 0.6 / -mv.z;
    vA = uBoot * 0.22 * (0.5 + 0.5 * sin(uTime + aSeed * 40.0)) * smoothstep(1.6, 0.8, abs(p.y));
  }
`;
const dustFrag = /* glsl */ `
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(0.81, 0.9, 1.0, smoothstep(0.5, 0.0, r) * vA);
  }
`;

function dustGeometry(n: number) {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = 1.15 + Math.random() * 0.9;
    const a = Math.random() * Math.PI * 2;
    pos.set([Math.cos(a) * r, Math.random() * 3.2 - 1.6, Math.sin(a) * r * 0.6 - 0.4], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return g;
}

/** Normalised pointer position (−1…1), shared by every brain on the page. */
const pointer = { x: 0, y: 0 };
let pointerBound = false;
function bindPointer() {
  if (pointerBound || typeof window === "undefined") return;
  pointerBound = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true },
  );
}

export function BrainScene({
  cloud,
  level,
  active,
  tier,
  onFps,
  labels,
  spin,
  tilt = [0, 0, 0],
  interactive = false,
  bootAt,
  children,
}: {
  cloud: BrainCloud;
  level: number;
  active: number[];
  tier: Tier;
  onFps: (fps: number) => void;
  labels?: LabelAnchor;
  /** rad/s around Y for a real model; a gentle sway for the front-facing image cloud */
  spin: number;
  tilt?: [number, number, number];
  /** tilt toward the cursor */
  interactive?: boolean;
  /** performance.now() when power-on starts (default: on mount) */
  bootAt?: number;
  /** rendered inside the brain's group (brain-local coordinates) */
  children?: React.ReactNode;
}) {
  const { gl, scene, camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const cfg = TIERS[tier];
  const mountedAt = useMemo(() => performance.now(), []);
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const shared = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: level },
      uActive: { value: [0, 0, 0, 0, 0, 0] },
      uPulse: { value: [0, 0, 0, 0, 0, 0] },
      uAll: { value: 0 },
      uAlarm: { value: 0 },
      uDpr: { value: 1 },
      uSize: { value: 1 },
      uDensity: { value: 1 },
      uBoot: { value: reduced ? 1 : 0 },
      // without bloom (low tier) the cloud needs more light of its own
      uGain: { value: 1 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // Materials are built here (not via JSX `uniforms` props) so they hold these exact uniform objects:
  // updating `shared.x.value` each frame must reach the GPU.
  const mats = useMemo(() => {
    const tex = new THREE.TextureLoader().load(BRAIN_IMAGE_URL);
    tex.colorSpace = THREE.NoColorSpace;
    const make = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform> = shared) =>
      new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return {
      plate: make(plateVert, plateFrag, { ...shared, uMap: { value: tex } }),
      shell: make(shellVert, shellFrag),
      lines: make(linesVert, linesFrag),
      points: make(pointsVert, pointsFrag),
      dust: make(dustVert, dustFrag),
      tex,
    };
  }, [shared]);
  useEffect(
    () => () => {
      for (const m of [mats.plate, mats.shell, mats.lines, mats.points, mats.dust]) m.dispose();
      mats.tex.dispose();
    },
    [mats],
  );

  const pointsGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("aRegion", new THREE.BufferAttribute(cloud.region, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(cloud.seed, 1));
    g.setAttribute("aBright", new THREE.BufferAttribute(cloud.bright, 1));
    return g;
  }, [cloud]);
  const linesGeo = useMemo(() => {
    const l = cloud.lines;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(l.positions.subarray(0, l.count * 6), 3));
    g.setAttribute("aRegion", new THREE.BufferAttribute(l.region.subarray(0, l.count * 2), 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(l.seed.subarray(0, l.count * 2), 1));
    g.setAttribute("aT", new THREE.BufferAttribute(l.t.subarray(0, l.count * 2), 1));
    return g;
  }, [cloud]);
  const dustGeo = useMemo(() => dustGeometry(tier === "low" ? 140 : 360), [tier]);

  useEffect(() => {
    // additive blending: more points must each be dimmer, or dense tiers wash out to white
    shared.uDensity.value = Math.min(1, Math.sqrt(TIERS.low.points / cfg.points));
    shared.uGain.value = cfg.bloom ? 1 : 1.6;
    pointsGeo.setDrawRange(0, Math.min(cloud.count, cfg.points));
    linesGeo.setDrawRange(0, Math.min(cloud.lines.count, cfg.lines) * 2);
  }, [cfg, cloud, pointsGeo, linesGeo, shared]);

  const composer = useMemo(() => {
    if (!cfg.bloom) return null;
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), cfg.bloom === 1 ? 0.62 : 0.55, 0.5, 0.45));
    c.addPass(new OutputPass());
    return c;
  }, [cfg.bloom, gl, scene, camera]);
  useEffect(() => {
    if (!composer) return;
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    return () => composer.dispose();
  }, [composer, size, gl, cfg.bloom]);

  useEffect(() => {
    shared.uLevel.value = level;
  }, [level, shared]);

  useEffect(
    () =>
      onPulse((p) => {
        if ("alarm" in p) shared.uAlarm.value = 1;
        else if ("all" in p) shared.uAll.value = Math.max(shared.uAll.value, p.strength);
        else shared.uPulse.value[p.region] = 1;
      }),
    [shared],
  );
  useEffect(() => {
    if (interactive) bindPointer();
  }, [interactive]);

  const fps = useRef({ n: 0, t0: 0, warm: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const frame = useRef(0);
  const image = cloud.source === "image";

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    shared.uTime.value = t;
    shared.uDpr.value = gl.getPixelRatio();
    shared.uSize.value = Math.min(size.width, size.height) * 0.0062;
    const start = bootAt ?? mountedAt;
    shared.uBoot.value = reduced ? 1 : THREE.MathUtils.clamp((performance.now() - start) / 1700, 0, 1);
    const a = shared.uActive.value;
    for (let i = 0; i < 6; i++) {
      a[i] += ((active[i] ?? 0) - a[i]) * Math.min(1, dt * 1.5);
      shared.uPulse.value[i] *= Math.exp(-dt * 1.8);
    }
    shared.uAll.value *= Math.exp(-dt * 1.4);
    shared.uAlarm.value *= Math.exp(-dt * 1.6);
    const g = group.current;
    if (g) {
      // image cloud stays front-facing (gentle sway); a real model can spin
      const sway = image ? Math.sin(t * 0.25) * Math.min(spin * 2, 0.22) : 0;
      if (!image) g.rotation.y += dt * spin;
      const tx = tilt[0] + (interactive && !reduced ? pointer.y * 0.09 : 0);
      const ty = (image ? tilt[1] + sway : g.rotation.y) + (interactive && !reduced && image ? pointer.x * 0.16 : 0);
      g.rotation.x += (tx - g.rotation.x) * Math.min(1, dt * 3);
      if (image) g.rotation.y += (ty - g.rotation.y) * Math.min(1, dt * 3);
    }

    if (labels && g && ++frame.current % 3 === 0) {
      for (let i = 0; i < cloud.centroids.length; i++) {
        tmp.copy(cloud.centroids[i]).applyMatrix4(g.matrixWorld);
        const front = tmp.z;
        tmp.project(camera);
        labels.update(i, (tmp.x * 0.5 + 0.5) * size.width, (-tmp.y * 0.5 + 0.5) * size.height, front);
      }
    }

    // FPS watchdog: 2s windows after a 2.5s warm-up (covers power-on)
    const f = fps.current;
    const now = performance.now();
    if (!f.warm) f.warm = now + 2500;
    if (now >= f.warm) {
      if (!f.t0) f.t0 = now;
      f.n++;
      if (now - f.t0 > 2000) {
        onFps((f.n * 1000) / (now - f.t0));
        f.n = 0;
        f.t0 = now;
      }
    }
    if (composer) composer.render(dt);
    else gl.render(scene, camera);
  }, 1);

  const plate = cloud.plate;
  return (
    <group ref={group} rotation={tilt}>
      {plate && (
        <mesh position={[plate.cx, plate.cy, -0.02]} renderOrder={-1} material={mats.plate}>
          <planeGeometry args={[plate.w, plate.h]} />
        </mesh>
      )}
      {cloud.shell && <mesh geometry={cloud.shell} renderOrder={0} material={mats.shell} />}
      <lineSegments geometry={linesGeo} frustumCulled={false} material={mats.lines} />
      <points geometry={pointsGeo} frustumCulled={false} material={mats.points} />
      <points geometry={dustGeo} frustumCulled={false} material={mats.dust} />
      {children}
    </group>
  );
}

/** Starting quality. `?quality=high|mid|low|static` overrides detection (e.g. to pin it on the OBS machine). */
export function initialTier(): Tier | null {
  try {
    const forced = new URLSearchParams(location.search).get("quality");
    if (forced === "static") return null;
    if (forced === "high" || forced === "mid" || forced === "low") return forced;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const c = document.createElement("canvas");
    if (!(c.getContext("webgl2") || c.getContext("webgl"))) return null;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const mem = nav.deviceMemory ?? 4;
    if (cores <= 2 || mem <= 1) return null;
    const mobile = matchMedia("(max-width: 768px), (pointer: coarse)").matches;
    if (mobile || cores <= 4 || mem <= 2) return "low";
    return cores >= 8 ? "high" : "mid";
  } catch {
    return null;
  }
}

/** Adaptive quality: drops a tier after sustained <50fps; calls onGiveUp below ~28fps on the lowest tier. */
export function useAdaptiveTier(startTier: Tier, maxTier: Tier, onGiveUp: () => void) {
  const pinned = new URLSearchParams(location.search).has("quality");
  const capped = ORDER[Math.max(ORDER.indexOf(startTier), ORDER.indexOf(maxTier))];
  const [tier, setTier] = useState<Tier>(capped);
  const slow = useRef(0);
  const onFps = (fps: number) => {
    if (pinned) return; // operator pinned the quality: never downgrade
    if (fps >= 50) {
      slow.current = 0;
      return;
    }
    if (++slow.current < 2 && fps >= 30) return; // one slow window can be a hiccup
    slow.current = 0;
    const i = ORDER.indexOf(tier);
    if (i < ORDER.length - 1) {
      console.info(`[brain] ${fps.toFixed(0)} fps — quality ${tier} → ${ORDER[i + 1]}`);
      setTier(ORDER[i + 1]);
    } else if (fps < 28) {
      console.info(`[brain] ${fps.toFixed(0)} fps on the lowest quality — static fallback`);
      onGiveUp();
    }
  };
  return { tier, capped, onFps };
}

/** Pause rendering while the element is off-screen or the tab is hidden. */
export function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let onScreen = true;
    const sync = () => setVisible(onScreen && document.visibilityState !== "hidden");
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        sync();
      },
      { rootMargin: "100px" },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ref]);
  return visible;
}

/**
 * The canvas. `onGiveUp` fires if the lowest tier can't hold ~30fps (caller shows the static fallback).
 * Rendering pauses while the canvas is off-screen.
 */
export default function QuantumBrain({
  level,
  active,
  startTier,
  onGiveUp,
  labels,
  spin = 0.12,
  maxTier = "high",
  distance = 3.2,
  interactive = false,
  bootAt,
  onReady,
}: {
  level: number;
  active: number[];
  startTier: Tier;
  onGiveUp: () => void;
  labels?: LabelAnchor;
  spin?: number;
  maxTier?: Tier;
  /** camera distance: smaller = bigger brain */
  distance?: number;
  interactive?: boolean;
  bootAt?: number;
  onReady?: () => void;
}) {
  const { tier, capped, onFps } = useAdaptiveTier(startTier, maxTier, onGiveUp);
  const [cloud, setCloud] = useState<BrainCloud | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(wrap);

  useEffect(() => {
    let alive = true;
    // build once at the starting tier's size; lower tiers draw a prefix
    buildBrain(TIERS[capped].points, TIERS[capped].lines)
      .then((c) => {
        if (!alive) return;
        setCloud(c);
        onReady?.();
      })
      .catch(onGiveUp);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capped, onGiveUp]);

  return (
    <div ref={wrap} className="absolute inset-0" data-brain-tier={tier} data-brain-source={cloud?.source ?? "loading"}>
      {cloud && (
        <Canvas
          frameloop={visible ? "always" : "never"}
          flat
          dpr={[1, TIERS[tier].dpr]}
          camera={{ position: [0, 0, distance], fov: 40, near: 0.1, far: 20 }}
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 1)}
          style={{ position: "absolute", inset: 0 }}
        >
          <BrainScene cloud={cloud} level={level} active={active} tier={tier} onFps={onFps} labels={labels} spin={spin} interactive={interactive} bootAt={bootAt} />
        </Canvas>
      )}
    </div>
  );
}
