// Offline nav check: walk bots with the real flow field + moveWalker from every spawn to target points
// (incl. the upstairs lofts) and report whether they arrive. Usage: node test/nav-check.mjs <mapId> [x,z ...]
import { createMap } from '../../map.js';
import { flowField, flowDir } from '../../ai.js';
const id = process.argv[2] || 'barrio';
const m = createMap(id);
const targets = process.argv.slice(3).map((s) => s.split(',').map(Number));
const res = [];
for (const [tx, tz] of targets) for (const side of m.spawns) for (const [sx, sz] of side) {
  const dist = flowField(m, tx, tz), pos = { x: sx, y: 0, z: sz };
  let t = 0, maxY = 0;
  for (; t < 60 / 0.05; t++) {                 // up to 60 s of game time at 20 Hz, bot speed 3.2 m/s
    if (Math.hypot(pos.x - tx, pos.z - tz) < 0.7) break;
    const d = flowDir(m, dist, pos, tx, tz); m.moveWalker(pos, d.x * 3.2 * 0.05, d.z * 3.2 * 0.05, 0.3); maxY = Math.max(maxY, pos.y);
  }
  res.push({ from: `${sx},${sz}`, to: `${tx},${tz}`, ok: Math.hypot(pos.x - tx, pos.z - tz) < 0.7, secs: +(t * 0.05).toFixed(1), y: +pos.y.toFixed(2) });
}
const fail = res.filter((r) => !r.ok);
console.log(JSON.stringify({ map: id, runs: res.length, arrived: res.length - fail.length, fail, sample: res.slice(0, 3) }));
