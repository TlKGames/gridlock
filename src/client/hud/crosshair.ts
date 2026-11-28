// The crosshair: on keyboard and mouse it's the game's pointer, faint, and strong while Aim is held
// (you face toward it then). It marks a spot on the ground: zooming in to aim pushes that spot
// outward on screen, so the crosshair moves out with it (it stays on what you were pointing at),
// and the zoom stops where that spot would leave the screen (`zoomFloor`). Hidden while a menu has
// the mouse or the controller is in use. Also keeps where your character is on screen for the
// input (aiming turns you toward the crosshair).
import * as THREE from 'three';
import type { Input } from '../game/input';

/** The crosshair (and the spot it marks) stays this far (px) inside the screen's edges. */
const EDGE = 24;

/** The least aim zoom (camera height share) that keeps the spot under the mouse on screen: with the
 *  mouse at distance d from you and room m to the edge that way, zooming by z puts it d / z out. */
export function zoomFloor(input: Input): number {
  const dx = input.mouseX - input.anchorX, dy = input.mouseY - input.anchorY;
  const d = Math.hypot(dx, dy);
  if (d < 1) return 0;
  const ux = dx / d, uy = dy / d;
  const toX = ux > 0 ? (window.innerWidth - EDGE - input.anchorX) / ux : ux < 0 ? (EDGE - input.anchorX) / ux : Infinity;
  const toY = uy > 0 ? (window.innerHeight - EDGE - input.anchorY) / uy : uy < 0 ? (EDGE - input.anchorY) / uy : Infinity;
  const room = Math.max(1, Math.min(toX, toY));
  return d / room;
}

export class Crosshair {
  private el = document.createElement('div');
  private label = document.createElement('span');
  private v = new THREE.Vector3();
  private shown = false;
  private aiming = false;
  private blocked = false;

  constructor(parent: HTMLElement) {
    this.el.className = 'crosshair';
    this.el.innerHTML = '<i></i><i></i><i></i><i></i><b></b>';
    this.el.appendChild(this.label);
    parent.appendChild(this.el);
  }

  /** Every frame, after rendering: `at` is your character (world x, height, y), or null; `scope`
   *  the camera's aim zoom right now (1 = none). */
  update(camera: THREE.Camera, at: { x: number; h: number; y: number } | null, input: Input, scope: number, hover: (x: number, y: number) => string): void {
    if (at) {
      this.v.set(at.x, at.h, at.y).project(camera);
      input.anchorX = (this.v.x * 0.5 + 0.5) * window.innerWidth;
      input.anchorY = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    }
    const show = !!at && input.enabled && (input.mouseActive || input.scoped);
    if (show !== this.shown) { this.shown = show; this.el.classList.toggle('on', show); }
    if (input.scoped !== this.aiming) { this.aiming = input.scoped; this.el.classList.toggle('aiming', this.aiming); }
    // Riding with the mouse behind you: a shot can't be taken there.
    if (input.fireBlocked !== this.blocked) { this.blocked = input.fireBlocked; this.el.classList.toggle('blocked', this.blocked); }
    if (!show) return;
    const p = input.crosshair();
    // Zoomed in, the spot the mouse marks sits 1 / scope times further out from you.
    const x = input.anchorX + (p.x - input.anchorX) / scope, y = input.anchorY + (p.y - input.anchorY) / scope;
    const name = hover(x, y);
    if (this.label.textContent !== name) this.label.textContent = name;
    this.label.style.right = x > window.innerWidth / 2 ? '12px' : 'auto';
    this.label.style.left = x > window.innerWidth / 2 ? 'auto' : '12px';
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}
