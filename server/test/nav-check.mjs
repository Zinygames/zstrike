// Offline nav check: walk bots with the real flow field + moveWalker from every spawn to target points
// (incl. the upstairs lofts) and report whether they arrive. Usage: node test/nav-check.mjs <mapId> [x,z ...]
import { createMap } from '../../map.js';
import { flowField, flowDir } from '../../ai.js';
// With no points given, v2 maps use built-in targets: upstairs floors (fake 2nd storeys), pools, centre.
// "node test/nav-check.mjs v2" checks all five v2 maps.
const DEFAULT_TARGETS = {
  templo: ['13.5,8.5', '3.5,12.5', '16.5,21.5', '29.5,33.5', '12.5,37.5'],
  nuclear: ['5.5,9.5', '21.5,13.5', '16.5,20.5', '27.5,36.5', '8.5,31.5'],
  azotea: ['16.5,9.5', '16.5,20.5', '16.5,36.5', '5.5,13.5', '27.5,32.5'],
  piscina: ['16.5,12.5', '1.5,18.5', '31.5,27.5', '14.5,19.5', '16.5,33.5'],
  paintball: ['5.5,10.5', '27.5,12.5', '16.5,20.5', '27.5,35.5', '5.5,33.5'],
};
const ids = process.argv[2] === 'v2' ? Object.keys(DEFAULT_TARGETS) : [process.argv[2] || 'barrio'];
let allOk = true;
for (const id of ids) {
const m = createMap(id);
const targets = (process.argv.length > 3 && process.argv[2] !== 'v2' ? process.argv.slice(3) : (DEFAULT_TARGETS[id] || [])).map((s) => s.split(',').map(Number));
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
const maxY = Math.max(0, ...res.map((r) => r.ok ? r.y : 0));
console.log(JSON.stringify({ map: id, runs: res.length, arrived: res.length - fail.length, maxArrivedY: maxY, fail }));
if (fail.length) allOk = false;
}
process.exitCode = allOk ? 0 : 1;
