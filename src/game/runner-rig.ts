/**
 * The hero — SAT, a hooded Arch courier. An authored procedural character (not stacked
 * boxes): athletic tapered torso, a distinct DARK COWL HOOD with a glowing cyan visor slit
 * over a shadowed face, a ledger-pack on the back (the thing the Auditor wants back), jointed
 * tapered limbs with overlapping joint caps (no gaps), boots and gloves, and material zones
 * (suit / dark gear / skin / emissive accent).
 *
 * Pure presentation: it reads sim state and plays a run / jump / slide cycle procedurally.
 * This is the "Path A" rig from docs/GAMEDEV_RESEARCH_AND_REVAMP.md §3.1 — and the guaranteed
 * fallback for the Path B GLB hero (see hero-glb.ts). Beyond the base greybox it adds:
 *   • spring-damper SECONDARY MOTION — the cowl and the ledger-pack lag + sway on jumps,
 *     landings, and lane changes (velocity-driven, no physics engine);
 *   • a TURN-LEAN — the body banks and the figure yaws into a lane change;
 *   • a crisper JUMP — anticipation reach on the rise, knee tuck + arms-forward on the fall;
 *   • a baseball-style SLIDE — leading leg extended, trail leg tucked, torso dive.
 * No per-frame allocation. Joint pivots are the animation contract.
 */
import * as THREE from "three";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** One critically-damped spring step toward `target` (frame-rate-assumed-constant; this is
 *  render-only eye-candy, never gameplay). Returns the new [value, velocity]. */
function spring(val: number, vel: number, target: number, stiffness: number, damping: number): [number, number] {
  const a = (target - val) * stiffness - vel * damping;
  const nv = vel + a;
  return [val + nv, nv];
}

export class RunnerRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();   // torso+head+arms+pack (leans + banks)
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();  // knee joints → real foot lift/plant, not skating
  private kneeR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private hood = new THREE.Group();   // cowl pivot — sways on its own (secondary motion)
  private pack = new THREE.Group();   // ledger-pack pivot — sways on its own
  private suitMat: THREE.MeshStandardMaterial;   // the player-coloured run suit
  private hoodMat: THREE.MeshStandardMaterial;   // darker shade of the suit — reads as a cowl
  private gearMat: THREE.MeshStandardMaterial;   // boots / gloves / pack — dark metal
  private skinMat: THREE.MeshStandardMaterial;   // face / hands / neck skin
  private hairMat: THREE.MeshStandardMaterial;   // hair
  private eyeMat: THREE.MeshStandardMaterial;    // eye whites
  private visorMat: THREE.MeshPhysicalMaterial;  // emissive accents (chest core, glowing eyes, soles)

  private slideF = 0;  // eased 0..1 slide blend
  private airF = 0;    // eased 0..1 airborne blend

  // Secondary-motion + turn state (spring integrators). Render-only.
  private prevX = 0; private prevY = 0; private havePrev = false;
  private leanZ = 0; private leanV = 0;          // body bank into a lane change
  private yaw = 0; private yawV = 0;             // figure yaw into a lane change
  private hoodX = 0; private hoodXV = 0;         // cowl pitch sway
  private hoodZ = 0; private hoodZV = 0;         // cowl roll sway
  private packX = 0; private packXV = 0;         // pack pitch sway
  private packZ = 0; private packZV = 0;         // pack roll sway
  private prevGrounded = true;                   // land/takeoff edge detect
  private squash = 0;                            // landing squash (decays)
  private stretch = 0;                           // takeoff stretch (decays)
  private readonly cTmp = new THREE.Color();

  constructor(color: number) {
    this.suitMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.12), emissiveIntensity: 0.6, roughness: 0.55, metalness: 0.15 });
    this.hoodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.42), roughness: 0.68, metalness: 0.12 });
    this.gearMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.55, metalness: 0.55 });
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xc98b63, roughness: 0.8 }); // natural skin
    this.hairMat = new THREE.MeshStandardMaterial({ color: 0x241712, roughness: 0.75 }); // dark hair
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 });   // eye whites
    // Glossy clearcoat so the visor + chest core read like lit screens, not matte plastic.
    this.visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0c12, emissive: 0x33e1ff, emissiveIntensity: 1.6, roughness: 0.22, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12 });

    // A tapered limb (cylinder) under a pivot; returns the mesh.
    const limb = (parent: THREE.Object3D, rTop: number, rBot: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 10), mat);
      m.position.y = -len / 2; parent.add(m); return m;
    };
    // A rounded joint cap (sphere) at a pivot origin — hides the gap between two segments.
    const joint = (parent: THREE.Object3D, r: number, mat: THREE.Material): void => {
      parent.add(new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat));
    };

    // ---- Legs: hip → thigh → KNEE → shin → boot. Leg segment lengths MUST match legIK. ----
    const legBuild = (hip: THREE.Group, knee: THREE.Group, sx: number): void => {
      hip.position.set(sx * 0.15, 0.74, 0);
      joint(hip, 0.14, this.suitMat);                            // hip cap
      limb(hip, 0.145, 0.1, 0.38, this.suitMat);                 // thigh
      knee.position.y = -0.38; hip.add(knee);
      joint(knee, 0.1, this.suitMat);                            // knee cap (fills the gap)
      limb(knee, 0.098, 0.072, 0.36, this.suitMat);             // shin
      const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), this.gearMat);
      ankle.position.y = -0.37; knee.add(ankle);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.4), this.gearMat);
      boot.position.set(0, -0.42, 0.09); knee.add(boot);        // boot, toe forward (+z)
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.05, 0.44), this.visorMat);
      sole.position.set(0, -0.49, 0.1); sole.scale.setScalar(0.98); knee.add(sole); // faint lit sole
    };
    legBuild(this.hipL, this.kneeL, -1);
    legBuild(this.hipR, this.kneeR, 1);
    this.group.add(this.hipL, this.hipR);

    // ---- Pelvis / belt ----
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.17, 0.32), this.gearMat);
    belt.position.y = 0.78; this.group.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.03), this.visorMat);
    buckle.position.set(0, 0.78, 0.18); this.group.add(buckle);

    // ---- Body group (leans / banks): torso, head+cowl, arms, pack ----
    this.body.position.set(0, 0.78, 0);

    // Torso: tapered (broad shoulders → narrow waist) for an athletic courier read.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.2, 0.62, 14), this.suitMat);
    torso.position.y = 0.33; torso.scale.z = 0.74; this.body.add(torso);
    // Chest plate + glowing core (identity accent, also visible from the front).
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.1), this.gearMat);
    chest.position.set(0, 0.42, 0.19); chest.scale.z = 0.9; this.body.add(chest);
    const chestCore = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), this.visorMat);
    chestCore.rotation.x = Math.PI / 2; chestCore.position.set(0, 0.44, 0.25); this.body.add(chestCore);

    // Ledger-pack on the back (the MacGuffin) — on its own pivot so it can sway.
    this.pack.position.set(0, 0.5, -0.17); this.body.add(this.pack);
    const packBox = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.2), this.gearMat);
    packBox.position.set(0, -0.14, -0.08); this.pack.add(packBox);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.02), this.visorMat);
    seam.position.set(0, -0.08, -0.19); this.pack.add(seam);
    const seam2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.02), this.visorMat);
    seam2.position.set(0, -0.14, -0.19); this.pack.add(seam2);

    // Neck (skin).
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.085, 0.1, 10), this.skinMat);
    neck.position.y = 0.69; this.body.add(neck);

    // ---- HEAD on its own pivot (secondary motion = hair/head bob & sway) ----
    // A human head: skin head, a face on the FRONT (+z local → travel side, seen in the
    // cutscene), and HAIR covering top/back/sides (what the chase camera sees from behind).
    this.hood.position.set(0, 0.82, 0); this.body.add(this.hood);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 16), this.skinMat);
    head.position.set(0, 0.02, 0); head.scale.set(0.9, 1.08, 0.94); this.hood.add(head);
    for (const ex of [-1, 1]) { // ears
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), this.skinMat);
      ear.position.set(ex * 0.142, 0.0, -0.01); ear.scale.set(0.6, 1, 0.8); this.hood.add(ear);
    }
    // Hair: a cap over top + back + sides, open at the face; sits slightly proud of the scalp.
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), this.hairMat);
    hairCap.position.set(0, 0.055, -0.012); hairCap.scale.set(1.02, 1.08, 1.08); this.hood.add(hairCap);
    const nape = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), this.hairMat);
    nape.position.set(0, 0.03, -0.055); nape.scale.set(0.98, 0.9, 0.7); this.hood.add(nape); // fuller at the back
    for (const tx of [-0.075, -0.025, 0.025, 0.075]) { // swept front tufts over the hairline
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.1, 5), this.hairMat);
      tuft.position.set(tx, 0.125, 0.085); tuft.rotation.set(0.9, 0, (tx) * 1.2); this.hood.add(tuft);
    }
    // Face (front = +z local): eyes (+ a faint cyan tech glint), brows, nose, mouth.
    const eye = (ex: number): void => {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), this.eyeMat);
      white.position.set(ex * 0.058, 0.028, 0.132); white.scale.set(1, 0.8, 0.5); this.hood.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), this.visorMat);
      pupil.position.set(ex * 0.058, 0.028, 0.15); this.hood.add(pupil); // faint cyan glow = Tron tech-eyes
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.013, 0.02), this.hairMat);
      brow.position.set(ex * 0.058, 0.072, 0.142); brow.rotation.z = ex * 0.1; this.hood.add(brow);
    };
    eye(-1); eye(1);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.06, 6), this.skinMat);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.012, 0.15); this.hood.add(nose);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.02), this.hairMat);
    mouth.position.set(0, -0.072, 0.138); this.hood.add(mouth);

    // ---- Arms: shoulder → upper → ELBOW → forearm → glove, with joint caps. ----
    const armBuild = (sh: THREE.Group, elbow: THREE.Group, sx: number): void => {
      sh.position.set(sx * 0.3, 0.56, 0);
      joint(sh, 0.1, this.suitMat);                             // shoulder cap
      limb(sh, 0.095, 0.072, 0.28, this.suitMat);              // upper arm
      elbow.position.y = -0.28; sh.add(elbow);
      joint(elbow, 0.072, this.suitMat);                        // elbow cap
      limb(elbow, 0.07, 0.055, 0.26, this.suitMat);            // forearm
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.04, 10), this.gearMat);
      cuff.position.y = -0.28; elbow.add(cuff);                 // sleeve cuff at the wrist
      // Hand: skin palm + four fingers + a thumb (a loose running fist).
      const hand = new THREE.Group(); hand.position.y = -0.31; elbow.add(hand);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.085, 0.05), this.skinMat);
      palm.position.y = -0.02; hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.055, 0.03), this.skinMat);
        finger.position.set(-0.026 + f * 0.0175, -0.075, 0.012); finger.rotation.x = 0.5; hand.add(finger); // curled
      }
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.042, 0.026), this.skinMat);
      thumb.position.set(sx * 0.04, -0.04, 0.02); thumb.rotation.z = sx * 0.7; hand.add(thumb);
    };
    armBuild(this.shL, this.elbowL, -1);
    armBuild(this.shR, this.elbowR, 1);
    this.body.add(this.shL, this.shR);
    this.group.add(this.body);
    // Face the direction of travel (−z): the camera is behind (+z), so it sees SAT's back +
    // fee-pack, not the face. (Front cues — visor/chest core — are built on +z, so without
    // this the hero faced the camera and read as "running backwards".) World-space lane
    // position is unaffected (rotation spins the geometry about the group origin only).
    this.group.rotation.y = Math.PI;
  }

  // Leg segment lengths (thigh, shin) — must match the meshes built in the constructor.
  private static readonly L1 = 0.38;
  private static readonly L2 = 0.36;

  /** Foot path over one gait cycle (cyclePos 0..1), in the hip's sagittal plane, then a
   *  2-bone IK solve → { hip, knee } rotations that place the foot there. Forward = -z. */
  private static legIK(cyclePos: number): { hip: number; knee: number } {
    const stance = 0.58, stride = 0.42, legLen = 0.7, lift = 0.26;
    let ty: number, tz: number;
    if (cyclePos < stance) {
      const t = cyclePos / stance;                 // planted: front(-z) → back(+z)
      tz = (-stride / 2) + stride * t; ty = -legLen;
    } else {
      const t = (cyclePos - stance) / (1 - stance); // swing: back → front, foot lifts
      tz = (stride / 2) - stride * t; ty = -legLen + lift * Math.sin(Math.PI * t);
    }
    const L1 = RunnerRig.L1, L2 = RunnerRig.L2;
    const d = clamp(Math.hypot(ty, tz), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.004);
    const kneeBend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const angTo = Math.atan2(tz, -ty); // angle of the target from straight-down toward +z
    const hipOff = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    return { hip: angTo - hipOff, knee: kneeBend };
  }

  setColor(hex: number): void { this.cTmp.set(hex); this.setColorObj(this.cTmp); }
  setColorObj(c: THREE.Color): void {
    this.suitMat.color.copy(c); this.suitMat.emissive.copy(c).multiplyScalar(0.12);
    this.hoodMat.color.copy(c).multiplyScalar(0.42); // cowl stays a darker shade of the suit
  }

  /** Drive the pose. `phase` advances with distance so the gait matches speed. */
  update(st: { x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number }): void {
    this.group.position.x = st.x;
    this.suitMat.emissiveIntensity = 0.35 + st.emissive * 0.25;
    this.visorMat.emissiveIntensity = 1.2 + st.emissive * 0.4;

    // Per-frame velocity (presentation-only; drives secondary motion + turn-lean).
    if (!this.havePrev) { this.prevX = st.x; this.prevY = st.y; this.havePrev = true; }
    const vx = clamp(st.x - this.prevX, -0.6, 0.6);
    const vy = clamp(st.y - this.prevY, -0.6, 0.6);
    this.prevX = st.x; this.prevY = st.y;

    // Snappy pose response: blend INTO air/slide fast (crisp reaction), ease OUT a bit softer.
    this.airF = lerp(this.airF, st.grounded ? 0 : 1, st.grounded ? 0.3 : 0.5);
    this.slideF = lerp(this.slideF, st.sliding ? 1 : 0, st.sliding ? 0.55 : 0.35);

    // Squash & stretch: stretch up on takeoff, squash flat on landing (both spring back).
    if (st.grounded && !this.prevGrounded) this.squash = 0.34;
    if (!st.grounded && this.prevGrounded) this.stretch = 0.22;
    this.prevGrounded = st.grounded;
    this.squash = lerp(this.squash, 0, 0.22);
    this.stretch = lerp(this.stretch, 0, 0.3);

    const run = (1 - this.airF) * (1 - this.slideF);
    const p = st.phase;
    const s = Math.sin(p);
    const swing = 0.82 * run;

    // Legs: 2-bone foot IK on a treadmill cycle (plant → drag → lift arc → swing). Opposite
    // legs are half a cycle apart.
    const cyc = (x: number): number => ((x % 1) + 1) % 1;
    const tau = Math.PI * 2;
    const ikL = RunnerRig.legIK(cyc(p / tau));
    const ikR = RunnerRig.legIK(cyc(p / tau + 0.5));

    // Arms: shoulders counter-swing to the legs; elbows stay bent and pump.
    const runShL = -s * swing * 0.85, runShR = s * swing * 0.85;
    const elbow = 0.55 + 0.32 * run;

    // ---- JUMP: anticipation/reach on the RISE, tuck + arms-forward on the FALL ----
    // riseF 1 when ascending → arms reach up, legs trail; 0 when falling → knees tuck, arms fwd.
    const riseF = clamp(0.5 + vy * 3.2, 0, 1);
    const jumpHip = lerp(-0.4, -1.15, 1 - riseF);   // trail → tuck
    const jumpKnee = lerp(0.5, 1.9, 1 - riseF);     // extended → deep tuck
    const jumpSh = lerp(-2.3, -0.5, 1 - riseF);     // reach up → arms forward for landing
    const jumpElbowExtra = lerp(-0.25, 0.25, 1 - riseF);

    // ---- SLIDE: baseball dive — leading (L) leg extends, trail (R) tucks, arm reaches ----
    const slideHipL = -1.45, slideKneeL = 0.25;     // leading leg out front
    const slideHipR = -0.55, slideKneeR = 1.5;      // trail leg tucked
    const slideShL = 1.6, slideShR = 0.6;           // lead arm back, guard arm

    this.hipL.rotation.x = ikL.hip * run + jumpHip * this.airF + slideHipL * this.slideF;
    this.hipR.rotation.x = ikR.hip * run + jumpHip * this.airF + slideHipR * this.slideF;
    this.kneeL.rotation.x = ikL.knee * run + jumpKnee * this.airF + slideKneeL * this.slideF;
    this.kneeR.rotation.x = ikR.knee * run + jumpKnee * this.airF + slideKneeR * this.slideF;
    this.shL.rotation.x = runShL * run + jumpSh * this.airF + slideShL * this.slideF;
    this.shR.rotation.x = runShR * run + jumpSh * this.airF + slideShR * this.slideF;
    this.elbowL.rotation.x = -(elbow + jumpElbowExtra * this.airF);
    this.elbowR.rotation.x = -(elbow + jumpElbowExtra * this.airF);
    // Arm splay so the swing reads in 3D, not just fore/aft.
    this.shL.rotation.z = 0.14; this.shR.rotation.z = -0.14;

    // ---- TURN-LEAN: bank + yaw into a lane change (spring toward a velocity target) ----
    [this.leanZ, this.leanV] = spring(this.leanZ, this.leanV, -vx * 1.6, 0.22, 0.55);
    [this.yaw, this.yawV] = spring(this.yaw, this.yawV, -vx * 0.9, 0.22, 0.55);
    this.group.rotation.y = Math.PI + this.yaw; // base facing (−z, back to camera) + turn-lean yaw

    // ---- SECONDARY MOTION: cowl + ledger-pack lag and swing (spring-damper) ----
    // Pack: pitches from vertical velocity (lags on jump, swings on land), rolls from lateral.
    [this.packX, this.packXV] = spring(this.packX, this.packXV, clamp(-vy * 2.6, -0.5, 0.5) + 0.06, 0.2, 0.5);
    [this.packZ, this.packZV] = spring(this.packZ, this.packZV, clamp(vx * 2.2, -0.5, 0.5), 0.2, 0.5);
    this.pack.rotation.set(this.packX, 0, this.packZ);
    // Cowl: softer, lags behind the head on vertical moves + a tiny run bob.
    const hoodBobT = -Math.abs(Math.cos(p)) * 0.05 * run;
    [this.hoodX, this.hoodXV] = spring(this.hoodX, this.hoodXV, clamp(-vy * 1.8, -0.35, 0.35), 0.24, 0.5);
    [this.hoodZ, this.hoodZV] = spring(this.hoodZ, this.hoodZV, clamp(vx * 1.4, -0.35, 0.35), 0.24, 0.5);
    this.hood.rotation.set(this.hoodX + hoodBobT, 0, this.hoodZ);

    // Torso lean + a bob that dips on each foot-plant (twice per stride) for weight.
    const bob = Math.abs(Math.cos(p)) * 0.045 * run;
    this.body.rotation.x = lerp(0.16, -0.05, this.airF * (1 - riseF)) + this.slideF * 1.15;
    this.body.rotation.z = this.leanZ * (1 - this.slideF);
    this.group.position.y = st.y + bob;
    // Squash & stretch on top of the slide crouch: tall+thin on takeoff, short+wide on landing.
    const baseY = lerp(1, 0.56, this.slideF);
    const sy = baseY * (1 - this.squash + this.stretch);
    const sxz = 1 + this.squash * 0.6 - this.stretch * 0.28;
    this.group.scale.set(sxz, sy, sxz);
  }
}
