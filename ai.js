// Shared bot navigation: BFS flow field on the map grid toward a target cell.
// Used by single-player bots (browser) and lobby filler bots (server).

export function flowField(map, tx, tz) {
  const W = map.w, L = map.l;
  const dist = new Int16Array(W * L).fill(-1);
  const walk = (i, j) => i > 0 && j > 0 && i < W - 1 && j < L - 1 && map.groundUnder(i + 0.5, j + 0.5, 0.3) === 0;
  let ti = Math.max(1, Math.min(W - 2, Math.floor(tx))), tj = Math.max(1, Math.min(L - 2, Math.floor(tz)));
  const q = new Int32Array(W * L); let h = 0, t = 0;
  dist[ti + tj * W] = 0; q[t++] = ti + tj * W;
  while (h < t) {
    const c = q[h++], i = c % W, j = (c / W) | 0, d = dist[c];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, n = ni + nj * W;
      if (dist[n] === -1 && walk(ni, nj)) { dist[n] = d + 1; q[t++] = n; }
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
    if (d < 0) continue;
    if (di && dj && (dist[ni + j * W] < 0 || dist[i + nj * W] < 0)) continue; // no corner cutting
    if (d < best) { best = d; bx = ni + 0.5; bz = nj + 0.5; }
  }
  const dx = bx - pos.x, dz = bz - pos.z, len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}
