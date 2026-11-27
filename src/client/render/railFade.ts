// Screen-door cutaway shared by the elevated track, station and trains. Matching the stipple
// across layers leaves the same pixels open through a train, the track bed and a girder.
import * as THREE from 'three';
import { PLATFORM_HALF, type Railway, VIADUCT_HALF } from '../../shared/world/railgen';
import { profileZ, type Way, wayLocal } from '../../shared/world/wayTypes';

export class RailFade {
  private focus = { value: new THREE.Vector4() };
  private variants = new WeakMap<THREE.Material, THREE.Material>();

  constructor(private rail: Railway, private way: Way) {}

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

  material(source: THREE.Material): THREE.Material {
    const cached = this.variants.get(source);
    if (cached) return cached;
    const mat = source.clone();
    mat.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile(shader, renderer);
      shader.uniforms.uRailFocus = this.focus;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRailPosition;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRailPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRailPosition;\nuniform vec4 uRailFocus;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (uRailFocus.w > 0.0 && vRailPosition.y > uRailFocus.y + 0.5) {
            float mask = uRailFocus.w * (1.0 - smoothstep(7.8, 13.0, distance(vRailPosition.xz, uRailFocus.xz)));
            float pattern = mod(floor(gl_FragCoord.x) + 2.0 * floor(gl_FragCoord.y), 4.0);
            if (pattern + 0.5 < 3.0 * mask) discard;
          }`);
    };
    mat.customProgramCacheKey = () => source.customProgramCacheKey() + '-rail-cutaway';
    this.variants.set(source, mat);
    return mat;
  }
}
