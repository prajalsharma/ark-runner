/**
 * The hero — SAT, the ARCH PEPE: an orange frog in a black "ᴧARCH" hoodie (hood up), black
 * joggers and black/white 3-stripe sneakers. An authored procedural character (not stacked
 * boxes): a frog head with a wide Pepe muzzle + hooded eyes framed by the pulled-up hood, a
 * hoodie torso with a chest wordmark / kangaroo pocket / drawstrings, jointed tapered limbs
 * with overlapping joint caps (no gaps), orange frog fists, and material zones (hoodie black /
 * joggers / frog skin / sneaker white). The frog skin is the player-coloured, flow-reactive part.
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

/** The white "ᴧARCH" chest wordmark — a chevron mark + ARCH — baked to a transparent texture. */
function makeArchTexture(): THREE.Texture {
  const w = 512, h = 160;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; g.lineCap = "round"; g.lineJoin = "round";
  // Arch chevron mark (ᴧ): two strokes rising to a peak on the left.
  g.lineWidth = 18;
  g.beginPath(); g.moveTo(30, 118); g.lineTo(78, 46); g.lineTo(126, 118); g.stroke();
  // Wordmark.
  g.font = "700 96px Arial, Helvetica, sans-serif"; g.textBaseline = "middle";
  g.fillText("ARCH", 150, 86);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
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
  private handR = new THREE.Group();  // right hand group — the cutscene donut is held here
  private fingersR: THREE.Mesh[] = []; // right-hand fingers — curl to grip the donut (cutscene)
  private thumbR?: THREE.Mesh;         // right thumb — wraps across the donut when gripping
  private cheekL?: THREE.Mesh;         // cheeks puff out on the chew (cutscene)
  private cheekR?: THREE.Mesh;
  private mouthMesh?: THREE.Mesh;      // mouth — opens/closes on the chew (cutscene)
  private hood = new THREE.Group();   // cowl pivot — sways on its own (secondary motion)
  private pack = new THREE.Group();   // ledger-pack pivot — sways on its own
  // ARCH PEPE palette: black "ᴧARCH" hoodie + joggers, orange frog skin, black/white sneakers.
  private suitMat: THREE.MeshStandardMaterial;   // the black hoodie (torso + sleeves + hood)
  private hoodMat: THREE.MeshStandardMaterial;   // hood interior / deepest black folds
  private pantMat: THREE.MeshStandardMaterial;   // black joggers (matte cloth, no sheen)
  private gearMat: THREE.MeshStandardMaterial;   // ribbed cuffs / hems / sneaker upper (dark)
  private skinMat: THREE.MeshStandardMaterial;   // FROG SKIN — head + hands (player-coloured; default orange)
  private whiteMat: THREE.MeshStandardMaterial;  // sneaker sole + 3 stripes + eye whites + ARCH wordmark
  private pupilMat: THREE.MeshStandardMaterial;  // frog pupils (black)
  private visorMat: THREE.MeshPhysicalMaterial;  // tiny neon accent (sneaker toe tab) to fit the Tron world

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
    // Hoodie: near-black with a faint cool tint so the cyan rim lights of the Tron world
    // catch its edges (pure 0x000000 would vanish against the dark bg).
    this.suitMat = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.82, metalness: 0.08 });
    this.hoodMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.9, metalness: 0.05 });
    this.pantMat = new THREE.MeshStandardMaterial({ color: 0x121319, roughness: 0.9, metalness: 0.04 });
    this.gearMat = new THREE.MeshStandardMaterial({ color: 0x0e0f14, roughness: 0.7, metalness: 0.2 });
    // FROG SKIN — player-coloured; default is the brand orange. A little emissive so the frog
    // pops against the dark and can "charge" with flow/Block/Flip (driven in update()).
    // Smooth, lightly glazed skin — a soft clearcoat sheen reads like a polished toy model
    // (the Subway-Surfers look) instead of matte plastic.
    this.skinMat = new THREE.MeshPhysicalMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.16), emissiveIntensity: 0.28, roughness: 0.42, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.5 });
    this.whiteMat = new THREE.MeshStandardMaterial({ color: 0xf3f3ee, roughness: 0.5, metalness: 0.05 });
    this.pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x08080b, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }); // wet, glossy eyes
    // One small neon tab on the sneakers keeps a Tron spark on an otherwise clean cartoon.
    this.visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0c12, emissive: 0xff7a1a, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });

    // A tapered limb (cylinder) under a pivot; returns the mesh.
    const limb = (parent: THREE.Object3D, rTop: number, rBot: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 24), mat);
      m.position.y = -len / 2; parent.add(m); return m;
    };
    // A rounded joint cap (sphere) at a pivot origin — hides the gap between two segments.
    const joint = (parent: THREE.Object3D, r: number, mat: THREE.Material): void => {
      parent.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat));
    };

    // ---- Legs: hip → thigh → KNEE → shin → SNEAKER. Segment lengths MUST match legIK. ----
    // Black joggers (pantMat), a ribbed ankle hem, and a black/white 3-stripe sneaker.
    const legBuild = (hip: THREE.Group, knee: THREE.Group, sx: number): void => {
      hip.position.set(sx * 0.15, 0.74, 0);
      joint(hip, 0.145, this.pantMat);                           // hip cap
      limb(hip, 0.15, 0.11, 0.38, this.pantMat);                 // thigh (joggers)
      knee.position.y = -0.38; hip.add(knee);
      joint(knee, 0.105, this.pantMat);                          // knee cap (fills the gap)
      limb(knee, 0.105, 0.085, 0.3, this.pantMat);              // shin (joggers, tapering)
      // Ribbed ankle hem of the joggers, gathered above the shoe.
      const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.078, 0.07, 24), this.gearMat);
      hem.position.y = -0.33; knee.add(hem);
      // ---- Sneaker (toe forward = +z): black upper, white midsole, 3 white stripes ----
      const shoe = new THREE.Group(); shoe.position.set(0, -0.42, 0.06); knee.add(shoe);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.12, 0.34), this.gearMat);
      upper.position.set(0, 0.015, 0.02); shoe.add(upper);
      // Rounded toe box (fuller front) — high-res so the curve is smooth.
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.082, 28, 20), this.gearMat);
      toe.position.set(0, -0.005, 0.18); toe.scale.set(0.95, 0.85, 1.1); shoe.add(toe);
      const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.1), this.gearMat);
      tongue.position.set(0, 0.075, -0.05); tongue.rotation.x = -0.35; shoe.add(tongue);
      // White midsole wrapping the foot, a touch wider than the upper.
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.055, 0.46), this.whiteMat);
      sole.position.set(0, -0.06, 0.04); shoe.add(sole);
      const heel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.085, 0.1), this.gearMat);
      heel.position.set(0, 0.03, -0.14); shoe.add(heel);
      // 3 white diagonal stripes on the OUTER face of the shoe.
      for (let s = 0; s < 3; s++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.03), this.whiteMat);
        stripe.position.set(sx * 0.079, 0.02, 0.02 + s * 0.055); stripe.rotation.x = 0.5; shoe.add(stripe);
      }
      // Tiny neon toe tab (the only Tron spark on the character).
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.015), this.visorMat);
      tab.position.set(0, 0.04, 0.2); shoe.add(tab);
    };
    legBuild(this.hipL, this.kneeL, -1);
    legBuild(this.hipR, this.kneeR, 1);
    this.group.add(this.hipL, this.hipR);

    // ---- Hoodie hem (where the hoodie meets the joggers at the waist) ----
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.215, 0.11, 32), this.gearMat);
    hem.position.y = 0.76; hem.scale.z = 0.78; this.group.add(hem);

    // ---- Body group (leans / banks): hoodie torso, frog head + up-hood, arms ----
    this.body.position.set(0, 0.78, 0);

    // Torso: the black hoodie — broad chest tapering to the hem, a bit boxy like a sweatshirt.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.26, 0.62, 32), this.suitMat);
    torso.position.y = 0.33; torso.scale.z = 0.8; this.body.add(torso);
    // Rounded upper chest + shoulder caps so the hoodie reads soft & full (no hard cylinder top).
    const chestRound = new THREE.Mesh(new THREE.SphereGeometry(0.33, 32, 24), this.suitMat);
    chestRound.position.set(0, 0.5, 0); chestRound.scale.set(1, 0.7, 0.82); this.body.add(chestRound);
    for (const ex of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 18), this.suitMat);
      shoulder.position.set(ex * 0.28, 0.56, 0); shoulder.scale.set(1, 0.95, 0.9); this.body.add(shoulder);
    }
    // Kangaroo pocket across the lower front.
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.12), this.suitMat);
    pocket.position.set(0, 0.16, 0.2); pocket.scale.z = 0.8; this.body.add(pocket);
    const pocketLine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.01), this.gearMat);
    pocketLine.position.set(0, 0.245, 0.265); this.body.add(pocketLine);
    // ᴧARCH wordmark on the chest (unlit white decal so it stays crisp in the dark).
    const logoTex = makeArchTexture();
    const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, side: THREE.DoubleSide });
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), logoMat);
    logo.position.set(0, 0.42, 0.255); this.body.add(logo);
    // Same wordmark across the upper BACK — the chase camera's read + branding. The 180° turn
    // (faces +z, the chase-cam side) reads correctly; pushed proud of the torso so it's not clipped.
    const backLogo = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.088), logoMat);
    backLogo.position.set(0, 0.47, -0.262); backLogo.rotation.y = Math.PI; this.body.add(backLogo);
    // Hood draped around the shoulders / collar (black roll at the base of the neck).
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.055, 16, 32), this.suitMat);
    collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.62, -0.02); collar.scale.set(1.1, 1, 1.3); this.body.add(collar);
    // Two short drawstrings hanging from the collar at the throat (above the wordmark).
    for (const ex of [-1, 1]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 10), this.whiteMat);
      cord.position.set(ex * 0.03, 0.55, 0.246); this.body.add(cord);
      const aglet = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 10), this.gearMat);
      aglet.position.set(ex * 0.03, 0.485, 0.246); this.body.add(aglet);
    }

    // Short frog neck (mostly hidden by the hood collar).
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.08, 20), this.skinMat);
    neck.position.y = 0.66; this.body.add(neck);

    // ---- HEAD on its own pivot (sways via secondary motion) ----
    // The Arch Pepe: an orange frog head — wide muzzle + Pepe lips, big hooded eyes on top —
    // framed by a BLACK HOODIE HOOD pulled up over the top/back/sides.
    this.hood.position.set(0, 0.8, 0); this.body.add(this.hood);

    // Frog skull: a smooth, softly-rounded dome (high-res so there are no facets).
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 48, 36), this.skinMat);
    head.position.set(0, 0.02, 0.01); head.scale.set(1.06, 0.98, 1.02); this.hood.add(head);
    // Muzzle: a smooth rounded snout blending out of the lower face — the wide mouth sits on it.
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.128, 40, 30), this.skinMat);
    muzzle.position.set(0, -0.052, 0.085); muzzle.scale.set(1.16, 0.74, 1.0); this.hood.add(muzzle);
    // A soft jaw/chin under the muzzle so the lower face isn't cut flat.
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24), this.skinMat);
    jaw.position.set(0, -0.11, 0.045); jaw.scale.set(1.08, 0.7, 0.92); this.hood.add(jaw);

    // Big friendly frog eyes: round glossy domes high on the head, with a RELAXED half-lid
    // (the chill Pepe look, not angry) and a catch-light so they feel alive.
    const eye = (ex: number): void => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 40, 30), this.whiteMat);
      ball.position.set(ex * 0.073, 0.112, 0.055); this.hood.add(ball);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.036, 28, 22), this.pupilMat);
      pupil.position.set(ex * 0.072, 0.092, 0.118); pupil.scale.set(0.95, 1.0, 0.9); this.hood.add(pupil); // gazes fwd/down
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), this.whiteMat);
      glint.position.set(ex * 0.064, 0.104, 0.142); this.hood.add(glint); // lively catch-light
      // Smooth orange upper lid: a spherical cap over the eyeball, drooped to a bit past half —
      // the heavy-lidded, chill Pepe gaze (not wide-eyed, not a scowl).
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.08, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.6), this.skinMat);
      lid.position.set(ex * 0.073, 0.116, 0.055); lid.rotation.x = 0.46; lid.scale.set(1.03, 1.0, 1.03); this.hood.add(lid);
    };
    eye(-1); eye(1);
    // The two eyes sit close and bulge together — a soft orange bridge fills the gap between them.
    const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 24), this.skinMat);
    bridge.position.set(0, 0.1, 0.06); bridge.scale.set(0.9, 0.8, 0.7); this.hood.add(bridge);

    // Nostrils: two small, subtle dimples on top of the snout.
    for (const ex of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.01, 16, 12), this.pupilMat);
      nostril.position.set(ex * 0.028, 0.004, 0.2); nostril.scale.set(1, 1, 0.6); this.hood.add(nostril);
    }
    // Wide Pepe SMILE: a curved dark mouth (the bottom half of a torus → a ∪), flattened in the
    // GEOMETRY so the chew (which scales mouthMesh.y) opens it into a grin rather than distorting
    // a baked mesh-scale. rotation.z = π turns the ∩ arc into a smile.
    const mouthGeo = new THREE.TorusGeometry(0.092, 0.013, 16, 36, Math.PI); mouthGeo.scale(1.2, 0.5, 0.5);
    const mouth = new THREE.Mesh(mouthGeo, this.pupilMat);
    mouth.position.set(0, -0.058, 0.188); mouth.rotation.z = Math.PI; this.hood.add(mouth); this.mouthMesh = mouth;
    // A soft orange upper-lip ridge riding just over the smile (the signature Pepe lip).
    const upperLip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 14, 32, Math.PI), this.skinMat);
    upperLip.scale.set(1.15, 0.42, 0.5); upperLip.position.set(0, -0.052, 0.19); upperLip.rotation.z = Math.PI; this.hood.add(upperLip);
    // Cheeks (frog): smooth, nearly flat, puff out on the chew.
    for (const ex of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.052, 28, 20), this.skinMat);
      cheek.position.set(ex * 0.1, -0.055, 0.08); cheek.scale.set(0.95, 0.95, 0.65);
      this.hood.add(cheek);
      if (ex < 0) this.cheekL = cheek; else this.cheekR = cheek;
    }

    // ---- BLACK HOOD pulled up: a smooth shell over top/back/sides, open at the face (+z) ----
    this.hoodMat.side = THREE.DoubleSide; // hollow shell — show the inner surface, no see-through
    const hoodShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 48, 32, 2.70, 4.02, 0, Math.PI * 0.82), this.hoodMat);
    hoodShell.position.set(0, 0.04, 0.0); hoodShell.scale.set(1.2, 1.18, 1.22); this.hood.add(hoodShell);
    // Rolled hoodie edge framing the face opening (smooth torus).
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.032, 20, 40), this.suitMat);
    rim.position.set(0, 0.05, 0.07); rim.scale.set(1.14, 1.24, 0.72); this.hood.add(rim);
    // The hood bulges back into a soft rounded point behind the head.
    const hoodBack = new THREE.Mesh(new THREE.SphereGeometry(0.17, 36, 28), this.suitMat);
    hoodBack.position.set(0, 0.1, -0.17); hoodBack.scale.set(1.02, 0.96, 1.4); this.hood.add(hoodBack);

    // ---- Arms: shoulder → upper → ELBOW → forearm → glove, with joint caps. ----
    const armBuild = (sh: THREE.Group, elbow: THREE.Group, sx: number): void => {
      sh.position.set(sx * 0.3, 0.56, 0);
      joint(sh, 0.1, this.suitMat);                             // shoulder cap
      limb(sh, 0.095, 0.072, 0.28, this.suitMat);              // upper arm
      elbow.position.y = -0.28; sh.add(elbow);
      joint(elbow, 0.072, this.suitMat);                        // elbow cap
      limb(elbow, 0.07, 0.055, 0.26, this.suitMat);            // forearm
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.056, 0.045, 20), this.gearMat);
      cuff.position.y = -0.28; elbow.add(cuff);                 // ribbed sleeve cuff at the wrist
      // Hand: a smooth rounded frog fist — a sphere palm with rounded finger + thumb capsules.
      const hand = sx > 0 ? this.handR : new THREE.Group(); hand.position.y = -0.33; elbow.add(hand);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 28, 22), this.skinMat);
      palm.position.y = 0.0; palm.scale.set(1.0, 1.08, 0.95); hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135, 0.03, 6, 12), this.skinMat);
        finger.position.set(-0.03 + f * 0.02, -0.052, 0.028); finger.rotation.x = 0.5; hand.add(finger); // curled over
        if (sx > 0) this.fingersR.push(finger);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.025, 6, 12), this.skinMat);
      thumb.position.set(sx * 0.045, -0.02, 0.03); thumb.rotation.z = sx * 0.7; hand.add(thumb);
      if (sx > 0) this.thumbR = thumb;
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
    // The hoodie/joggers stay black; the player colour (and Block/Flip tints) ride the FROG
    // SKIN, which is the brand element and the part that reads against the dark world.
    this.skinMat.color.copy(c); this.skinMat.emissive.copy(c).multiplyScalar(0.18);
  }

  /** Drive the pose. `phase` advances with distance so the gait matches speed. */
  update(st: { x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number }): void {
    this.group.position.x = st.x;
    // Restore any cutscene grip/chew extras to the running baseline (the Attract rig is reused
    // for the idle backdrop after the cutscene, so these must not stick).
    if (this.group.position.z !== 0) this.group.position.z = 0;
    for (const fg of this.fingersR) fg.rotation.x = 0.5;
    if (this.thumbR) this.thumbR.rotation.z = 0.7;
    if (this.cheekL) this.cheekL.scale.set(1, 1, 0.5);
    if (this.cheekR) this.cheekR.scale.set(1, 1, 0.5);
    if (this.mouthMesh) { this.mouthMesh.scale.set(1, 1, 1); this.mouthMesh.position.y = -0.058; }
    this.skinMat.emissiveIntensity = 0.25 + st.emissive * 0.3; // the frog "charges" with flow/Block/Flip
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

  /** A STANDING bakery pose for the cutscene — no run cycle (SAT isn't running while he
   *  bites). `armUp` (0..1) raises the right hand to the mouth so the donut reads as held
   *  and eaten, with a small head dip. Resets all run/spring/scale state. */
  cutscenePose(armUp: number, chew = 0, grip = 0, flinch = 0): void {
    const a = clamp(armUp, 0, 1);
    const ch = clamp(chew, 0, 1);      // chew wave 0..1 (cheeks puff, mouth works)
    const gr = clamp(grip, 0, 1);      // 0 open hand → 1 gripping the donut
    const fl = clamp(flinch, 0, 1);    // 0 calm → 1 recoil from the Auditor
    // Clear dynamic state so it's a clean, still pose.
    this.airF = 0; this.slideF = 0; this.squash = 0; this.stretch = 0;
    this.leanZ = this.leanV = this.yaw = this.yawV = 0; this.havePrev = false;
    this.hoodX = this.hoodXV = this.hoodZ = this.hoodZV = 0; this.packX = this.packXV = this.packZ = this.packZV = 0;
    // Flinch: a small step back (+z, away from the drone in front) and a jolt scale-pop.
    this.group.rotation.set(0, Math.PI, 0); this.group.position.set(this.group.position.x, 0, fl * 0.16); this.group.scale.set(1, 1, 1);
    // Legs: relaxed standing stance (not mid-stride); knees bend a touch on the flinch.
    this.hipL.rotation.x = 0.10 - fl * 0.12; this.hipR.rotation.x = -0.08 - fl * 0.12;
    this.kneeL.rotation.x = 0.16 + fl * 0.3; this.kneeR.rotation.x = 0.12 + fl * 0.3;
    // Right arm raises the donut from the hip (a=0) up to the MOUTH (a=1). The target pose
    // at a=1 brings the fist to world ≈ (0, 1.52, -0.34) — right at the lips, on the −z face
    // side — by adducting across the body (shR.z) rather than flaring out to the side. On the
    // flinch the hand jerks back from the mouth (arm drops a little).
    this.shR.rotation.x = lerp(0.2, -1.15, a) + fl * 0.5; this.shR.rotation.z = lerp(-0.14, -0.9, a); this.elbowR.rotation.x = lerp(-0.3, -1.4, a) + fl * 0.4;
    // Left arm: relaxed at the side; flies up defensively as he recoils.
    this.shL.rotation.x = 0.18 - fl * 1.5; this.shL.rotation.z = 0.22 + fl * 0.3; this.elbowL.rotation.x = -0.55 - fl * 0.8;
    // Fingers curl to GRIP the donut; thumb wraps across the top.
    for (const fg of this.fingersR) fg.rotation.x = lerp(0.5, 1.15, gr);
    if (this.thumbR) { this.thumbR.rotation.z = lerp(0.7, 1.15, gr); this.thumbR.rotation.x = lerp(0, -0.5, gr); }
    // Cheeks puff + mouth opens/closes on the chew (a tiny munch).
    if (this.cheekL) this.cheekL.scale.set(1 + ch * 0.6, 1 + ch * 0.5, 0.5 + ch * 0.5);
    if (this.cheekR) this.cheekR.scale.set(1 + ch * 0.6, 1 + ch * 0.5, 0.5 + ch * 0.5);
    if (this.mouthMesh) { this.mouthMesh.scale.set(1, 1 + ch * 4, 1); this.mouthMesh.position.y = -0.058 - ch * 0.006; }
    // Torso stays mostly upright; leans BACK on the flinch. Head tips down to the donut, or
    // snaps UP toward the looming Auditor when flinching; a soft chew bob on top.
    this.body.rotation.set(0.05 + a * 0.05 - fl * 0.3, 0, 0);
    this.hood.rotation.set(0.04 + a * 0.16 - fl * 0.5 - ch * 0.04, 0, 0);
    this.pack.rotation.set(0.05, 0, 0);
  }

  /** World position of the right hand (the cutscene donut rides here). Call after an update
   *  or cutscenePose, once the group is in the scene graph. */
  rightHandWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.handR.getWorldPosition(out);
  }
}
