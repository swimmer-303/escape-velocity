// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The rover pet from the Hangar: a small, friendly robot on treads that trundles after the crew around the base,
// looks around while it waits, and rolls home to the habitat door to doze when everyone is inside.
// Nine tiny boxes and three materials; nothing is allocated in the frame loop.

import * as THREE from 'three';
import { mat } from './retro';
import type { Cosmetics } from './stage';

type Height = (x: number, z: number) => number;
export type PetLook = NonNullable<Cosmetics['pet']>;

/** Where the pet waits (beside the habitat door, clear of the shelter) when no one is outside. */
export const PET_HOME = new THREE.Vector3(-1.5, 0, 3.1);
/** How close it likes to stay to the astronaut it follows. */
export const PET_GAP = 0.8;
const TOP_SPEED = 1.6;

const vA = new THREE.Vector3();

export class RoverPet {
  readonly group = new THREE.Group();
  private bodyMat = mat('#f4f0e6');
  private trimMat = mat('#4a4f63');
  private eyeMat = mat('#101820', { emissive: new THREE.Color('#5ef2e6'), emissiveIntensity: 1 });
  private head: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private chassis = new THREE.Group();
  private yaw = 0;
  private glow = false;
  private moving = false;
  private parts: THREE.Mesh[] = [];
  /** True while it is parked at home with no one to follow. */
  napping = true;

  constructor() {
    const g = this.group;
    g.name = 'rover-pet';
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.chassis) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      this.parts.push(mesh);
      return mesh;
    };
    // Treads, chassis and a bumper.
    box(0.1, 0.14, 0.46, this.trimMat, -0.19, 0.07, 0, g);
    box(0.1, 0.14, 0.46, this.trimMat, 0.19, 0.07, 0, g);
    box(0.3, 0.13, 0.4, this.bodyMat, 0, 0.19, 0);
    box(0.24, 0.05, 0.05, this.trimMat, 0, 0.16, 0.22);
    // A big head with two glowing eyes, and an antenna with a blinking tip.
    this.head = box(0.3, 0.2, 0.22, this.bodyMat, 0, 0.37, 0.04);
    for (const sx of [-1, 1]) {
      const eye = box(0.07, 0.08, 0.02, this.eyeMat, sx * 0.07, 0.01, 0.115, this.head);
      eye.castShadow = false;
      this.eyes.push(eye);
    }
    box(0.03, 0.16, 0.03, this.trimMat, 0.09, 0.17, -0.04, this.head);
    box(0.06, 0.06, 0.06, this.eyeMat, 0.09, 0.27, -0.04, this.head).castShadow = false;
    g.add(this.chassis);
    this.group.position.copy(PET_HOME);
  }

  setLook(look: PetLook) {
    this.bodyMat.color.set(look.body);
    this.bodyMat.emissive.set(look.body);
    this.trimMat.color.set(look.trim);
    this.eyeMat.emissive.set(look.eyes);
    this.glow = !!look.glow;
    this.bodyMat.emissiveIntensity = 0;
  }

  /** Put it somewhere right away (no driving), e.g. when it first rolls out. */
  place(x: number, z: number, height: Height) {
    this.group.position.set(x, height(x, z), z);
  }

  /**
   * Follow `leader` (an astronaut's position), keeping a little gap; with no one to follow, drive home and nap.
   * With reduced motion it still drives (as the crew still walk) but never bounces, wiggles or blinks.
   */
  update(dt: number, time: number, leader: THREE.Vector3 | null, height: Height, reduced: boolean, night: number) {
    const p = this.group.position;
    let tx: number;
    let tz: number;
    if (leader) {
      // Aim for a spot on its own side of the leader, PET_GAP away: it trails along behind as they walk.
      vA.set(p.x - leader.x, 0, p.z - leader.z);
      const d = vA.length();
      if (d > 1e-4) vA.multiplyScalar(PET_GAP / d);
      else vA.set(0, 0, PET_GAP);
      tx = leader.x + vA.x;
      tz = leader.z + vA.z;
    } else {
      tx = PET_HOME.x;
      tz = PET_HOME.z;
    }
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    this.moving = dist > 0.06;
    if (this.moving) {
      const step = Math.min(dist, Math.min(TOP_SPEED, 0.4 + dist * 1.5) * dt);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      // Turn smoothly toward where it is going (the model faces +z).
      const want = Math.atan2(dx, dz);
      let turn = want - this.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.yaw += turn * Math.min(1, dt * 8);
    } else if (leader) {
      // Waiting: turn to look at the astronaut.
      const want = Math.atan2(leader.x - p.x, leader.z - p.z);
      let turn = want - this.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.yaw += turn * Math.min(1, dt * 4);
    }
    this.group.rotation.y = this.yaw;
    p.y = height(p.x, p.z);
    this.napping = !leader && !this.moving;

    // A happy little bounce on the move, a look around while waiting, and blinking (none with reduced motion).
    this.chassis.position.y = !reduced && this.moving ? Math.abs(Math.sin(time * 16)) * 0.025 : 0;
    this.head.rotation.y = !reduced && !this.moving && !this.napping ? Math.sin(time * 1.7) * 0.35 : 0;
    const blink = !reduced && !this.napping && time % 3.7 < 0.12;
    for (const e of this.eyes) e.scale.y = this.napping ? 0.3 : blink ? 0.15 : 1;
    this.eyeMat.emissiveIntensity = this.napping ? 0.25 : 1.3;
    this.bodyMat.emissiveIntensity = this.glow ? 0.25 + night * 0.9 : 0;
  }

  dispose() {
    for (const m of this.parts) m.geometry.dispose();
    this.bodyMat.dispose();
    this.trimMat.dispose();
    this.eyeMat.dispose();
  }
}
