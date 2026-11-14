// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "Look at this module": where to put the camera to frame a part of the base, and a smooth swing there
// (an arc around the target, so the camera never cuts straight through the buildings). Pure math, so the
// tests can run it without a GPU.

import * as THREE from 'three';

/** The opening orbit view. */
export const OVERVIEW_TARGET = new THREE.Vector3(0, 1.2, 1.5);
export const OVERVIEW_POSITION = new THREE.Vector3(17, 11, 19);
/** How close the orbit view may zoom; a focused module may come closer. */
export const OVERVIEW_MIN_DISTANCE = 12;
export const FOCUS_MIN_DISTANCE = 4;

/** A tap moves less than this (CSS pixels) and is quicker than this (ms); anything else is a drag. */
export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 600;

export function isTap(dx: number, dy: number, ms: number) {
  return Math.hypot(dx, dy) <= TAP_SLOP_PX && ms <= TAP_MAX_MS;
}

/** An angle wrapped into -PI..PI. */
export function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const POLAR = 1.05; // about 30 degrees above the horizon

/**
 * Camera goal for framing a part of the base: the camera looks at it from outside the base (turned partway
 * toward where the camera already is, so the move stays short), far enough back to fit it on screen.
 */
export function framePose(center: THREE.Vector3, radius: number, camera: THREE.PerspectiveCamera, outTarget: THREE.Vector3, outSph: THREE.Spherical) {
  outTarget.copy(center);
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const fit = Math.min(vfov, hfov);
  const dist = THREE.MathUtils.clamp((radius / Math.tan(fit / 2)) * 1.25 + 2, 6, 22);
  const current = Math.atan2(camera.position.x - center.x, camera.position.z - center.z);
  const outward = Math.hypot(center.x, center.z) > 2.5 ? Math.atan2(center.x, center.z) : current;
  outSph.set(dist, POLAR, outward + wrapAngle(current - outward) * 0.35);
  return outSph;
}

/** Camera goal for the whole base: the opening distance and height, seen from the camera's current side. */
export function overviewPose(camera: THREE.PerspectiveCamera, outTarget: THREE.Vector3, outSph: THREE.Spherical) {
  outTarget.copy(OVERVIEW_TARGET);
  outSph.setFromVector3(_off.copy(OVERVIEW_POSITION).sub(OVERVIEW_TARGET));
  outSph.theta = Math.atan2(camera.position.x - OVERVIEW_TARGET.x, camera.position.z - OVERVIEW_TARGET.z);
  return outSph;
}

const _off = new THREE.Vector3();
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Swings a camera and its orbit target to a goal, along an arc around the target. */
export class CameraMove {
  active = false;
  private t = 0;
  private dur = 1;
  private fromTarget = new THREE.Vector3();
  private toTarget = new THREE.Vector3();
  private fromSph = new THREE.Spherical();
  private toSph = new THREE.Spherical();
  private sph = new THREE.Spherical();
  private off = new THREE.Vector3();

  /** dur 0 = jump there on the next step (reduced motion). */
  start(camera: THREE.Camera, target: THREE.Vector3, goalTarget: THREE.Vector3, goal: THREE.Spherical, dur: number) {
    this.fromTarget.copy(target);
    this.toTarget.copy(goalTarget);
    this.fromSph.setFromVector3(this.off.copy(camera.position).sub(target));
    this.toSph.copy(goal);
    this.toSph.theta = this.fromSph.theta + wrapAngle(goal.theta - this.fromSph.theta);
    this.t = 0;
    this.dur = Math.max(1e-4, dur);
    this.active = true;
  }

  /** Moves the camera one frame; returns true while it is still moving. */
  step(dt: number, camera: THREE.Camera, target: THREE.Vector3) {
    if (!this.active) return false;
    this.t = Math.min(1, this.t + dt / this.dur);
    const e = ease(this.t);
    target.lerpVectors(this.fromTarget, this.toTarget, e);
    const a = this.fromSph;
    const b = this.toSph;
    this.sph.set(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, a.theta + (b.theta - a.theta) * e);
    camera.position.setFromSpherical(this.sph).add(target);
    camera.lookAt(target);
    if (this.t >= 1) this.active = false;
    return this.active;
  }
}
