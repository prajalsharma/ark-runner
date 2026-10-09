/**
 * Greybox renderer. Pure presentation — reads RunSim state and draws it; it never
 * decides gameplay. Pooled meshes (no per-frame allocation), flat Arch palette.
 * Game feel lives here: FOV ramps with speed, camera shake on impact, Block Run
 * recolours the world and streaks past, Hyper Flow intensifies the glow.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { RunSim } from "./sim.ts";
import { RunnerRig } from "./runner-rig.ts";
import { ChaserRig } from "./chaser.ts";
import { ObstacleKit } from "./obstacles.ts";
import { CityScape } from "./cityscape.ts";
import { reducedMotion, quality, heroModel } from "./settings.ts";

/** The hero interface render.ts drives — satisfied by BOTH the procedural RunnerRig and the
 *  rigged-GLB HeroGLB, so either can be swapped in (see heroModel() in settings.ts). */
export type Hero = {
  readonly group: THREE.Group;
  update(st: { x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number }): void;
  setColor(hex: number): void;
  setColorObj(c: THREE.Color): void;
};
import { LANE_WIDTH, START_SPEED, MAX_SPEED, BLOCK_SPEED_MULT, FOV_BASE, FOV_MAX, FOV_BLOCK } from "./constants.ts";

// TRON / cyberpunk palette: near-black base, neon cyan grid, Bitcoin-orange brand, hot
// magenta hazards, violet flip/block. Bloom turns the emissive into glow (see docs/STORY_AND_DESIGN.md).
const COL = {
  bg: 0x04060e, bgBlock: 0x0a0520, ground: 0x03050c, lane: 0x071018,
  grid: 0x16e0ff,            // neon cyan grid lines (the Tron floor)
  player: 0xff7a1a, playerBlock: 0xb86bff, playerFlip: 0xffd54a,
  wall: 0xff2a5f, low: 0xffaa33, high: 0x9b6bff, pit: 0x04040a,
  energy: 0xf7931a, tick: 0x16e0ff, streak: 0x16e0ff, gate: 0x16e0ff, // energy = Bitcoin orange
};

/** Scripted camera/actor state for one cinematic frame (the opening cutscene). */
export type CineState = {
  cam: [number, number, number];
  look: [number, number, number];
  distance: number;
  runnerX: number;
  runnerPhase: number;
  runnerY?: number;      // vertical (trip dip / small hop)
  runnerPitch?: number;  // forward lean, radians — the stumble/trip pose
  shake?: number;        // camera shake 0..1 (impact of the near-catch)
  fov?: number;          // override FOV (bolt widens for speed)
  bakery?: boolean;      // show the opening bakery set (counter, ₿AKERY sign, PENDING terminal)
  drone: { x: number; y: number; z: number; eye: number } | null;
  donut: { x: number; y: number; z: number; scale: number } | null;
};

/** A Bitcoin coin face: orange disc with a white ₿. Baked once, used on the coin caps. */
function makeBitcoinTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  // A struck GOLD coin face: radial gold gradient (bright center → deep rim), a milled
  // rim ring, and the Bitcoin ₿ embossed in brand orange with a light bevel highlight.
  const g = ctx.createRadialGradient(108, 100, 20, 128, 128, 128);
  g.addColorStop(0, "#fff1c0"); g.addColorStop(0.45, "#f6c445"); g.addColorStop(0.8, "#d79a1e"); g.addColorStop(1, "#9c6b12");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 10; ctx.strokeStyle = "#b9831a"; ctx.beginPath(); ctx.arc(128, 128, 116, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = "#ffe9a0"; ctx.beginPath(); ctx.arc(128, 128, 110, 0, Math.PI * 2); ctx.stroke();
  ctx.font = "bold 168px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(120,70,0,0.55)"; ctx.fillText("₿", 130, 140);   // engraved shadow
  ctx.fillStyle = "#f7931a"; ctx.fillText("₿", 128, 136);               // Bitcoin-orange ₿
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Soft radial blob for a fake contact shadow (black → transparent). */
function makeShadowTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.6)"); g.addColorStop(0.55, "rgba(0,0,0,0.32)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** The payment terminal screen: "PAYMENT / PENDING" in amber on dark — the whole joke. */
function makeTerminalTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = 256; c.height = 192;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0d12"; ctx.fillRect(0, 0, 256, 192);
  ctx.fillStyle = "#1a1f2e"; ctx.fillRect(10, 10, 236, 172);
  ctx.textAlign = "center";
  ctx.fillStyle = "#8a90a6"; ctx.font = "bold 26px Arial"; ctx.fillText("PAYMENT", 128, 66);
  ctx.fillStyle = "#ffb020"; ctx.font = "bold 46px Arial"; ctx.fillText("PENDING", 128, 124);
  ctx.fillStyle = "#ff6b5b"; ctx.font = "16px Arial"; ctx.fillText("● unsettled", 128, 160);
  return new THREE.CanvasTexture(c);
}

/** A glowing ₿AKERY shop sign for the opening. */
function makeBakerySignTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0c14"; ctx.fillRect(0, 0, 512, 128);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#f7931a"; ctx.font = "bold 76px Georgia, serif";
  ctx.fillText("₿AKERY", 256, 70);
  return new THREE.CanvasTexture(c);
}

export class Renderer {
  readonly scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private rig: Hero;
  private city: CityScape;
  private chaser: ChaserRig;
  private menace = 0;          // eased 0..1 how hard the Auditor is bearing down
  private lastNearMiss = 0;    // to detect a fresh near-miss → surge
  private stumbleT = 0;        // >0 while the runner trips & recovers from a close call
  private donut: THREE.Group;
  private bakery!: THREE.Group;
  private heroShadow!: THREE.Mesh;
  private obstacles!: ObstacleKit;
  private enPool: THREE.Mesh[] = [];
  private readonly TICKS = 40;
  private readonly STREAKS = 16;
  private tickMesh!: THREE.InstancedMesh;   // 40 floor ticks → 1 draw call
  private streakMesh!: THREE.InstancedMesh; // 16 speed streaks → 1 draw call
  private streakMat!: THREE.MeshBasicMaterial;
  private readonly dummy = new THREE.Object3D();
  private gatePool: THREE.Group[] = [];
  private flipMat!: THREE.MeshStandardMaterial;
  private parts: { m: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number }[] = [];
  private lastPlayerX = 0;
  private lastPlayerY = 0.8;
  private lastNow = 0;
  private deathT = -1; // >=0 while the death camera plays
  private perf = false; // runtime auto-downgrade when frames are slow
  private fog: THREE.Fog;
  private canvas: HTMLCanvasElement;
  private composer: EffectComposer | null = null; // post-processing (bloom); null = direct render
  private bloom: UnrealBloomPass | null = null;
  private contextLost = false;
  private key!: THREE.DirectionalLight;
  private envRT: THREE.WebGLRenderTarget | null = null;

  private camX = 0;          // eased camera x (shake is added on top)
  private shake = 0;         // decays every frame
  private blockLevel = 0;    // eased 0→1 Block Run intensity (smooth transitions)
  private flipLevel = 0;     // eased 0→1 ARCH FLIP intensity
  private readonly reduced = reducedMotion();
  private readonly lowQ = quality() === "low";
  private readonly cBg = new THREE.Color(COL.bg);
  private readonly cBgBlock = new THREE.Color(COL.bgBlock);
  private readonly cPlayer: THREE.Color;
  private readonly cPlayerBlock = new THREE.Color(COL.playerBlock);
  private readonly cPlayerFlip = new THREE.Color(COL.playerFlip);
  private readonly cTmp = new THREE.Color();
  private readonly playerColor: number;

  constructor(canvas: HTMLCanvasElement, playerColor: number = COL.player) {
    this.canvas = canvas;
    this.playerColor = playerColor;
    this.cPlayer = new THREE.Color(playerColor);
    this.scene.background = new THREE.Color(COL.bg);
    this.fog = new THREE.Fog(COL.bg, 26, 82); // longer throw → the skyline recedes into dusk
    this.scene.fog = this.fog;

    this.cam = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.1, 600); // far enough for the sky dome
    this.cam.position.set(0, 5.4, 9);

    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.setClearColor(COL.bg);
    this.gl.info.autoReset = false; // reset once per frame so stats() sums ALL composer passes
    // Cinematic colour + tone pipeline (AAA pass): sRGB out, Neutral (Khronos PBR Neutral)
    // tone mapping — rolls off bright emissive without the ACES orange→salmon desaturation,
    // so true Bitcoin orange (#F7931A) still reads as Bitcoin orange on screen.
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 1.1;

    // Shadows ground the runner and hazards (biggest "flat → real" lever). Off on low
    // quality / reduced motion to protect weak devices.
    const shadowsOn = !this.lowQ && !this.reduced;
    this.gl.shadowMap.enabled = shadowsOn;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting rig: fill (legibility) + key (form, casts shadow) + warm rim (separates
    // the runner from the dark city) + cool bounce from the ground plane.
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0a0c12, 0.55));
    this.scene.add(new THREE.AmbientLight(0x55607a, 0.35));
    this.key = new THREE.DirectionalLight(0xfff0dc, 1.45);
    this.key.position.set(6, 16, 8);
    if (shadowsOn) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(1024, 1024);
      const sc = this.key.shadow.camera;
      sc.near = 1; sc.far = 80; sc.left = -12; sc.right = 12; sc.top = 14; sc.bottom = -30;
      this.key.shadow.bias = -0.0006;
      this.key.shadow.normalBias = 0.02;
      this.key.target.position.set(0, 0, -14);
      this.scene.add(this.key.target);
    }
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0x2ad4ff, 0.7);
    rim.position.set(-7, 5, -6); // back-left, cyan — neon rim on the runner's silhouette
    this.scene.add(rim);
    const practical = new THREE.PointLight(0x19e5ff, 0.6, 40);
    practical.position.set(0, 3, 2);
    this.scene.add(practical);

    // IBL environment: without a scene.environment, every authored metalness (coins, the
    // Auditor hull, gear) reflects nothing and reads flat gray. A neutral room env gives
    // real specular reflections. Kept subtle so it doesn't wash out the dark dusk look.
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    // Corridor floor + lane dividers.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH * 3 + 1.2, 0.3, 400),
      new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.95 }),
    );
    floor.position.set(0, -0.15, -160);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Neon-cyan lane lines — the Tron grid that marks the two lane boundaries.
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
      const div = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.05, 400),
        new THREE.MeshStandardMaterial({ color: 0x06202a, emissive: COL.grid, emissiveIntensity: 1.3, roughness: 0.5 }),
      );
      div.position.set(x, 0.02, -160);
      this.scene.add(div);
    }
    const roadEdge = LANE_WIDTH * 1.5 + 0.15; // ±3.45
    // Orange "fee lane" edge strips (Bitcoin accent) framing the cyan grid.
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.06, 400),
        new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: COL.energy, emissiveIntensity: 1.0, roughness: 0.5 }),
      );
      edge.position.set(sx * roadEdge, 0.02, -160);
      this.scene.add(edge);
      // Raised sidewalk/curb + a wide pavement plane out to the building line (fills the
      // old black gap beside the road so the runner is on a street, not a floating strip).
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 400), new THREE.MeshStandardMaterial({ color: 0x15171f, roughness: 0.9 }));
      curb.position.set(sx * (roadEdge + 0.2), 0.0, -160); curb.receiveShadow = true; this.scene.add(curb);
      const pave = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 400), new THREE.MeshStandardMaterial({ color: 0x0c0e15, roughness: 1 }));
      pave.position.set(sx * (roadEdge + 2.8), -0.06, -160); pave.receiveShadow = true; this.scene.add(pave);
    }

    // Scrolling floor ticks (motion cue) — one InstancedMesh (was 40 draw calls).
    const tickGeo = new THREE.BoxGeometry(LANE_WIDTH * 3, 0.02, 0.25);
    const tickMat = new THREE.MeshBasicMaterial({ color: COL.tick });
    this.tickMesh = new THREE.InstancedMesh(tickGeo, tickMat, this.TICKS);
    this.tickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tickMesh.frustumCulled = false;
    this.scene.add(this.tickMesh);

    // Speed streaks (Block Run only) — one InstancedMesh (was 16 draw calls).
    const streakGeo = new THREE.BoxGeometry(0.05, 0.05, 6);
    this.streakMat = new THREE.MeshBasicMaterial({ color: COL.streak, transparent: true, opacity: 0.6 });
    this.streakMesh = new THREE.InstancedMesh(streakGeo, this.streakMat, this.STREAKS);
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streakMesh.frustumCulled = false;
    this.streakMesh.visible = false;
    this.scene.add(this.streakMesh);

    // ARCH FLIP markers: a glowing GATEWAY FRAME (two posts + a top bar) in the flip
    // lane — not a ring, and sized to one lane so it doesn't obscure the view.
    this.flipMat = new THREE.MeshStandardMaterial({ color: COL.gate, emissive: COL.gate, emissiveIntensity: 1.2, roughness: 0.3 });
    const postGeo = new THREE.BoxGeometry(0.16, 2.3, 0.16);
    const barGeo = new THREE.BoxGeometry(1.9, 0.16, 0.16);
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      for (const px of [-0.9, 0.9]) { const p = new THREE.Mesh(postGeo, this.flipMat); p.position.set(px, 1.15, 0); grp.add(p); }
      const bar = new THREE.Mesh(barGeo, this.flipMat); bar.position.set(0, 2.3, 0); grp.add(bar);
      grp.visible = false; this.gatePool.push(grp); this.scene.add(grp);
    }

    // Particle pool (collect sparkles / death burst). Render-only.
    const pGeo = new THREE.BoxGeometry(0.13, 0.13, 0.13);
    const pcount = this.lowQ ? 16 : 48;
    for (let i = 0; i < pcount; i++) {
      const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
      m.visible = false; this.scene.add(m);
      this.parts.push({ m, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
    }

    // The city around the corridor (depth + atmosphere). Fewer towers on low quality.
    this.city = new CityScape(this.scene, this.lowQ ? 9 : 18);

    // THE AUDITOR — the antagonist. Looms above-and-behind the runner and bears down,
    // surging on mistakes. (Also drives the opening cutscene's confrontation.)
    this.chaser = new ChaserRig();
    this.scene.add(this.chaser.group);

    // The Satoshi donut (cutscene prop) — glazed orange torus with sprinkles. Hidden in play.
    this.donut = new THREE.Group();
    const dough = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.26, 16, 28), new THREE.MeshStandardMaterial({ color: 0xc87f2a, roughness: 0.6 }));
    const glaze = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.2, 16, 28), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6, roughness: 0.3 }));
    glaze.position.z = 0.08;
    this.donut.add(dough, glaze);
    const sprinkleColors = [0x33e1ff, 0xff5bd1, 0x5bff9b, 0xffffff];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), new THREE.MeshStandardMaterial({ color: sprinkleColors[i % 4], emissive: sprinkleColors[i % 4], emissiveIntensity: 0.4 }));
      const a = (i / 10) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.18);
      sp.rotation.z = a; this.donut.add(sp);
    }
    this.donut.visible = false;
    this.scene.add(this.donut);

    // The opening BAKERY set (cutscene only): a counter, a glowing ₿AKERY sign, and the
    // payment terminal still reading PAYMENT: PENDING. Hidden during gameplay.
    this.bakery = this.buildBakery();
    this.bakery.visible = false;
    this.scene.add(this.bakery);

    // Soft contact shadow under the hero — grounds it, and tracks the lane on a jump.
    this.heroShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.heroShadow.rotation.x = -Math.PI / 2;
    this.heroShadow.position.set(0, 0.04, 0);
    this.scene.add(this.heroShadow);

    // Player hero. Default is the authored procedural jointed runner (RunnerRig). The rigged
    // GLB Path-B hero (HeroGLB) is opt-in via heroModel() and is CODE-SPLIT — its GLTFLoader +
    // decoder only load when selected, keeping the default bundle lean. HeroGLB itself falls
    // back to the procedural rig if the asset fails, so the hero is ALWAYS present.
    this.rig = new RunnerRig(this.playerColor);
    this.rig.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.scene.add(this.rig.group);
    if (heroModel() === "glb") void this.swapToGLBHero();

    // Authored hazard props (per-type silhouette + telegraph), pooled.
    this.obstacles = new ObstacleKit(this.scene);

    // Coin pool.
    // Bitcoin coins: orange disc with a ₿ face (texture on the caps), facing the camera.
    const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
    const btcTex = makeBitcoinTexture();
    // Genuine struck gold: high metalness + low roughness so the env map gives real gold
    // reflections (not flat orange). A little emissive so coins still pop in the dark/bloom.
    const coinSide = new THREE.MeshStandardMaterial({ color: 0xe7b63a, metalness: 0.95, roughness: 0.28, emissive: 0x3a2600, emissiveIntensity: 0.3 });
    const coinFace = new THREE.MeshStandardMaterial({ map: btcTex, metalness: 0.9, roughness: 0.3, emissive: 0xf7931a, emissiveMap: btcTex, emissiveIntensity: 0.35 });
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(coinGeo, [coinSide, coinFace, coinFace]);
      m.rotation.x = Math.PI / 2; // caps face the camera
      m.visible = false; this.enPool.push(m); this.scene.add(m);
    }

    this.buildComposer();

    // WebGL context-loss recovery. Two canvases (menu + game) each hold a context; on a
    // loaded machine one can be dropped mid-run → a black screen. Recover instead of dying.
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.contextLost = true; });
    this.canvas.addEventListener("webglcontextrestored", () => { this.buildComposer(); this.resize(); this.contextLost = false; });

    this.resize();
    window.addEventListener("resize", this.onWindowResize);
  }

  /** (Re)build the post chain — bloom on authored emissive only. Skipped on low/reduced.
   *  Uses a MULTISAMPLED render target: EffectComposer otherwise renders to a plain target
   *  with NO antialiasing (the renderer's `antialias:true` only covers the default canvas),
   *  which is what makes a post-processed scene look harshly jagged / "pixelated". */
  private buildComposer(): void {
    if (this.lowQ || this.reduced) { this.composer = null; this.bloom = null; return; }
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(this.scene, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.7, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    // Bloom render targets are the heaviest GPU cost — cap them at a lower ratio so two
    // live contexts (menu + game) don't exhaust memory and drop one to black.
    const pdpr = Math.min(1.5, dpr);
    if (this.composer) { this.composer.setPixelRatio(pdpr); this.composer.setSize(w, h); }
    if (this.bloom) this.bloom.setSize(w, h);
  }

  /** Render through the post chain when present, else straight to screen. */
  private renderFrame(): void {
    if (this.contextLost) return; // GPU context gone; wait for restore (no black-on-crash)
    this.gl.info.reset(); // start-of-frame reset → stats() reflects the whole frame's draws
    if (this.composer && !this.perf) this.composer.render();
    else this.gl.render(this.scene, this.cam);
  }

  /** Runtime perf downgrade (set by the loop when frames are consistently slow). */
  setPerfMode(on: boolean): void { this.perf = on; }

  /** Render diagnostics for the F3 overlay (draw calls + triangles + texture/geo counts). */
  stats(): string {
    const r = this.gl.info.render, m = this.gl.info.memory;
    return `draws ${r.calls} · tris ${(r.triangles / 1000).toFixed(1)}k · geo ${m.geometries} · tex ${m.textures}`;
  }

  /** Cinematic death camera: pulls up/back and orbits the fallen runner. */
  startDeathCam(): void { this.deathT = 0; }
  stopDeathCam(): void { this.deathT = -1; }

  /** Recolour the runner live (character selection preview). */
  setPlayerColor(hex: number): void {
    this.cPlayer.set(hex);
    this.rig.setColor(hex);
  }

  /** Opt-in: swap the procedural rig for the code-split rigged-GLB hero (Path B). The import
   *  is dynamic so GLTFLoader + the decoder stay out of the default bundle. HeroGLB shows the
   *  procedural rig until (and unless) the GLB loads, so there is never an empty hero. */
  private async swapToGLBHero(): Promise<void> {
    try {
      const { HeroGLB } = await import("./hero-glb.ts");
      const glb = new HeroGLB(this.playerColor);
      glb.setColorObj(this.cPlayer);
      this.scene.remove(this.rig.group);
      this.rig = glb;
      glb.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.scene.add(glb.group);
    } catch { /* keep the procedural rig */ }
  }

  /** The opening bakery set: back wall + glowing ₿AKERY sign, a counter with donuts on a
   *  tray, and the payment terminal reading PAYMENT: PENDING. Built once, shown in the cutscene. */
  private buildBakery(): THREE.Group {
    const g = new THREE.Group();
    // The shop sits BEHIND the runner (+z); its sign + terminal face down the street (-z)
    // toward the opening camera, which looks back at the runner's face.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x15110c, roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 0.4), wallMat);
    wall.position.set(0, 3.5, 4.8); g.add(wall);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: makeBakerySignTexture(), emissive: 0xf7931a, emissiveIntensity: 0.9, transparent: true }));
    sign.position.set(0, 5.3, 4.55); sign.rotation.y = Math.PI; g.add(sign);
    const shopGlow = new THREE.PointLight(0xffb15a, 0.9, 16); shopGlow.position.set(0, 4, 2.5); g.add(shopGlow);
    // counter to the side so it never blocks the runner
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.7 }));
    counter.position.set(-2.6, 0.55, 2.6); g.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: 0x5a4328, roughness: 0.5, metalness: 0.3 }));
    top.position.set(-2.6, 1.16, 2.6); g.add(top);
    const dMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.3, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.08, 10, 16), dMat);
      d.rotation.x = Math.PI / 2; d.position.set(-3.8 + i * 0.6, 1.3, 2.6); g.add(d);
    }
    // payment terminal kiosk + PENDING screen, to the right, screen facing the street (-z)
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1d27, roughness: 0.6, metalness: 0.4 }));
    kiosk.position.set(2.6, 1.3, 2.4); g.add(kiosk);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.62), new THREE.MeshStandardMaterial({ map: makeTerminalTexture(), emissive: 0xffffff, emissiveIntensity: 0.8, transparent: true }));
    screen.position.set(2.6, 1.78, 2.08); screen.rotation.y = Math.PI + 0.3; g.add(screen);
    return g;
  }

  /** Render one scripted cinematic frame (the opening cutscene drives this). */
  cutsceneFrame(nowMs: number, st: CineState): void {
    (this.scene.background as THREE.Color).copy(this.cBg);
    this.fog.color.copy(this.cBg); this.fog.far = 92;
    this.city.update(st.distance);
    this.rig.setColorObj(this.cPlayer);
    const ry = st.runnerY ?? 0;
    this.rig.update({ x: st.runnerX, y: ry, sliding: false, grounded: true, phase: st.runnerPhase, emissive: 0.9 });
    // Trip/stumble: pitch the whole figure forward (gait still flails underneath).
    this.rig.group.rotation.x = st.runnerPitch ?? 0;
    // no sim → hide all gameplay pools
    this.obstacles.beginFrame(); this.obstacles.finish();
    for (const m of this.enPool) m.visible = false;
    for (const g of this.gatePool) g.visible = false;
    for (const p of this.parts) p.m.visible = false;
    this.streakMesh.visible = false;
    if (st.drone) {
      this.chaser.setVisible(true);
      // Face the viewer so the scanner eye reads during the confrontation; pitch down a
      // little once it has descended to the runner's level.
      this.chaser.group.position.set(st.drone.x, st.drone.y, st.drone.z);
      // Front (eye/claws = local -z) faces the runner/camera; pitches down as it descends.
      this.chaser.group.rotation.set(0.15 + Math.max(0, (9 - st.drone.y) * 0.05), 0, 0);
      this.chaser.group.scale.setScalar(1);
      this.chaser.update(nowMs, 0.8);
      this.chaser.setEye(st.drone.eye);
    } else this.chaser.setVisible(false);
    if (st.donut) {
      this.donut.visible = true;
      this.donut.position.set(st.donut.x, st.donut.y, st.donut.z);
      this.donut.scale.setScalar(st.donut.scale);
      this.donut.rotation.set(0.35, nowMs / 700, 0);
    } else this.donut.visible = false;
    this.bakery.visible = !!st.bakery;
    this.heroShadow.visible = false; // no gameplay contact shadow during the cutscene
    this.cam.fov = st.fov ?? 52;
    const sk = st.shake ?? 0;
    const sx = sk ? (Math.random() - 0.5) * sk : 0;
    const sy = sk ? (Math.random() - 0.5) * sk * 0.6 : 0;
    this.cam.position.set(st.cam[0] + sx, st.cam[1] + sy, st.cam[2]);
    this.cam.lookAt(st.look[0], st.look[1], st.look[2]);
    this.cam.updateProjectionMatrix();
    this.renderFrame();
  }

  private onWindowResize = (): void => { if (!this.contextLost) this.resize(); };

  /** Release the WebGL context (called when a game ends, so contexts don't leak
   *  across menu↔game cycles). The canvas is single-use after this — forceContextLoss
   *  means a fresh context can never be acquired on it again, so the caller must
   *  discard the canvas and hand the next game a new one. */
  dispose(): void {
    window.removeEventListener("resize", this.onWindowResize);
    this.composer?.dispose?.();
    this.envRT?.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }

  /** Called by the orchestrator on gameplay events (impact feedback). */
  addShake(v: number): void { if (!this.reduced && !this.perf) this.shake = Math.min(1.3, this.shake + v); }

  /** Spawn a particle burst at the player (presentation only). */
  burst(kind: "collect" | "perfect" | "death" | "flip" | "jump" | "land" | "slide"): void {
    if (this.reduced || this.perf) return;
    const feet = kind === "jump" || kind === "land" || kind === "slide"; // dust at the ground
    const n = kind === "death" ? 20 : kind === "land" ? 14 : kind === "collect" ? 10 : 12;
    const color = kind === "death" ? 0xff3b3b : kind === "flip" ? 0xffe9a8 : kind === "collect" ? 0xffb347
      : feet ? 0x8fe8ff : 0xffd54a; // feet kick up cyan light-sparks off the Tron grid
    const speed = kind === "death" ? 9 : kind === "collect" ? 6 : kind === "slide" ? 8 : 5;
    const oy = feet ? 0.14 : this.lastPlayerY;
    let spawned = 0;
    for (const p of this.parts) {
      if (p.life > 0) continue;
      if (spawned >= n) break;
      spawned++;
      p.m.position.set(this.lastPlayerX + (Math.random() - 0.5) * 0.3, oy, feet ? (Math.random() - 0.5) * 0.3 : 0);
      const mat = p.m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color); mat.opacity = 1;
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6);
      if (kind === "jump") { p.vx = Math.cos(a) * sp * 0.5; p.vy = 1 + Math.random() * 1.5; p.vz = 1.5 + Math.random() * 2; } // kick down/back on takeoff
      else if (kind === "land") { p.vx = Math.cos(a) * sp; p.vy = 0.5 + Math.random() * 1.5; p.vz = Math.sin(a) * sp; }      // outward puff ring
      else if (kind === "slide") { p.vx = (Math.random() - 0.5) * sp * 0.4; p.vy = 0.4 + Math.random(); p.vz = 3 + Math.random() * 3; } // trail behind (+z)
      else { p.vx = Math.cos(a) * sp; p.vy = Math.random() * sp + 2; p.vz = Math.sin(a) * sp * 0.5; }
      p.max = kind === "death" ? 0.8 : feet ? 0.45 : 0.5; p.life = p.max;
      p.m.visible = true;
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy -= 20 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      const t = p.life / p.max;
      (p.m.material as THREE.MeshBasicMaterial).opacity = t;
      p.m.scale.setScalar(0.5 + t);
    }
  }

  render(sim: RunSim, nowMs: number): void {
    const d = sim.distance;
    const dt = this.lastNow ? Math.min(0.05, (nowMs - this.lastNow) / 1000) : 0.016;
    this.lastNow = nowMs;

    // Close call → STUMBLE: on a fresh near-miss the runner trips and recovers, the camera
    // jolts, and the Auditor surges to your heels (Temple Run's near-catch beat). Driven
    // from the sim's deterministic near-miss count; presentation only (no physics change).
    const freshNearMiss = sim.nearMisses > this.lastNearMiss;
    if (freshNearMiss) {
      this.lastNearMiss = sim.nearMisses;
      this.stumbleT = 0.55;
      this.menace = Math.min(1, this.menace + 0.5);
      this.addShake(0.6);
    }
    this.stumbleT = Math.max(0, this.stumbleT - dt);

    // Block Run / ARCH FLIP intensity ease in/out so colour + FOV transitions are smooth.
    this.blockLevel += ((sim.blockRun ? 1 : 0) - this.blockLevel) * 0.08;
    this.flipLevel += ((sim.flipActive ? 1 : 0) - this.flipLevel) * 0.1;

    // Player: procedural runner. Colour lerps toward the Block/Flip tints; the rig
    // plays the run/jump/slide cycle from sim state (gait phase syncs with distance).
    const emissive = Math.min(2.6, 0.6 + sim.flow * 0.12 + (sim.hyperFlow ? 0.6 : 0) + this.flipLevel * 0.8);
    this.cTmp.copy(this.cPlayer).lerp(this.cPlayerBlock, this.blockLevel).lerp(this.cPlayerFlip, this.flipLevel);
    this.rig.setColorObj(this.cTmp);
    this.rig.group.rotation.x = 0; // clear any leftover cutscene stumble-lean
    this.rig.update({ x: sim.laneX, y: sim.y, sliding: sim.sliding, grounded: sim.grounded, phase: sim.distance * 1.15, emissive });
    // Apply the stumble lurch over the gait: a quick forward pitch + dip that recovers.
    if (this.stumbleT > 0 && !this.reduced) {
      const ph = 1 - this.stumbleT / 0.55;          // 0 → 1 over the stumble
      const amt = Math.sin(ph * Math.PI);            // rise then recover
      this.rig.group.rotation.x = amt * 0.6;         // trip forward
      this.rig.group.position.y += -amt * 0.12;      // knees buckle
    }
    this.lastPlayerX = sim.laneX;
    this.lastPlayerY = (sim.sliding ? 0.5 : 0.9) + sim.y;
    // Contact shadow: under the runner's lane, shrinking + fading as it jumps higher.
    const jumpF = Math.min(1, Math.max(0, sim.y / 2));
    this.heroShadow.visible = true;
    this.heroShadow.position.set(sim.laneX, 0.04, 0);
    this.heroShadow.scale.setScalar(1 - jumpF * 0.45);
    (this.heroShadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - jumpF * 0.6);

    // FOV ramps with speed (and a kick during Block Run) — the sense of pace.
    const speedFrac = Math.min(1, Math.max(0, (sim.speed - START_SPEED) / (MAX_SPEED * BLOCK_SPEED_MULT - START_SPEED)));
    const targetFov = FOV_BASE + (FOV_MAX - FOV_BASE) * speedFrac + FOV_BLOCK * this.blockLevel;
    if (Math.abs(this.cam.fov - targetFov) > 0.05) { this.cam.fov += (targetFov - this.cam.fov) * 0.1; this.cam.updateProjectionMatrix(); }

    // World recolours toward the Block palette.
    this.cTmp.copy(this.cBg).lerp(this.cBgBlock, this.blockLevel);
    (this.scene.background as THREE.Color).copy(this.cTmp);
    this.fog.color.copy(this.cTmp);
    this.fog.far = 82 - 10 * this.blockLevel; // tighter tunnel = faster feel

    // Camera eases toward the player's lane; shake is a transient offset on top.
    this.camX += (sim.laneX * 0.35 - this.camX) * 0.1;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    this.cam.position.set(this.camX + sx, 5.4 + sy, 9);
    this.cam.lookAt(sim.laneX * 0.2, 1.4, -10);
    this.shake *= 0.86;

    // Death camera overrides: ease up/back and orbit the fallen runner.
    if (this.deathT >= 0) {
      this.deathT = Math.min(1, this.deathT + dt * 0.9);
      const e = this.deathT;
      this.cam.position.set(this.camX * 0.4 + Math.sin(e * 3) * 0.7, 5.4 + e * 5, 9 + e * 9);
      this.cam.lookAt(this.lastPlayerX, Math.max(0.4, this.lastPlayerY), 0);
    }

    // City scrolls past (recycled).
    this.city.update(d);

    // THE AUDITOR chases from above-and-behind. Menace rises on a fresh near-miss or when
    // the runner is slow, and bleeds off as they speed up / flow — so it surges to your
    // heels when you scrape past danger and falls back when you're clean. Honest tension,
    // driven only from sim state (no fake catch — it never actually ends the run).
    // Cruising menace stays low (it hangs back, small + high); a near-miss spikes it (above)
    // so it SWOOPS down to your heels, then decays as you pull away. Block/Hyper keeps it in.
    const menaceTarget = Math.min(0.55, 0.06 + (1 - speedFrac) * 0.22 + (sim.flow < 1 ? 0.08 : 0));
    this.menace += ((Math.max(menaceTarget, this.menace * 0.985) - this.menace)) * 0.06;
    const men = (sim.hyperFlow || sim.blockRun) ? Math.max(this.menace, 0.45) : this.menace;
    this.chaser.setVisible(true);
    this.donut.visible = false; // donut + bakery are cutscene-only props
    this.bakery.visible = false;
    // Hangs high + small when cruising (never occludes the lane); dives bigger/closer as it
    // bears down, claws reaching for the runner.
    const cz = THREE.MathUtils.lerp(4.4, 3.7, men);
    const cy = THREE.MathUtils.lerp(7.2, 4.8, men);
    this.chaser.group.position.set(sim.laneX * 0.4 + Math.sin(nowMs / 1100) * 0.5, cy + Math.sin(nowMs / 700) * 0.18, cz);
    this.chaser.group.rotation.set(0.6 + men * 0.3, Math.sin(nowMs / 1600) * 0.12, 0);
    this.chaser.group.scale.setScalar(THREE.MathUtils.lerp(0.44, 0.8, men));
    this.chaser.update(nowMs, men);

    // Floor ticks scroll (instanced).
    const spacing = 4;
    const span = this.TICKS * spacing;
    for (let i = 0; i < this.TICKS; i++) {
      const localZ = -((((i * spacing - d) % span) + span) % span);
      this.dummy.position.set(0, 0.02, localZ + 8); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
      this.tickMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.tickMesh.instanceMatrix.needsUpdate = true;

    // Speed streaks (Block Run only): deterministic lateral lanes scrolling fast (instanced).
    const streaksOn = this.blockLevel > 0.15 && !this.reduced && !this.lowQ && !this.perf;
    this.streakMesh.visible = streaksOn;
    const sspan = 90;
    if (streaksOn) {
      this.streakMat.opacity = 0.5 * this.blockLevel;
      for (let i = 0; i < this.STREAKS; i++) {
        const lane = ((i % 4) - 1.5) * LANE_WIDTH * 1.15;
        const base = (i * 37.7) % sspan;
        const localZ = -((((base - d * 1.4) % sspan) + sspan) % sspan);
        this.dummy.position.set(lane, 0.4 + ((i * 13) % 5) * 0.7, localZ + 10); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
        this.streakMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.streakMesh.instanceMatrix.needsUpdate = true;
    }

    // Obstacles — authored hazard props, placed per type from their pools.
    const v = sim.view();
    this.obstacles.beginFrame();
    for (const o of v.obstacles) {
      const localZ = -(o.z - d);
      if (localZ > -62 && localZ < 10) this.obstacles.show(o.type, o.lane, localZ);
    }
    this.obstacles.finish();
    this.obstacles.pulse(nowMs, this.blockLevel);

    // Energy orbs (spin for life).
    let ei = 0;
    for (const e of v.energy) {
      if (ei >= this.enPool.length) break;
      const m = this.enPool[ei++]!;
      const lz = -(e.z - d);
      const passed = lz > 0.6; // behind the player = a MISS: it tumbles away instead of just vanishing
      const bob = Math.sin(nowMs / 280 + e.id) * 0.08;
      m.position.set(e.lane * LANE_WIDTH, 0.65 + e.y + bob + (passed ? (lz * 0.12) : 0), lz);
      if (passed) m.rotation.set(Math.PI / 2 + lz * 0.25, nowMs / 300, nowMs / 450); // tumble as it flies past
      else m.rotation.set(Math.PI / 2, 0, nowMs / 450); // upright, ₿ facing camera
      m.visible = lz < 11; // cull only once behind the camera
    }
    for (; ei < this.enPool.length; ei++) this.enPool[ei]!.visible = false;

    // ARCH FLIP gateway frames (one shared pulsing material).
    const gates = sim.flipGatesInView();
    let gi = 0;
    this.flipMat.emissiveIntensity = 1.2 + Math.sin(nowMs / 160) * 0.5;
    for (const g of gates) {
      if (gi >= this.gatePool.length) break;
      const m = this.gatePool[gi++]!;
      const localZ = -(g.z - d);
      m.position.set(g.lane * LANE_WIDTH, 0, localZ);
      m.visible = localZ > -62 && localZ < 10;
    }
    for (; gi < this.gatePool.length; gi++) this.gatePool[gi]!.visible = false;

    this.updateParticles(dt);
    this.renderFrame();
  }
}
