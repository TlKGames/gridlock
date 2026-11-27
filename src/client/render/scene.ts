// three.js scene, lights and the day/night cycle. World (x, y) maps to three (x, height, y).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'high' | 'medium' | 'low';

export interface Lighting {
  night: number;          // 0 day .. 1 full night
  hour: number;
}

const SKY_DAY = new THREE.Color('#9fb4c4');
const SKY_NIGHT = new THREE.Color('#0d1220');

const SUN_DAY = new THREE.Color('#fff2dc');
const SUN_TWILIGHT = new THREE.Color('#ff9a5a');
const MOON = new THREE.Color('#7f9cff');
const AMBIENT_DAY = new THREE.Color('#cfe0ff');
const AMBIENT_NIGHT = new THREE.Color('#7d90c8');
const GROUND_DAY = new THREE.Color('#4a4438');
const GROUND_NIGHT = new THREE.Color('#2a2c3a');

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  readonly hemi = new THREE.HemisphereLight('#cfe0ff', '#4a4438', 1.1);
  readonly flash: THREE.PointLight[] = [];
  readonly lighting: Lighting = { night: 0, hour: 12 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Wide lens close to the ground: buildings lean out from the centre like GTA2's.
    this.camera = new THREE.PerspectiveCamera(50, 1, 1.5, 900);
    this.camera.up.set(0, 0, -1);
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 10; sc.far = 500;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    // A small pool of point lights for explosions and muzzle flashes (fixed count: no shader recompiles).
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb060', 0, 40, 1.6);
      this.flash.push(l);
      this.scene.add(l);
    }
    this.scene.fog = new THREE.Fog(SKY_DAY, 500, 900);
    // Soft studio environment so car paint, glass and chrome pick up reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  quality: Quality = 'high';
  private shadowHalf = 140;

  /** Fits the sun's shadow frustum to the visible area (fewer casters, sharper shadows). */
  fitShadow(viewHalf: number): void {
    // Margin so tall buildings just off-screen still cast into view.
    const want = Math.min(180, Math.max(70, Math.ceil((viewHalf + 45) / 10) * 10));
    if (want === this.shadowHalf) return;
    this.shadowHalf = want;
    const sc = this.sun.shadow.camera;
    sc.left = -want; sc.right = want; sc.top = want; sc.bottom = -want;
    sc.updateProjectionMatrix();
  }

  /** Trades resolution and shadow quality for speed. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    const shadowsBefore = this.renderer.shadowMap.enabled;
    this.quality = q;
    const r = this.renderer;
    const size = q === 'high' ? 2048 : 1024;
    r.shadowMap.enabled = q !== 'low';
    r.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Shadow on/off changes shader variants.
    if (shadowsBefore !== r.shadowMap.enabled || q !== 'high') {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; }); else if (m) m.needsUpdate = true;
      });
    }
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const cap = this.quality === 'high' ? 1.75 : this.quality === 'medium' ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sun arc, colours and ambient from the in-game clock (minutes since midnight). */
  setTime(gameMinutes: number, focusX: number, focusY: number): void {
    const hour = gameMinutes / 60;
    const s = Math.sin(((hour - 6) / 12) * Math.PI);                       // -1 midnight .. 1 noon
    const day = Math.max(0, s);
    const twilight = Math.max(0, 1 - Math.abs(hour - 18.3) / 1.2) + Math.max(0, 1 - Math.abs(hour - 6) / 1.2);
    // Night falls quickly around 18:00-19:00 and lifts around 5:30-6:30.
    const night = 1 - THREE.MathUtils.smoothstep(s, -0.16, 0.12);
    this.lighting.night = night;
    this.lighting.hour = hour;
    const az = ((hour - 6) / 12) * Math.PI;
    const elev = 0.35 + day * 0.9;
    const dir = new THREE.Vector3(Math.cos(az) * 0.8, elev, 0.45 + Math.sin(az) * 0.2).normalize();
    this.sun.position.set(focusX + dir.x * 220, dir.y * 220, focusY + dir.z * 220);
    this.sun.target.position.set(focusX, 0, focusY);
    // Keep the warm horizon light into twilight, then blend it into moonlight.
    const moonlight = THREE.MathUtils.smoothstep(night, 0.25, 1);
    this.sun.color.lerpColors(SUN_DAY, SUN_TWILIGHT, twilight).lerp(MOON, moonlight);
    this.sun.intensity = 0.9 + day * 1.6;
    this.hemi.intensity = 0.95 + day * 0.3 - night * 0.05;
    this.hemi.color.lerpColors(AMBIENT_DAY, AMBIENT_NIGHT, night);
    this.hemi.groundColor.lerpColors(GROUND_DAY, GROUND_NIGHT, night);
    const sky = (this.scene.fog as THREE.Fog).color.lerpColors(SKY_DAY, SKY_NIGHT, night);
    this.renderer.setClearColor(sky);
    this.renderer.toneMappingExposure = 1.05 + night * 0.25;
    this.scene.environmentIntensity = 0.15 + day * 0.65;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
