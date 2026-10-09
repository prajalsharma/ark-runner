/**
 * THE AUDITOR — the antagonist. A hovering compliance-enforcer that hunts the courier who
 * ate the unconfirmed donut. Authored procedural form (not a floating eyeball): an angular
 * armoured pod, a red scanner eye in a lens ring, two claw-arms that reach and grasp, rear
 * thrusters and a hover underglow. It looms above-and-behind the player and BEARS DOWN —
 * surging closer on mistakes, falling back when the player flows. `menace` (0..1) drives
 * how close/aggressive it reads. Also used in the opening cutscene (descends to confront).
 * Pure presentation; no gameplay authority. Front of the model is local -z (toward player).
 */
import * as THREE from "three";

export class ChaserRig {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private eye: THREE.Mesh;
  private eyeMat: THREE.MeshStandardMaterial;
  private glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private clawL = new THREE.Group();
  private clawR = new THREE.Group();
  private thrustMats: THREE.MeshStandardMaterial[] = [];

  constructor() {
    // Lighter gunmetal so the key/rim light catches the facets and the FORM reads (a
    // near-black hull just blobs out against the dark city). Hot emissive trim seams.
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.4, metalness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3a0d0d, emissive: 0xff3300, emissiveIntensity: 1.1, roughness: 0.5, metalness: 0.6 });

    // Armoured pod hull — angular, wider than tall, leaning forward.
    const hull = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), metal);
    hull.scale.set(1.25, 0.82, 1.35);
    this.group.add(hull);
    // Glowing seam rings around the hull so the silhouette reads as a machine, not a blob.
    for (const [axis, r] of [["x", 1.12], ["z", 1.18]] as const) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 6, 28), trim);
      if (axis === "x") seam.rotation.y = Math.PI / 2;
      seam.scale.set(1.1, 0.82, 1.18);
      this.group.add(seam);
    }
    // Dorsal fin + cheek plates for silhouette.
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 4), metal);
    fin.position.set(0, 0.85, 0.1); fin.rotation.y = Math.PI / 4; this.group.add(fin);
    for (const sx of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.8), trim);
      cheek.position.set(sx * 1.0, 0, -0.15); cheek.rotation.z = sx * 0.3; this.group.add(cheek);
    }

    // Scanner eye — mounted high on the FRONT of the hull, craning toward the player, so
    // it stays readable from the high chase-cam looking down on the pursuer. Spinning ring.
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff3300, emissiveIntensity: 2.2, roughness: 0.3 });
    this.eye = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16), this.eyeMat);
    this.eye.position.set(0, 0.5, -0.78); this.group.add(this.eye);
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 14), metal);
    socket.position.set(0, 0.42, -0.5); socket.scale.set(1, 1, 0.8); this.group.add(socket);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.08, 8, 24), trim);
    this.ring.position.set(0, 0.5, -0.78); this.ring.rotation.x = 0.5; this.group.add(this.ring);

    // Claw-arms reaching forward-down (toward the player). Pivot at the shoulder sockets.
    for (const [sx, claw] of [[-1, this.clawL], [1, this.clawR]] as const) {
      claw.position.set(sx * 0.7, -0.3, -0.6);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.95, 8), metal);
      upper.position.set(0, -0.42, -0.2); upper.rotation.x = -0.9; claw.add(upper);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.04, 0.7, 8), metal);
      fore.position.set(0, -0.78, -0.72); fore.rotation.x = -1.7; claw.add(fore);
      for (const fx of [-1, 1]) {
        const finger = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), trim);
        finger.position.set(fx * 0.06, -0.8, -1.02); finger.rotation.x = -2.2; claw.add(finger);
      }
      this.group.add(claw);
    }

    // Rear thrusters (+z) with emissive cores, and a hover underglow disc.
    for (const sx of [-1, 1]) {
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 12), metal);
      nozzle.position.set(sx * 0.5, 0.05, 1.1); nozzle.rotation.x = -Math.PI / 2; this.group.add(nozzle);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff6a00, emissiveIntensity: 1.8, roughness: 0.4 });
      this.thrustMats.push(coreMat);
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), coreMat);
      core.position.set(sx * 0.5, 0.05, 1.36); core.rotation.y = Math.PI; this.group.add(core);
    }
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xff3a00, transparent: true, opacity: 0.22, depthWrite: false });
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = -0.95; this.group.add(this.glow);

    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** Idle + threat animation. menace 0..1 → faster scan, wider grasp, hotter eye/glow. */
  update(nowMs: number, menace: number): void {
    const t = nowMs / 1000;
    this.ring.rotation.z = nowMs / 360;
    // Claws grasp — open/close, faster and wider with menace.
    const grasp = (0.5 + Math.sin(t * (3 + menace * 6)) * 0.5) * (0.35 + menace * 0.65);
    this.clawL.rotation.x = -0.2 - grasp * 0.5; this.clawR.rotation.x = -0.2 - grasp * 0.5;
    this.clawL.rotation.z = grasp * 0.3; this.clawR.rotation.z = -grasp * 0.3;
    // Eye + thrusters + underglow intensify with menace and pulse.
    const pulse = 0.85 + Math.sin(t * 8) * 0.15;
    this.eyeMat.emissiveIntensity = (1.6 + menace * 2.6) * pulse;
    this.eyeMat.emissive.setHex(menace > 0.6 ? 0xff1500 : 0xff3300);
    for (const m of this.thrustMats) m.emissiveIntensity = 1.2 + menace * 1.6;
    this.glowMat.opacity = 0.14 + menace * 0.26;
  }

  /** Cutscene override: force the eye intensity (and heat) directly. */
  setEye(intensity: number): void {
    this.eyeMat.emissiveIntensity = intensity;
    this.eyeMat.emissive.setHex(intensity >= 2.2 ? 0xff1500 : 0xff3300);
  }

  setVisible(v: boolean): void { this.group.visible = v; }
}
