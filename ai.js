// Shared bot navigation: BFS flow field on the map grid toward a target cell.
// Used by single-player bots (browser) and lobby filler bots (server).
// Height-aware: a bot can walk to a neighbour cell if it is at most STEP higher
// (stairs/ramps of 0.5) or any amount lower (dropping off platforms/catwalks).
import { STEP, WALL_H } from './map.js';

const cellH = (map, i, j) => map.heightAtCell(i, j);
const open = (map, i, j) => i > 0 && j > 0 && i < map.w - 1 && j < map.l - 1 && cellH(map, i, j) < WALL_H - 0.5;
const canStep = (map, fi, fj, ti, tj) => open(map, ti, tj) && cellH(map, ti, tj) - cellH(map, fi, fj) <= STEP + 1e-6;

export function flowField(map, tx, tz) {
  const W = map.w, L = map.l;
  const dist = new Int16Array(W * L).fill(-1);
  const ti = Math.max(1, Math.min(W - 2, Math.floor(tx))), tj = Math.max(1, Math.min(L - 2, Math.floor(tz)));
  const q = new Int32Array(W * L); let h = 0, t = 0;
  dist[ti + tj * W] = 0; q[t++] = ti + tj * W;
  while (h < t) {
    const c = q[h++], i = c % W, j = (c / W) | 0, d = dist[c];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, n = ni + nj * W;
      // reverse search: a bot standing on n must be able to step onto c
      if (dist[n] === -1 && open(map, ni, nj) && canStep(map, ni, nj, i, j)) { dist[n] = d + 1; q[t++] = n; }
    }
  }
  return dist;
}

// Returns a unit direction {x,z} to move from pos along the flow field.
export function flowDir(map, dist, pos, tx, tz) {
  const W = map.w;
  const i = Math.floor(pos.x), j = Math.floor(pos.z);
  let best = dist[i + j * W], bx = tx, bz = tz;
  if (best === -1) best = 1e9;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    if (!di && !dj) continue;
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= W || nj >= map.l) continue;
    const d = dist[ni + nj * W];
    if (d < 0 || !canStep(map, i, j, ni, nj)) continue;
    // no corner cutting: both orthogonal cells must be passable too
    if (di && dj && (dist[ni + j * W] < 0 || dist[i + nj * W] < 0 || !canStep(map, i, j, ni, j) || !canStep(map, i, j, i, nj))) continue;
    if (d < best) { best = d; bx = ni + 0.5; bz = nj + 0.5; }
  }
  const dx = bx - pos.x, dz = bz - pos.z, len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}
