// Shared arena maps + physics helpers. Imported by the browser client AND the
// Node server, so hit detection / line of sight are identical on both sides.
// Most maps are LINEAR THREE-LANE layouts (left / middle / right lanes joined by
// a few crossings, spawns at the two ends). 'barrio' is a compact suburb arena
// with 180°-rotational symmetry (two houses facing across a street).

export const WALL_H = 4;
// Max height a player/bot walks up without jumping (0.5-high stairs/ramps are walkable,
// 1-high crates still need a jump).
export const STEP = 0.55;

// Block kinds: 0 floor, 1 outer wall, 2 divider/pillar, 3 crate, 4 platform/catwalk, 5 stairs/ramp, 6 accent cover,
// 7/8 optional glowing (unlit) blocks: windows, neon trims, lights. A theme lists them in `glow`.
// Color themes (blocky neon). Maps without a theme use DEFAULT_THEME.
export const DEFAULT_THEME = {
  floor: ['#0f2a22', '#14f195'], bg: 0x120626,
  1: ['#2a1450', '#9945ff'], 2: ['#3b1d6e', '#14f195'], 3: ['#5a3a1a', '#ffb347'],
  4: ['#1d3550', '#3fe3ff'], 5: ['#2d2d4a', '#c9a6ff'], 6: ['#4a1240', '#ff3df2'],
  strip: 0x14f195, preview: ['#0b1a24', '#3fe3ff', '#9fb4c4', '#ffb347', '#5aa0ff', '#c9a6ff', '#ff3df2'],
};

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
  fortaleza: {
    name: 'Fortaleza Ámbar', desc: 'Fuerte central elevado, carriles con plataformas y pasillos de flanqueo.',
    w: 27, l: 60, lanes: [6.5, 13.5, 20.5],
    theme: {
      floor: ['#2a1a0a', '#ffb347'], bg: 0x1a0c04,
      1: ['#3a2410', '#ff8c1a'], 2: ['#4a2e12', '#ffd27a'], 3: ['#20303a', '#3fe3ff'],
      4: ['#5a3a12', '#ffcf5a'], 5: ['#6a4a1e', '#fff1c2'], 6: ['#123a3a', '#3fe3ff'],
      strip: 0xff9d2e, preview: ['#2a1a0a', '#ff8c1a', '#ffd27a', '#3fe3ff', '#ffcf5a', '#fff1c2', '#3fe3ff'],
    },
    build(set, m, h) {
      const L = m.l;
      // flanking corridors (x 1-2 / 24-25) behind walls with doorways
      h.mirrorZ((z) => { const door = (z >= 11 && z <= 12) || (z >= 21 && z <= 22); if (z >= 6 && !door && z !== 29 && z !== 30) h.symX(3, z, 3, 2); }, 6, L / 2);
      // lane dividers x=9 / x=17 with 3 crossings
      h.mirrorZ((z) => { const gap = (z >= 17 && z <= 19) || (z >= 28 && z <= 31); if (!gap) h.symX(9, z, 3, 2); }, 7, L / 2);
      // central fort: 1.5-high platform with 0.5 stairs north+south and cover walls on top
      h.fill(11, 15, 25, 34, 1.5, 4);
      for (let k = 0; k < 3; k++) { h.fill(11, 15, 22 + k, 22 + k, 0.5 * (k + 1) - 0, 5); h.fill(11, 15, 37 - k, 37 - k, 0.5 * (k + 1), 5); }
      h.fill(11, 11, 27, 32, 2.5, 6); h.fill(15, 15, 27, 32, 2.5, 6); // side parapets (1 above deck)
      h.fill(13, 13, 29, 30, 2.5, 6);                                    // centre cover block
      // side-lane platforms (height 1) reached by 0.5 steps; varied crates
      h.mirrorZ((z) => {
        if (z >= 13 && z <= 20) h.fillSymX(5, 7, z, z, 1, 4);
        if (z === 12 || z === 21) h.fillSymX(5, 7, z, z, 0.5, 5);
      }, 6, L / 2);
      for (const [x, z, hh] of [[4, 9, 1], [8, 24, 1.5], [6, 26, 0.5], [12, 12, 1], [14, 15, 0.5]]) h.sym(x, z, hh, 3);
    },
  },
  ciudadela: {
    name: 'Ciudadela Carmesí', desc: 'Foso central, carriles altos, pasarelas sobre los muros y flancos estrechos.',
    w: 25, l: 56, lanes: [4.5, 12.5, 20.5],
    theme: {
      floor: ['#1a0610', '#ff3d6e'], bg: 0x14030a,
      1: ['#2a0818', '#ff2e63'], 2: ['#3a0c22', '#3fe3ff'], 3: ['#102a3a', '#3fe3ff'],
      4: ['#4a1028', '#ff8fb1'], 5: ['#5a1a30', '#ffd1df'], 6: ['#0e2e3e', '#7df9ff'],
      strip: 0xff2e63, preview: ['#1a0610', '#ff2e63', '#3fe3ff', '#3fe3ff', '#ff8fb1', '#ffd1df', '#7df9ff'],
    },
    build(set, m, h) {
      const L = m.l;
      // raised side lanes (h 1) from z 7..L-8, entered by a 0.5 step from the spawn ends
      h.mirrorZ((z) => {
        if (z === 6) { h.fillSymX(1, 7, z, z, 0.5, 5); return; }
        h.fillSymX(1, 7, z, z, 1, 4);
      }, 6, L / 2);
      // catwalks on top of the lane walls (x 8 / 16, height 2) with gaps = ramps down into the trench
      h.mirrorZ((z) => {
        const ramp = (z >= 16 && z <= 18);
        if (ramp) h.symX(8, z, 0.5, 5);
        else h.symX(8, z, 2, 4);
      }, 8, L / 2);
      // stairs side-lane -> catwalk (1 -> 1.5 -> catwalk 2)
      h.mirrorZ((z) => { if ((z >= 23 && z <= 24) || (z >= 10 && z <= 11)) h.symX(7, z, 1.5, 5); }, 6, L / 2);
      // trench exits into the side lanes at the ramp gaps: 0.5 step on the lane side
      h.mirrorZ((z) => { if (z >= 16 && z <= 18) h.symX(7, z, 1, 4); }, 6, L / 2);
      // narrow flank corridors (x 1-2) behind a low wall (h 2.5) with openings
      h.mirrorZ((z) => { const open = (z >= 12 && z <= 13) || (z >= 25 && z <= 27); if (z >= 8 && !open) h.symX(3, z, 2.5, 6); }, 6, L / 2);
      // trench cover: pillars + crates of different heights
      for (const [x, z, hh, k] of [[10, 12, 3, 2], [12, 22, 1, 3], [11, 27, 0.5, 3], [10, 31, 1.5, 3]]) h.sym(x, z, hh, k);
    },
  },
  barrio: {
    name: 'Barrio Neón', desc: 'Dos casas de dos pisos frente a frente, calle con autos y bus, patios y garajes.',
    w: 33, l: 46, lanes: [6.5, 16.5, 26.5],
    theme: {
      floor: ['#140a24', '#3fe3ff'], bg: 0x0d0618,
      1: ['#1c0f33', '#ff3df2'], 2: ['#2a1650', '#3fe3ff'], 3: ['#1e2a3a', '#7df9ff'],
      4: ['#3a1f5e', '#ff3df2'], 5: ['#2d2d4a', '#c9a6ff'], 6: ['#4a1240', '#ff3df2'],
      7: ['#0f8fae', '#7df9ff'], 8: ['#b0249f', '#ff8af6'], glow: [7, 8],
      strip: 0xff3df2, preview: ['#140a24', '#ff3df2', '#7b4fd6', '#7df9ff', '#b07dff', '#c9a6ff', '#ff3df2', '#3fe3ff', '#ff8af6'],
    },
    // 180° rotational symmetry: every block written at (x,z) is also written at (W-1-x, L-1-z),
    // so the south team's house/garage/backyard match the north team's exactly.
    build(set, m) {
      const W = m.w, L = m.l;
      const R = (x0, x1, z0, z1, hh, k) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { set(x, z, hh, k); set(W - 1 - x, L - 1 - z, hh, k); } };
      const WALL = 4, WIN = 2.9, SILL = 1;
      // ---- house (x 4..15, z 6..15): ground-floor rooms + upstairs loft (h 2) with street windows
      R(4, 15, 6, 6, WALL, 2); R(9, 10, 6, 6, 0, 0);                 // back wall + back door
      R(4, 4, 6, 15, WALL, 2); R(4, 4, 11, 13, WIN, 7);             // west wall + upstairs side windows
      R(15, 15, 6, 15, WALL, 2); R(15, 15, 7, 8, 0, 0); R(15, 15, 12, 12, SILL, 7); // east wall, side door, window
      R(4, 15, 15, 15, WALL, 2);                                     // front wall (street side)
      R(5, 9, 15, 15, WIN, 7);                                       // upstairs front windows over the street
      R(12, 13, 15, 15, 0, 0); R(11, 11, 15, 15, SILL, 7); R(14, 14, 15, 15, SILL, 7); // front door + ground windows
      R(5, 9, 10, 14, 2, 4);                                         // upstairs loft floor
      R(5, 6, 7, 7, 0.5, 5); R(5, 6, 8, 8, 1, 5); R(5, 6, 9, 9, 1.5, 5); // stairs up to the loft
      R(10, 10, 10, 11, WIN, 8);                                     // loft railing (drop to living room at z 12-14)
      R(12, 14, 7, 7, SILL, 3);                                      // kitchen counter
      R(12, 12, 11, 12, 0.8, 3);                                     // sofa
      // ---- garage (x 19..27, z 9..15): open door to the street, side door, parked car
      R(19, 27, 9, 9, WALL, 2); R(19, 19, 9, 15, WALL, 2); R(19, 19, 11, 12, 0, 0); R(27, 27, 9, 15, WALL, 2);
      R(19, 20, 15, 15, WALL, 2); R(26, 27, 15, 15, WALL, 2); R(21, 25, 15, 15, 0, 0);
      R(22, 24, 11, 13, 1.2, 6); R(22, 22, 13, 13, 1.2, 8); R(24, 24, 13, 13, 1.2, 8); // car + headlights
      R(26, 26, 10, 12, 1.5, 3);                                     // tool shelves
      // ---- backyards: shed, low fences (spawn cells x 6-7 / 16-17 / 26-27, z 2-5 stay clear)
      R(12, 14, 1, 2, 2.5, 3); R(11, 14, 4, 4, 1.2, 3); R(19, 19, 1, 3, 1.2, 3);
      R(29, 31, 1, 2, 2.5, 3); R(20, 24, 7, 7, 1.2, 3); R(21, 21, 4, 4, 1, 3);
      R(1, 2, 8, 8, 1, 3); R(30, 31, 6, 6, 1, 3);                    // side-path crates
      // ---- street (z 16..29): bus in the middle, cars, planters
      R(13, 19, 22, 23, 2.2, 6); for (const x of [14, 16, 18]) R(x, x, 22, 23, 2.2, 7); // bus with lit windows
      R(7, 9, 18, 19, 1.2, 6); R(9, 9, 18, 19, 1.2, 7);             // car + lights
      R(22, 24, 17, 18, 1.2, 6); R(22, 22, 17, 18, 1.2, 8);         // driveway car
      R(3, 4, 21, 21, 0.8, 3); R(11, 11, 19, 19, 0.8, 3); R(27, 27, 20, 20, 0.8, 3); // planters / mailbox
    },
  },
};
export const DEFAULT_MAP = 'carriles';

// Non-playable hub maps (not in votes / map pickers).
// HQ: walkable third-person base. Spawn helipad (south), weapon bench (west),
// firing range (east), stream + bridge, vehicle bay and 5 mode portals (north wall).
export const HQ_PORTALS = [
  { mode: 'tdm', x: 3 }, { mode: 'ffa', x: 9 }, { mode: 'dom', x: 15 }, { mode: 'snd', x: 21 }, { mode: 'ctf', x: 27 },
].map((p) => ({ ...p, x0: p.x, x1: p.x + 1, z: 36 }));
export const HQ_BENCH = { x: 7.5, z: 16.5, r: 2.4 };
export const HQ_RANGE = { x0: 21, x1: 31, z0: 8, z1: 25 };
export const HQ_SPAWN = { x: 16.5, z: 6.5 };
export const HUBS = {
  hq: {
    name: 'HQ', desc: 'Base de operaciones', w: 33, l: 40, hidden: true,
    theme: {
      floor: ['#0d1a1f', '#2fd6c8'], bg: 0x081218,
      1: ['#14232b', '#3fe3ff'], 2: ['#1d2f3a', '#9fd6ff'], 3: ['#4a3420', '#ffb347'],
      4: ['#203a48', '#3fe3ff'], 5: ['#2d3a4a', '#c9e6ff'], 6: ['#3a1440', '#ff3df2'],
      7: ['#0f8fae', '#7df9ff'], 8: ['#b0249f', '#ff8af6'], glow: [7, 8],
      strip: 0x3fe3ff, preview: ['#0d1a1f', '#3fe3ff', '#9fd6ff', '#ffb347', '#3fe3ff', '#c9e6ff', '#ff3df2', '#3fe3ff', '#ff8af6'],
    },
    build(set, m) {
      const F = (x0, x1, z0, z1, hh, k) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) set(x, z, hh, k); };
      // helipad: glowing H on a low pad
      F(14, 19, 4, 9, 0.1, 5); F(15, 15, 5, 8, 0.12, 7); F(18, 18, 5, 8, 0.12, 7); F(16, 17, 6, 7, 0.12, 7);
      // weapon bench (west): table + glowing trim + lockers
      F(6, 9, 18, 18, 1, 3); F(6, 9, 19, 19, 0.15, 7); F(2, 2, 14, 20, 2.6, 2); F(3, 3, 15, 15, 2.2, 6); F(3, 3, 19, 19, 2.2, 6);
      // briefing tent / terminal (west-north)
      F(3, 9, 24, 24, 2.4, 6); F(3, 3, 24, 29, 2.4, 6); F(5, 7, 27, 27, 1, 4); F(6, 6, 27, 27, 1.1, 8);
      // firing range (east): walls with an entrance on the west side, shooting bench, targets at the far end
      F(21, 31, 8, 8, 2.6, 2); F(21, 21, 8, 25, 2.6, 2); F(21, 21, 11, 13, 0, 0); F(21, 31, 25, 25, 2.6, 2);
      F(23, 30, 13, 13, 0.9, 4); F(23, 30, 13, 13, 0.9, 4); F(25, 26, 13, 13, 0, 0); // shooting bench with a gap
      F(22, 30, 23, 24, 0.4, 6); // target berm
      // stream crossing the base + bridge
      for (let x = 1; x <= 19; x++) if (x < 15 || x > 17) set(x, 30 + (x % 4 === 0 ? 1 : 0), 0.05, 7);
      F(15, 17, 30, 31, 0.3, 5);
      // vehicle bay (south-east): parked voxel truck
      F(24, 29, 2, 4, 1.6, 6); F(27, 29, 2, 4, 2.2, 6); F(28, 28, 2, 4, 2.2, 7);
      // crates + light posts
      for (const [x, z, hh] of [[11, 12, 1], [12, 12, 0.5], [20, 18, 1], [11, 27, 1.2], [19, 27, 0.8], [5, 10, 1]]) set(x, z, hh, 3);
      for (const [x, z] of [[12, 4], [21, 4], [12, 21], [19, 21]]) set(x, z, 3.2, 8);
      // north wall with 5 portals (2-wide openings framed by glowing pillars)
      F(1, 31, 37, 38, 3.6, 2);
      for (const p of HQ_PORTALS) { set(p.x0 - 1, 36, 3.6, 8); set(p.x1 + 1, 36, 3.6, 8); F(p.x0, p.x1, 37, 37, 3.6, 7); }
    },
  },
};

export function createMap(id = DEFAULT_MAP) {
  const def = MAPS[id] || HUBS[id] || MAPS[DEFAULT_MAP];
  const W = def.w, L = def.l;
  const heights = new Float32Array(W * L);
  const kind = new Uint8Array(W * L);
  const set = (i, j, h, k) => { if (i > 0 && j > 0 && i < W - 1 && j < L - 1) { heights[i + j * W] = h; kind[i + j * W] = h > 0 ? k : 0; } };
  for (let i = 0; i < W; i++) for (let j = 0; j < L; j++)
    if (i === 0 || j === 0 || i === W - 1 || j === L - 1) { heights[i + j * W] = WALL_H; kind[i + j * W] = 1; }
  // symmetry helpers (maps are mirrored in X and Z so both spawn ends are fair)
  const h = {
    fill: (x0, x1, z0, z1, hh, k) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) set(x, z, hh, k); },
    symX: (x, z, hh, k) => { set(x, z, hh, k); set(W - 1 - x, z, hh, k); },
    fillSymX: (x0, x1, z0, z1, hh, k) => { h.fill(x0, x1, z0, z1, hh, k); h.fill(W - 1 - x1, W - 1 - x0, z0, z1, hh, k); },
    sym: (x, z, hh, k) => { for (const xx of [x, W - 1 - x]) for (const zz of [z, L - 1 - z]) set(xx, zz, hh, k); },
    // run fn(z) for z in [z0, z1) and mirror every write made inside it to L-1-z
    mirrorZ: (fn, z0, z1) => {
      for (let z = z0; z < z1; z++) {
        const before = heights.slice(), kb = kind.slice(); fn(z);
        for (let i = 0; i < W * L; i++) if (heights[i] !== before[i] || kind[i] !== kb[i]) {
          const x = i % W, zz = (i / W) | 0; set(x, L - 1 - zz, heights[i], kind[i]);
        }
      }
    },
  };
  def.build(set, { w: W, l: L }, h);

  const m = { id: MAPS[id] || HUBS[id] ? id : DEFAULT_MAP, name: def.name, w: W, l: L, heights, kind, theme: def.theme || DEFAULT_THEME };
  m.heightAtCell = (i, j) => (i < 0 || j < 0 || i >= W || j >= L) ? WALL_H : heights[i + j * W];
  m.heightAt = (x, z) => m.heightAtCell(Math.floor(x), Math.floor(z));
  m.groundUnder = (x, z, r) => {
    let h = 0;
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++)
      for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) h = Math.max(h, m.heightAtCell(i, j));
    return h;
  };
  m.blocked = (x, z, r, feetY) => m.groundUnder(x, z, r) > feetY + 0.05;
  // Horizontal move with sliding; steps up ledges up to STEP high (caller snaps y to ground).
  m.moveCircle = (pos, dx, dz, r, step = STEP) => {
    if (!m.blocked(pos.x + dx, pos.z, r, pos.y + step)) pos.x += dx;
    if (!m.blocked(pos.x, pos.z + dz, r, pos.y + step)) pos.z += dz;
  };
  // For bots (no jumping/gravity): move, then stick to the ground below.
  m.moveWalker = (pos, dx, dz, r) => { m.moveCircle(pos, dx, dz, r); pos.y = m.groundUnder(pos.x, pos.z, r); };
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
  const lanesX = def.lanes || [Math.round(W * 0.17) + 0.5, Math.floor(W / 2) + 0.5, W - 1 - Math.round(W * 0.17) + 0.5];
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
