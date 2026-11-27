// The railway (world/railgen.ts). Elevated: a viaduct over the street with two ballasted tracks,
// parapets, a girder face, cross beams on columns at the kerbs; stations with platforms either side
// under canopies, and stair towers on the sidewalks with the station's name. At grade: the track on
// the ground, low platforms with a shelter, and crossbucks where it crosses a street.
import * as THREE from 'three';
import type { City } from '../../shared/world/cityTypes';
import { WORLD } from '../../shared/world/worldSpec';
import { PLATFORM_HALF, railColumns, type Railway, VIADUCT_HALF } from '../../shared/world/railgen';
import { profileZ, type Way } from '../../shared/world/wayTypes';

const STEP = 3;

class Mesher {
  pos: number[] = [];
  uv: number[] = [];
  quad(p: number[][], uv?: number[][]): void {
    const [a, b, c, d] = p;
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const t = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.uv.push(...t[0], ...t[1], ...t[2], ...t[0], ...t[2], ...t[3]);
  }
  /** An axis-aligned box from world corners (three's x, y up, z). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const q = (a: number[], b: number[], c: number[], d: number[]) => this.quad([a, b, c, d]);
    q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
  }
  mesh(mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

/** Ballast with sleepers and rails, `across` metres wide, tiling every 4 m along. */
function trackTexture(across: number, tracks: number[], aniso: number): THREE.CanvasTexture {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b5752'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,18,16' : '190,184,170'},${0.15 + Math.random() * 0.2})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  const px = W / across, py = H / 4;
  for (const t of tracks) {
    const x = (t + across / 2) * px;
    g.fillStyle = '#4a3a2c';
    for (let v = 0.1; v < 4; v += 0.6) g.fillRect(x - 1.3 * px, v * py, 2.6 * px, 0.22 * py);
    g.fillStyle = '#b9bcc0';
    for (const r of [-0.72, 0.72]) g.fillRect(x + r * px - 0.05 * px, 0, 0.1 * px + 1, H);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  return tex;
}

/** A station's name on a sign board. */
function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#123c6b'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffffff'; g.font = 'bold 44px Bahnschrift, Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 256, 50, 490);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RailwayView {
  constructor(scene: THREE.Scene, city: City, isWater: (x: number, y: number) => boolean, aniso = 8) {
    const r = city.railway;
    if (!r) return;
    const way = city.ways.find((w) => w.kind === 'rail' && w.strip === r.strip);
    const lam = (color: string, map?: THREE.Texture) => new THREE.MeshLambertMaterial(map ? { map, side: THREE.DoubleSide } : { color, side: THREE.DoubleSide });
    const across = r.strip ? 2 * VIADUCT_HALF : 2 * (Math.max(...r.tracks.map(Math.abs)) + 1.8);
    const center = r.strip ? 0 : (r.tracks[0] + r.tracks[r.tracks.length - 1]) / 2;
    const tex = trackTexture(across, r.tracks.map((t) => t - center), aniso);
    const bed = new Mesher(), concrete = new Mesher(), steel = new Mesher(), roof = new Mesher();
    const zAt = (a: number) => (way ? profileZ(way, a) : 0.04);
    // Three's (x, height, z) for a point `a` along, `l` across, `dz` above the track.
    const P = (a: number, l: number, dz = 0) => (r.axis === 'h' ? [a, zAt(a) + dz, r.pos + l] : [r.pos + l, zAt(a) + dz, a]);
    const a0 = way ? way.a0 : r.a0 - 60, a1 = way ? way.a1 : r.a1 + 60;
    const st: number[] = [];
    for (let a = a0; a < a1; a += STEP) st.push(a);
    if (way) for (const [a] of way.profile) if (a > a0 && a < a1) st.push(a);
    st.push(a1);
    st.sort((p, q) => p - q);
    const L = center - across / 2, R = center + across / 2;
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      bed.quad([P(a, L), P(a, R), P(b, R), P(b, L)], [[0, a / 4], [1, a / 4], [1, b / 4], [0, b / 4]]);
      if (!r.strip) continue;
      for (const sd of [L, R]) {
        // Parapet and the girder's face below the deck's edge.
        concrete.quad([P(a, sd), P(b, sd), P(b, sd, 0.8), P(a, sd, 0.8)]);
        concrete.quad([P(a, sd), P(b, sd), P(b, sd, -1.3), P(a, sd, -1.3)]);
      }
    }
    if (r.strip) this.structure(r, way!, P, steel, concrete, roof, city, isWater, scene);
    else this.grade(r, P, concrete, roof, city);
    // An older era's platforms are planks under a shingled roof (WORLD.modern off).
    const deck = WORLD.modern ? '#9a958c' : '#7a5a3a', cover = WORLD.modern ? '#2f3a44' : '#4a3a2a';
    for (const [m, mat] of [[bed, lam('', tex)], [concrete, lam(deck)], [steel, lam('#4f5d6b')], [roof, lam(cover)]] as const) {
      if (m.pos.length) scene.add(m.mesh(mat));
    }
  }

  private structure(r: Railway, way: Way, P: (a: number, l: number, dz?: number) => number[], steel: Mesher, concrete: Mesher, roof: Mesher, city: City, isWater: (x: number, y: number) => boolean, scene: THREE.Scene): void {
    // Columns at the kerbs and a cross beam between each pair, under the deck.
    const cols = railColumns(r, city.nodes, isWater);
    for (const c of cols) {
      const a = r.axis === 'h' ? c.x : c.y, z = profileZ(way, a) - 1.3;
      steel.box(c.x - 0.3, 0, c.y - 0.3, c.x + 0.3, z, c.y + 0.3);
    }
    for (let k = 0; k + 1 < cols.length; k += 2) {
      const c = cols[k], d = cols[k + 1];
      const a = r.axis === 'h' ? c.x : c.y, z = profileZ(way, a) - 1.3;
      steel.box(Math.min(c.x, d.x) - 0.35, z - 0.7, Math.min(c.y, d.y) - 0.35, Math.max(c.x, d.x) + 0.35, z, Math.max(c.y, d.y) + 0.35);
    }
    // Stations: a platform each side, a canopy over it on posts, stair towers down to the sidewalk.
    for (const s of r.stations) {
      const z0 = profileZ(way, s.a);
      const A0 = s.a - s.half, A1 = s.a + s.half;
      for (const sd of [1, -1]) {
        const i = sd * VIADUCT_HALF, o = sd * PLATFORM_HALF, lo = Math.min(i, o), hi = Math.max(i, o);
        const corner = (a: number, l: number, dz: number) => P(a, l, dz - (profileZ(way, a) - z0));
        concrete.quad([corner(A0, lo, 0.95), corner(A0, hi, 0.95), corner(A1, hi, 0.95), corner(A1, lo, 0.95)]);
        concrete.quad([corner(A0, o, 0.95), corner(A1, o, 0.95), corner(A1, o, -0.4), corner(A0, o, -0.4)]);
        concrete.quad([corner(A0, o, 0.95), corner(A1, o, 0.95), corner(A1, o, 2.0), corner(A0, o, 2.0)]);
        roof.quad([corner(A0, lo - sd * 0.2, 4.4), corner(A0, hi, 4.1), corner(A1, hi, 4.1), corner(A1, lo - sd * 0.2, 4.4)]);
        for (let a = A0 + 2; a < A1; a += 7) {
          const p = corner(a, o - sd * 0.3, 0.95);
          steel.box(p[0] - 0.08, p[1], p[2] - 0.08, p[0] + 0.08, p[1] + 3.3, p[2] + 0.08);
        }
      }
      for (const t of s.towers) {
        concrete.box(t.x0, 0, t.y0, t.x1, z0 + 2, t.y1);
        roof.box(t.x0 - 0.2, z0 + 2, t.y0 - 0.2, t.x1 + 0.2, z0 + 2.25, t.y1 + 0.2);
        // A walkway from the tower's top across to the platform.
        const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
        const g = r.axis === 'h' ? { x: cx, y: r.pos + Math.sign(cy - r.pos) * PLATFORM_HALF } : { x: r.pos + Math.sign(cx - r.pos) * PLATFORM_HALF, y: cy };
        concrete.box(Math.min(cx, g.x) - 1, z0 + 0.8, Math.min(cy, g.y) - 1, Math.max(cx, g.x) + 1, z0 + 0.95, Math.max(cy, g.y) + 1);
        // The station's name over the door.
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.75), new THREE.MeshBasicMaterial({ map: signTexture(s.name), side: THREE.DoubleSide }));
        sign.rotation.x = -Math.PI / 2;
        if (r.axis === 'v') sign.rotation.z = Math.PI / 2;
        sign.position.set(cx, z0 + 2.3, cy);
        scene.add(sign);
      }
    }
  }

  private grade(r: Railway, P: (a: number, l: number, dz?: number) => number[], concrete: Mesher, roof: Mesher, city: City): void {
    void city;
    for (const s of r.stations) {
      for (const e of s.exits) {
        const l = r.axis === 'h' ? e.y - r.pos : e.x - r.pos;
        const lo = l - 1.6, hi = l + 1.6;
        concrete.quad([P(s.a - s.half, lo, 0.35), P(s.a - s.half, hi, 0.35), P(s.a + s.half, hi, 0.35), P(s.a + s.half, lo, 0.35)]);
        roof.quad([P(s.a - 5, lo, 3.2), P(s.a - 5, hi, 3.2), P(s.a + 5, hi, 3.2), P(s.a + 5, lo, 3.2)]);
      }
    }
    // Crossbucks either side where it crosses a street.
    for (const a of r.crossings) {
      for (const sd of [-1, 1]) {
        const p = P(a + sd * 6, r.tracks[0] + sd * 3.2);
        concrete.box(p[0] - 0.08, 0, p[2] - 0.08, p[0] + 0.08, 3, p[2] + 0.08);
      }
    }
  }
}
