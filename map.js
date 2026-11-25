// Shared arena maps + physics helpers. Imported by the browser client AND the
// Node server, so hit detection / line of sight are identical on both sides.
// All maps are LINEAR THREE-LANE layouts (left / middle / right lanes joined by
// a few crossings, spawns at the two ends), mostly open sightlines for skill PvP.

export const WALL_H = 4;

// Each map: width (x) * length (z). Built from simple rules for symmetry.
export const MAPS = {
  carriles: {
    name: 'Tres Carriles', desc: 'Clásico: 3 carriles, 3 cruces, casi sin cobertura.',
    w: 21, l: 52,
    build(set, m) {
      // lane dividers at x=7 and x=13, crossings at z 15-17, 25-27, 35-37
      for (let z = 7; z < m.l - 7; z++) {
        const gap = (z >= 15 && z <= 17) || (z >= 25 && z <= 27) || (z >= 34 && z <= 36);
        if (!gap) { set(7, z, 3, 2); set(13, z, 3, 2); }
      }
      // a couple of low crates (jumpable) per side lane, mirrored
      for (const [x, z] of [[3, 12], [17, 12], [10, 21], [3, 30], [17, 30], [10, 39]]) set(x, z, 1, 3);
    },
  },
  puente: {
    name: 'Puente Neon', desc: 'Carril central abierto y largo; laterales con muros bajos.',
    w: 23, l: 56,
    build(set, m) {
      for (let z = 8; z < m.l - 8; z++) {
        const gap = (z >= 18 && z <= 20) || (z >= 35 && z <= 37);
        if (!gap) { set(6, z, 3, 2); set(16, z, 3, 2); }
      }
      // low walls (height 1) across the side lanes = partial cover you can jump
      for (const z of [14, 28, 42]) for (let x = 1; x < 4; x++) { set(x, z, 1, 3); set(m.w - 1 - x, z, 1, 3); }
      // two pillars at the middle-lane ends (only real hiding spots)
      set(11, 12, 3, 2); set(11, m.l - 13, 3, 2);
    },
  },
  zigzag: {
    name: 'Zigzag', desc: 'Carriles más estrechos con cruces alternados.',
    w: 19, l: 48,
    build(set, m) {
      for (let z = 6; z < m.l - 6; z++) {
        const gapL = (z >= 12 && z <= 14) || (z >= 30 && z <= 32);
        const gapR2 = (z >= 15 && z <= 17) || (z >= 33 && z <= 35);
        if (!gapL) set(6, z, 3, 2);
        if (!gapR2) set(12, z, 3, 2);
      }
      for (const [x, z] of [[9, 9], [9, 38], [3, 24], [15, 24]]) set(x, z, 1, 3);
    },
  },
};
export const DEFAULT_MAP = 'carriles';

export function createMap(id = DEFAULT_MAP) {
  const def = MAPS[id] || MAPS[DEFAULT_MAP];
  const W = def.w, L = def.l;
  const heights = new Uint8Array(W * L);
  const kind = new Uint8Array(W * L); // 0 floor,1 wall,2 pillar/divider,3 crate
  const set = (i, j, h, k) => { if (i >= 0 && j >= 0 && i < W && j < L) { heights[i + j * W] = h; kind[i + j * W] = k; } };
  for (let i = 0; i < W; i++) for (let j = 0; j < L; j++)
    if (i === 0 || j === 0 || i === W - 1 || j === L - 1) set(i, j, WALL_H, 1);
  def.build(set, { w: W, l: L });

  const m = { id: MAPS[id] ? id : DEFAULT_MAP, name: def.name, w: W, l: L, heights, kind };
  m.heightAtCell = (i, j) => (i < 0 || j < 0 || i >= W || j >= L) ? WALL_H : heights[i + j * W];
  m.heightAt = (x, z) => m.heightAtCell(Math.floor(x), Math.floor(z));
  m.groundUnder = (x, z, r) => {
    let h = 0;
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++)
      for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) h = Math.max(h, m.heightAtCell(i, j));
    return h;
  };
  m.blocked = (x, z, r, feetY) => m.groundUnder(x, z, r) > feetY + 0.05;
  m.moveCircle = (pos, dx, dz, r) => {
    if (!m.blocked(pos.x + dx, pos.z, r, pos.y)) pos.x += dx;
    if (!m.blocked(pos.x, pos.z + dz, r, pos.y)) pos.z += dz;
  };
  m.rayWallDistance = (o, d, maxDist) => {
    for (let t = 0; t < maxDist; t += 0.05) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= 0 || m.heightAt(x, z) > y) return t;
    }
    return maxDist;
  };
  m.lineOfSight = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    return m.rayWallDistance(a, { x: dx / len, y: dy / len, z: dz / len }, len) >= len - 0.05;
  };
  // Spawns at the two ends of the three lanes. side 0 = south end, 1 = north end.
  const lanesX = [Math.round(W * 0.17) + 0.5, Math.floor(W / 2) + 0.5, W - 1 - Math.round(W * 0.17) + 0.5];
  m.spawns = [[], []];
  for (const x of lanesX) for (const dz of [2.5, 4.5]) {
    if (m.groundUnder(x, dz, 0.5) === 0) m.spawns[0].push([x, dz]);
    if (m.groundUnder(x, L - dz, 0.5) === 0) m.spawns[1].push([x, L - dz]);
  }
  m.freeCells = () => {
    const out = [];
    for (let i = 1; i < W - 1; i++) for (let j = 1; j < L - 1; j++)
      if (m.groundUnder(i + 0.5, j + 0.5, 0.6) === 0) out.push([i + 0.5, j + 0.5]);
    return out;
  };
  return m;
}

// Ray vs axis-aligned box; returns distance or -1.
export function rayBox(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return -1; continue; }
    let t1 = (min[k] - o[k]) / d[k], t2 = (max[k] - o[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmax < 0 ? -1 : Math.max(tmin, 0);
}

// Player / bot hitboxes relative to feet position: body + head (head = x2 damage)
export const BODY = { r: 0.35, h: 1.35 };
export const HEAD = { r: 0.25, y0: 1.35, y1: 1.85 };
export function rayHitPlayer(o, d, p) {
  const tb = rayBox(o, d, { x: p.x - BODY.r, y: p.y, z: p.z - BODY.r }, { x: p.x + BODY.r, y: p.y + BODY.h, z: p.z + BODY.r });
  const th = rayBox(o, d, { x: p.x - HEAD.r, y: p.y + HEAD.y0, z: p.z - HEAD.r }, { x: p.x + HEAD.r, y: p.y + HEAD.y1, z: p.z + HEAD.r });
  if (th >= 0 && (tb < 0 || th <= tb)) return { t: th, head: true };
  if (tb >= 0) return { t: tb, head: false };
  return null;
}
