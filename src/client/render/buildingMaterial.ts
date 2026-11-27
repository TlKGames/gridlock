// Lambert material for instanced building masses: per-instance wall/roof colours, procedural
// facades (window grid, frames, floor bands, storefronts) that light up at night, and roof
// surfaces (gravel/tar for flat roofs, corrugated metal for industrial ones).
import * as THREE from 'three';
import { WORLD } from '../../shared/world/worldSpec';

export interface BuildingUniforms { uNight: { value: number } }

export function buildingMaterial(): { mat: THREE.MeshLambertMaterial; uniforms: BuildingUniforms } {
  const uniforms: BuildingUniforms = { uNight: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // Before glass and tar (WORLD.modern off): board roofs, clapboard, small sash windows, lamplight.
  if (!WORLD.modern) mat.defines = { OLD_ERA: '' };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    // Interpolating the per-building seed can change the window hash within a single pane.
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aWall; attribute vec3 aRoof; attribute vec3 aWin;
        varying vec3 vWall; varying vec3 vRoof; flat varying vec3 vWin; varying vec3 vGW; varying vec3 vGN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWall = aWall; vRoof = aRoof; vWin = aWin;
        vec4 gw = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vGW = gw.xyz;
        vGN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vWall; varying vec3 vRoof; flat varying vec3 vWin; varying vec3 vGW; varying vec3 vGN;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        vec3 gWindowGlow = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float kind = vWin.z;
          bool roof = vGN.y > 0.5;
          vec3 col;
          if (roof) {
            col = vRoof * 1.7;
            if (kind > 0.5 && kind < 1.5) {
              // Corrugated metal: fine ridges along the long axis.
              float ridge = 0.5 + 0.5 * sin((abs(vGN.x) > 0.5 ? vGW.z : vGW.x) * 6.0);
              col *= 0.88 + 0.12 * ridge;
            } else {
              float n = vnoise(vGW.xz * 0.35) * 0.6 + vnoise(vGW.xz * 2.1) * 0.4;
              col *= 0.82 + 0.3 * n;
            #ifdef OLD_ERA
              // A board roof: courses of planks, weathered unevenly.
              float run = abs(vGN.x) > 0.5 ? vGW.x : vGW.z;
              float course = floor(run / 0.32);
              col *= 0.86 + 0.18 * h21(vec2(course, floor((abs(vGN.x) > 0.5 ? vGW.z : vGW.x) / 2.4)));
              col *= 1.0 - 0.16 * step(0.86, fract(run / 0.32));
            #else
              // Tar seams.
              vec2 g = abs(fract(vGW.xz / 6.0) - 0.5);
              col *= 1.0 - 0.12 * step(0.485, max(g.x, g.y));
            #endif
            }
          } else {
            col = vWall;
            float u = abs(vGN.x) > 0.5 ? vGW.z : vGW.x;
            float v = vGW.y;
            float density = vWin.x;
            float floorH = kind > 1.5 ? 2.8 : 3.3;
            vec2 cell = vec2(floor(u / 2.6), floor(v / floorH));
            vec2 f = vec2(fract(u / 2.6), fract(v / floorH));
          #ifdef OLD_ERA
            // Clapboard siding: overlapping boards, each a little different.
            float board = floor(v / 0.26);
            col *= 0.9 + 0.12 * h21(vec2(board, floor(u / 4.0)));
            col *= 1.0 - 0.14 * step(0.82, fract(v / 0.26));
            // Small sash windows: dark panes, a timber frame darker than the wall, a muntin cross.
            float inWin = step(0.3, f.x) * step(f.x, 0.7) * step(0.3, f.y) * step(f.y, 0.78) * step(0.9, v);
            float frame = step(0.26, f.x) * step(f.x, 0.74) * step(0.26, f.y) * step(f.y, 0.82) * step(0.9, v) * (1.0 - inWin);
            float muntin = inWin * max(step(abs(f.x - 0.5), 0.015), step(abs(f.y - 0.54), 0.015));
            float wins = step(1.0 - density, h21(cell * 0.37 + vWin.y));
            float store = 0.0;
            vec3 glass = mix(vec3(0.04, 0.035, 0.03), vec3(0.16, 0.15, 0.13), 0.3 * h21(cell + 3.1));
            col = mix(col, col * 0.55, frame * wins);
            col = mix(col, glass, inWin * wins * 0.92);
            col = mix(col, col * 0.5, muntin * wins);
            // Lamplight: oil lamps, all warm.
            float lit = step(0.5, h21(cell + vWin.y * 7.0)) * inWin * wins * (1.0 - muntin);
            vec3 warm = mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.74, 0.4), h21(cell * 1.3));
          #else
            // Brick/panel texture and floor bands.
            col *= 0.93 + 0.07 * vnoise(vec2(u * 1.7, v * 3.3));
            col *= 1.0 - 0.1 * step(f.y, 0.06) * step(3.0, v);
            float inWin = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.84) * step(2.6, v);
            float frame = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.88) * step(2.6, v) * (1.0 - inWin);
            float wins = step(1.0 - density, h21(cell * 0.37 + vWin.y));
            // Storefront glass on the ground floor of dense buildings.
            float store = step(v, 2.7) * step(0.6, density) * step(0.6, v) * step(0.08, f.x) * step(f.x, 0.92);
            vec3 glass = mix(vec3(0.07, 0.09, 0.12), vec3(0.32, 0.42, 0.52), 0.25 + 0.3 * density + 0.15 * h21(cell + 3.1));
            col = mix(col, col * 1.18, frame * wins);
            col = mix(col, glass, max(inWin * wins, store) * 0.9);
            float lit = step(0.55, h21(cell + vWin.y * 7.0)) * inWin * wins + store * 0.8;
            vec3 warm = mix(vec3(1.0, 0.78, 0.45), vec3(0.75, 0.85, 1.0), step(0.8, h21(cell * 1.3)));
          #endif
            gWindowGlow = warm * lit * uNight * 0.85;
            col *= mix(0.6, 1.0, smoothstep(0.0, 3.5, v));
          }
          diffuseColor.rgb = col;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gWindowGlow;`);
  };
  return { mat, uniforms };
}
