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
  private shL = new THREE.Group();
  private shR = new THREE.Group();
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
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, emissive: 0x33e1ff, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.4 });

    // Helper: a tapered limb (cylinder) with an optional end cap mesh, under a pivot.
    const limb = (parent: THREE.Object3D, rTop: number, rBot: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 10), mat);
      m.position.y = -len / 2; parent.add(m); return m;
    };

    // ---- Legs: pivot at the hip, limb hangs down, boot at the foot. ----
    this.hipL.position.set(-0.17, 0.72, 0);
    this.hipR.position.set(0.17, 0.72, 0);
    for (const hip of [this.hipL, this.hipR]) {
      limb(hip, 0.14, 0.1, 0.72, this.suitMat);                 // thigh→shin taper
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.42), this.gearMat);
      boot.position.set(0, -0.72, 0.07); hip.add(boot);          // boot, toe forward (+z)
    }
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

    // ---- Arms: pivot at the shoulder, limb hangs, glove at the hand. ----
    this.shL.position.set(-0.32, 0.56, 0);
    this.shR.position.set(0.32, 0.56, 0);
    for (const sh of [this.shL, this.shR]) {
      limb(sh, 0.1, 0.07, 0.5, this.suitMat);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.gearMat);
      glove.position.y = -0.52; sh.add(glove);
    }
    this.body.add(this.shL, this.shR);
    this.group.add(this.body);
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

    const s = Math.sin(st.phase);
    const swing = 0.75 * (1 - this.airF) * (1 - this.slideF);

    // Run cycle (legs/arms counter-swing); blended out when airborne/sliding.
    const runHipL = s * swing, runHipR = -s * swing;
    const runShL = -s * swing * 0.85, runShR = s * swing * 0.85;

    // Jump tuck: knees up, arms up. Slide: legs forward, arms back.
    const jumpHip = -1.0 * this.airF, jumpSh = -1.6 * this.airF;
    const slideHip = -1.1 * this.slideF, slideSh = 1.2 * this.slideF;

    this.hipL.rotation.x = runHipL + jumpHip + slideHip;
    this.hipR.rotation.x = runHipR + jumpHip + slideHip;
    this.shL.rotation.x = runShL + jumpSh + slideSh;
    this.shR.rotation.x = runShR + jumpSh + slideSh;
    // A little arm splay so the swing reads in 3D, not just fore/aft.
    this.shL.rotation.z = 0.12; this.shR.rotation.z = -0.12;

    // Torso lean + bob; crouch flat when sliding; lean into the run.
    const bob = Math.abs(Math.sin(st.phase)) * 0.05 * (1 - this.airF) * (1 - this.slideF);
    this.body.rotation.x = lerp(0.14, 0, this.airF) + this.slideF * 1.0;
    this.group.position.y = st.y + bob;
    this.group.scale.y = lerp(1, 0.58, this.slideF);
  }
}
