// Road paint in world metres. Each stripe is a lit quad, batched by map tile.
import * as THREE from 'three';
import type { CityMap } from '../../shared/world/city';
import { LANE_W } from '../../shared/world/cityTypes';
import { WORLD } from '../../shared/world/worldSpec';
import { tileKey } from './instancing';

const WHITE = '#e8e6df', YELLOW = '#e2b93b';
const CROSSWALK = '#d1cfc9', PARKING_EDGE = '#92928e', STALL = '#a3a49d';

export function buildRoadMarkings(scene: THREE.Scene, map: CityMap): void {
  if (!WORLD.modern) return;
  const mat = new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mat.vertexColors = true;
  const tiles = new Map<number, { positions: number[]; colors: number[]; indices: number[] }>();
  const tint = new THREE.Color();
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    const key = tileKey(x + w / 2, y + h / 2);
    let tile = tiles.get(key);
    if (!tile) { tile = { positions: [], colors: [], indices: [] }; tiles.set(key, tile); }
    const i = tile.positions.length / 3, z = 0.005;
    tile.positions.push(x, z, y, x, z, y + h, x + w, z, y + h, x + w, z, y);
    tint.set(color);
    for (let v = 0; v < 4; v++) tile.colors.push(tint.r, tint.g, tint.b);
    tile.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };

  const city = map.city;
  for (const s of city.segs) {
    if (s.trail) continue;
    const a = city.nodes[s.a], b = city.nodes[s.b], horizontal = s.axis === 'h';
    const start = horizontal ? s.x0 + a.wv / 2 + 0.5 : s.y0 + a.wh / 2 + 0.5;
    const end = horizontal ? s.x1 - b.wv / 2 - 0.5 : s.y1 - b.wh / 2 - 0.5;
    // Coordinates along/across the road. Bridge decks provide their own raised paint.
    const strip = (from: number, to: number, side: number, width: number, color: string) => {
      if (to <= from) return;
      if (horizontal) rect(from, s.y0 + side, to - from, width, color);
      else rect(s.x0 + side, from, width, to - from, color);
    };
    const line = (off: number, width: number, color: string, dash = Infinity, gap = 0) => {
      for (let at = start; at < end; at += dash + gap) {
        // Keep the dash phase along the segment, but leave the crossing and stop bar clear.
        const from = Math.max(at, start + (a.lights ? 3 : 0));
        const stop = Math.min(end - (b.lights ? 3 : 0), at + dash), side = off - width / 2;
        if (s.bridge && map.river) {
          strip(from, Math.min(stop, map.river.y0), side, width, color);
          strip(Math.max(from, map.river.y1), stop, side, width, color);
        } else strip(from, stop, side, width, color);
      }
    };
    if (s.lanes > 1) {
      line(-0.2, 0.15, YELLOW);
      line(0.2, 0.15, YELLOW);
      line(-LANE_W, 0.15, WHITE, 3, 6);
      line(LANE_W, 0.15, WHITE, 3, 6);
    } else {
      line(0, 0.15, YELLOW, 3, 4);
      if (s.parking) {
        line(-LANE_W, 0.12, PARKING_EDGE);
        line(LANE_W, 0.12, PARKING_EDGE);
      }
    }
    const lanes = s.lanes * LANE_W;
    // At a bridge the stop bar fits between the last zebra stripe and the deck joint.
    const barWidth = s.bridge ? 0.25 : 0.4;
    const near = s.bridge && map.river ? map.river.y0 - barWidth : start + (a.lights ? 2.6 : 0);
    const far = s.bridge && map.river ? map.river.y1 + barWidth : end - (b.lights ? 2.6 : 0);
    if (a.segs.length > 2) strip(near, near + barWidth, horizontal ? -0.2 - lanes : 0.2, lanes, WHITE);
    if (b.segs.length > 2) strip(far - barWidth, far, horizontal ? 0.2 : -0.2 - lanes, lanes, WHITE);
    for (const n of [a, b]) {
      if (!n.lights) continue;
      const direction = n === a ? 1 : -1;
      const edge = (horizontal ? n.wv : n.wh) / 2 + 0.3;
      const at = (horizontal ? n.x : n.y) + direction * edge - (direction < 0 ? 2.4 : 0);
      for (let off = -s.width / 2 + 0.6; off < s.width / 2 - 0.6; off += 1.2) {
        strip(at, at + 2.4, off, 0.6, CROSSWALK);
      }
    }
  }

  for (const lot of city.lots) {
    if (lot.use !== 'parking') continue;
    const r = lot.rect, alongX = r.x1 - r.x0 >= r.y1 - r.y0;
    const length = alongX ? r.x1 - r.x0 : r.y1 - r.y0;
    for (let at = 1.5; at < length - 1.5; at += 2.9) {
      if (alongX) {
        rect(r.x0 + at - 0.075, r.y0 + 1.5, 0.15, 5.4, STALL);
        rect(r.x0 + at - 0.075, r.y1 - 6.9, 0.15, 5.4, STALL);
      } else {
        rect(r.x0 + 1.5, r.y0 + at - 0.075, 5.4, 0.15, STALL);
        rect(r.x1 - 6.9, r.y0 + at - 0.075, 5.4, 0.15, STALL);
      }
    }
  }
  for (const tile of tiles.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tile.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(tile.colors, 3));
    geo.setIndex(tile.indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
