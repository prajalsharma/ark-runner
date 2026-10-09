/**
 * The hero — SAT, a hooded Arch courier. An authored procedural character (not stacked
 * boxes): tapered torso, hooded head with a glowing visor, a ledger-pack on the back
 * (the thing the Auditor wants back), jointed tapered limbs with boots and gloves, and
 * material zones (suit / dark gear / skin / emissive accent). Pure presentation: it reads
 * sim state and plays a run / jump / slide cycle from named joints, procedurally.
 * No per-frame allocation. Joint pivots (hipL/R, shL/R, body) are the animation contract.
 */
import * as THREE from "three";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class RunnerRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();   // torso+head+arms+pack (leans)
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();  // knee joints → real foot lift/plant, not skating
  private kneeR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private suitMat: THREE.MeshStandardMaterial;   // the player-coloured run suit
  private gearMat: THREE.MeshStandardMaterial;   // boots / gloves / pack — dark metal
  private skinMat: THREE.MeshStandardMaterial;   // face
  private visorMat: THREE.MeshStandardMaterial;  // emissive visor + trim
  private slideF = 0;  // eased 0..1 slide blend
  private airF = 0;    // eased 0..1 airborne blend

  constructor(color: number) {
    this.suitMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.12), emissiveIntensity: 0.6, roughness: 0.55, metalness: 0.15 });
    this.gearMat = new THREE.MeshStandardMaterial({ color: 0x1a1d27, roughness: 0.6, metalness: 0.5 });
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.7 });
    // Glossy clearcoat so the visor + chest core read like lit screens, not matte plastic.
    this.visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0c12, emissive: 0x33e1ff, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12 });

    // Helper: a tapered limb (cylinder) with an optional end cap mesh, under a pivot.
    const limb = (parent: THREE.Object3D, rTop: number, rBot: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 10), mat);
      m.position.y = -len / 2; parent.add(m); return m;
    };

    // ---- Legs: hip → thigh → KNEE → shin → boot. The knee lets the foot lift on the
    // swing and plant on the stance, so the run reads grounded instead of skating. ----
    const legBuild = (hip: THREE.Group, knee: THREE.Group, sx: number): void => {
      hip.position.set(sx * 0.17, 0.72, 0);
      limb(hip, 0.14, 0.11, 0.38, this.suitMat);                // thigh
      knee.position.y = -0.38; hip.add(knee);
      limb(knee, 0.1, 0.08, 0.36, this.suitMat);                // shin
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.42), this.gearMat);
      boot.position.set(0, -0.4, 0.08); knee.add(boot);          // boot, toe forward (+z)
    };
    legBuild(this.hipL, this.kneeL, -1);
    legBuild(this.hipR, this.kneeR, 1);
    this.group.add(this.hipL, this.hipR);

    // ---- Pelvis / belt (ties the legs to the torso) ----
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.34), this.gearMat);
    belt.position.y = 0.76; this.group.add(belt);

    // ---- Body group (leans): torso, head+hood, arms, pack ----
    this.body.position.set(0, 0.72, 0);

    // Torso: tapered (shoulders wider than waist) + a chest plate for a read-at-distance form.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.64, 12), this.suitMat);
    torso.position.y = 0.34; torso.scale.z = 0.72; this.body.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.1), this.gearMat);
    chest.position.set(0, 0.42, 0.2); this.body.add(chest);
    const chestLed = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.03), this.visorMat);
    chestLed.position.set(0, 0.46, 0.26); this.body.add(chestLed);

    // Ledger-pack on the back (the MacGuffin) with an emissive seam.
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.22), this.gearMat);
    pack.position.set(0, 0.36, -0.26); this.body.add(pack);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02), this.visorMat);
    seam.position.set(0, 0.36, -0.38); this.body.add(seam);

    // Neck + head (skin sphere) + hood shell (suit, over the back/top) + glowing visor.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 8), this.skinMat);
    neck.position.y = 0.72; this.body.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), this.skinMat);
    head.position.y = 0.92; head.scale.set(0.92, 1, 0.92); this.body.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.72), this.suitMat);
    hood.position.set(0, 0.95, -0.03); hood.scale.set(1.02, 1.05, 1.08); this.body.add(hood);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), this.visorMat);
    visor.position.set(0, 0.92, 0.19); this.body.add(visor);

    // ---- Arms: shoulder → upper → ELBOW → forearm → glove (elbow bend pumps the run). ----
    const armBuild = (sh: THREE.Group, elbow: THREE.Group, sx: number): void => {
      sh.position.set(sx * 0.32, 0.56, 0);
      limb(sh, 0.1, 0.08, 0.28, this.suitMat);                  // upper arm
      elbow.position.y = -0.28; sh.add(elbow);
      limb(elbow, 0.08, 0.06, 0.26, this.suitMat);              // forearm
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), this.gearMat);
      glove.position.y = -0.3; elbow.add(glove);
    };
    armBuild(this.shL, this.elbowL, -1);
    armBuild(this.shR, this.elbowR, 1);
    this.body.add(this.shL, this.shR);
    this.group.add(this.body);
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
    const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
    const d = clamp(Math.hypot(ty, tz), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.004);
    const kneeBend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const angTo = Math.atan2(tz, -ty); // angle of the target from straight-down toward +z
    const hipOff = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    return { hip: angTo - hipOff, knee: kneeBend };
  }

  setColor(hex: number): void { this.suitMat.color.set(hex); this.suitMat.emissive.set(new THREE.Color(hex).multiplyScalar(0.12)); }
  setColorObj(c: THREE.Color): void { this.suitMat.color.copy(c); this.suitMat.emissive.copy(c).multiplyScalar(0.12); }

  /** Drive the pose. `phase` advances with distance so the gait matches speed. */
  update(st: { x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number }): void {
    this.group.position.x = st.x;
    this.suitMat.emissiveIntensity = 0.35 + st.emissive * 0.25;
    this.visorMat.emissiveIntensity = 1.2 + st.emissive * 0.4;

    this.airF = lerp(this.airF, st.grounded ? 0 : 1, 0.25);
    this.slideF = lerp(this.slideF, st.sliding ? 1 : 0, 0.3);

    const run = (1 - this.airF) * (1 - this.slideF);
    const p = st.phase;
    const s = Math.sin(p);
    const swing = 0.8 * run;

    // Legs: 2-bone foot IK on a treadmill cycle — each foot follows a real path (plant →
    // drag back → lift in an arc → swing forward), and the hip + knee are SOLVED to reach
    // it. Reads as a grounded run cycle (correct knee bend, foot lift) rather than two
    // rigid rods swinging on independent sines. Opposite legs are half a cycle apart.
    const cyc = (x: number): number => ((x % 1) + 1) % 1;
    const tau = Math.PI * 2;
    const ikL = RunnerRig.legIK(cyc(p / tau));
    const ikR = RunnerRig.legIK(cyc(p / tau + 0.5));

    // Arms: shoulders counter-swing to the legs; elbows stay bent and pump.
    const runShL = -s * swing * 0.8, runShR = s * swing * 0.8;
    const elbow = 0.5 + 0.3 * run;

    // Jump tuck / slide are absolute target poses, blended in by their own weight (IK run
    // pose fades out as airF/slideF rise, since run = (1-airF)(1-slideF)).
    const jumpHip = -0.9, jumpKnee = 1.7, jumpSh = -1.5;
    const slideHip = -1.1, slideKnee = 0.5, slideSh = 1.2;

    this.hipL.rotation.x = ikL.hip * run + jumpHip * this.airF + slideHip * this.slideF;
    this.hipR.rotation.x = ikR.hip * run + jumpHip * this.airF + slideHip * this.slideF;
    this.kneeL.rotation.x = ikL.knee * run + jumpKnee * this.airF + slideKnee * this.slideF;
    this.kneeR.rotation.x = ikR.knee * run + jumpKnee * this.airF + slideKnee * this.slideF;
    this.shL.rotation.x = runShL * run + jumpSh * this.airF + slideSh * this.slideF;
    this.shR.rotation.x = runShR * run + jumpSh * this.airF + slideSh * this.slideF;
    this.elbowL.rotation.x = -elbow; this.elbowR.rotation.x = -elbow;
    // A little arm splay so the swing reads in 3D, not just fore/aft.
    this.shL.rotation.z = 0.12; this.shR.rotation.z = -0.12;

    // Torso lean + a bob that dips on each foot-plant (twice per stride) for weight.
    const bob = Math.abs(Math.cos(p)) * 0.045 * run;
    this.body.rotation.x = lerp(0.14, 0, this.airF) + this.slideF * 1.0;
    this.group.position.y = st.y + bob;
    this.group.scale.y = lerp(1, 0.58, this.slideF);
  }
}
