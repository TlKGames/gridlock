// Screen-door cutaway shared by the elevated track, station and trains. Matching the stipple
// across layers leaves the same pixels open through a train, the track bed and a girder.
import * as THREE from 'three';
import { PLATFORM_HALF, type Railway, VIADUCT_HALF } from '../../shared/world/railgen';
import { profileZ, type Way, wayLocal } from '../../shared/world/wayTypes';
import { OverheadFade } from './overheadFade';

export class RailFade extends OverheadFade {
  constructor(private rail: Railway, private way: Way) { super(); }

  update(x: number, y: number, z: number, street: boolean): void {
    const { a, l } = wayLocal(this.way, x, y);
    const deck = profileZ(this.way, a);
    let edge = Math.max(Math.abs(l) - VIADUCT_HALF, this.way.a0 - a, a - this.way.a1);
    if (street && edge < 16 && z < deck) {
      for (const s of this.rail.stations) {
        edge = Math.min(edge, Math.max(Math.abs(a - s.a) - s.half, Math.abs(l) - PLATFORM_HALF));
        for (const t of s.towers) {
          edge = Math.min(edge, Math.max(t.x0 - x, x - t.x1, t.y0 - y, y - t.y1));
        }
      }
    }
    // Ease in near an edge; an airborne vehicle approaching deck height regains the normal view.
    const strength = street ? (1 - THREE.MathUtils.smoothstep(edge, 0, 3)) * THREE.MathUtils.smoothstep(deck - z, 0, 2) : 0;
    this.focus.value.set(x, z, y, strength);
  }
}
