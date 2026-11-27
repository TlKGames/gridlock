// Shared screen-door pattern: openings match through every layer of an overhead structure.
import * as THREE from 'three';

export class OverheadFade {
  protected focus = { value: new THREE.Vector4() };
  protected bounds = new THREE.Vector4(-1e9, -1e9, 1e9, 1e9);
  private variants = new WeakMap<THREE.Material, THREE.Material>();

  material(source: THREE.Material): THREE.Material {
    const cached = this.variants.get(source);
    if (cached) return cached;
    const mat = source.clone();
    mat.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile(shader, renderer);
      shader.uniforms.uCutawayBounds = { value: this.bounds };
      shader.uniforms.uCutawayFocus = this.focus;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutawayPosition;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 cutawayPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cutawayPosition = instanceMatrix * cutawayPosition;
          #endif
          vCutawayPosition = (modelMatrix * cutawayPosition).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutawayPosition;\nuniform vec4 uCutawayFocus;\nuniform vec4 uCutawayBounds;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (uCutawayFocus.w > 0.0 && vCutawayPosition.y > uCutawayFocus.y + 0.5 &&
              all(greaterThanEqual(vCutawayPosition.xz, uCutawayBounds.xy)) && all(lessThanEqual(vCutawayPosition.xz, uCutawayBounds.zw))) {
            float mask = uCutawayFocus.w * (1.0 - smoothstep(7.8, 13.0, distance(vCutawayPosition.xz, uCutawayFocus.xz)));
            float pattern = mod(floor(gl_FragCoord.x) + 2.0 * floor(gl_FragCoord.y), 4.0);
            if (pattern + 0.5 < 3.0 * mask) discard;
          }`);
    };
    mat.customProgramCacheKey = () => source.customProgramCacheKey() + '-overhead-cutaway';
    this.variants.set(source, mat);
    return mat;
  }
}
