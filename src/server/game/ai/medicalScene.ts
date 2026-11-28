// Dispatch and the crew use the same fixed scene boundary. New casualties inside
// it join this call without moving its centre or dispatching another ambulance.
import { dist2 } from '../../../shared/math';
import type { Ped } from '../entities';
import type { World } from '../world';

export const MEDICAL_RADIUS = 30;
/** Renewed on successful treatment so a busy scene can outlast a stalled call. */
export const MEDICAL_TIMEOUT = 180;
export const needsMedic = (p: Ped): boolean => p.dead && !p.player && !p.revived;

/** Choose the closest unclaimed patient. A spare medic waits while the crew
 * works, so the driver doesn't leave a partner at the scene. */
export function nextPatient(w: World, medic: Ped): boolean {
  const ai = medic.ai!;
  const scene = w.squads.get(ai.squad)?.incident;
  if (!scene) return false;
  const claimed = new Set<number>();
  for (const s of w.squads.values()) {
    if (s.key !== 'medic') continue;
    for (const id of s.members) {
      const partner = w.peds.get(id);
      if (partner && partner !== medic && !partner.dead && partner.ai?.task === 'revive') claimed.add(partner.ai.target);
    }
  }
  let nearest = Infinity, patient = 0, waiting = false;
  w.pedsNear(scene.x, scene.y, MEDICAL_RADIUS, p => {
    if (!needsMedic(p)) return;
    waiting = true;
    const d = dist2(medic.body.x, medic.body.y, p.body.x, p.body.y);
    if (p.deadT >= 3 && !claimed.has(p.id) && d < nearest) { nearest = d; patient = p.id; }
  });
  ai.target = patient;
  ai.workT = 0;
  return waiting;
}
