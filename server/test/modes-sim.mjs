// Offline v2 mode simulation: 8 bots per mode on every map, simulated clock (fast).
// Checks that matches progress (kills, captures, plants, rounds) and end by score/time.
// Usage: node test/modes-sim.mjs [mode|all] [map|all] [simSeconds]
import { createMap, MAPS } from '../../map.js';
import { MODES } from '../../config.js';
import { initMatch, newPlayer, beginMatch, tickMatch, handleMsg } from '../../match.js';
let T = 1_000_000; const realNow = Date.now; Date.now = () => T;
const modes = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : Object.keys(MODES).filter((m) => m !== 'surv'); // surv has its own test (surv-sim.mjs)
const maps = process.argv[3] === 'v2' ? ['templo', 'nuclear', 'azotea', 'piscina', 'paintball'] : process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : Object.keys(MAPS);
const SIM = +(process.argv[4] || 240);
const out = [];
for (const mode of modes) for (const mapId of maps) {
  const ev = { kill: 0, cap: 0, capture: 0, plant: 0, defuse: 0, boom: 0, round: 0, streak: 0, nade: 0, take: 0 };
  let ended = null;
  const L = { id: 't', paid: false, mapId, map: createMap(mapId), size: 8, players: new Map(), state: 'waiting' };
  initMatch(L, { mode, botSkill: 1, bcast: (m) => { if (m.t === 'kill') ev.kill++; if (m.t === 'obj' && ev[m.ev] !== undefined) ev[m.ev]++; if (m.t === 'streak') ev.streak++; if (m.t === 'nade') ev.nade++; }, sendTo: () => {}, onEnd: (L2, r) => { ended = r; } });
  for (let i = 0; i < 8; i++) newPlayer(L, { id: 'B' + i, name: 'Bot' + i, bot: true });
  beginMatch(L);
  let t = 0; for (; t < SIM && !ended; t += 0.05) { T += 50; tickMatch(L, 0.05, T); }
  out.push({ mode, map: mapId, secs: Math.round(t), ended: !!ended, sc: L.score.join('-'), ...Object.fromEntries(Object.entries(ev).filter(([, v]) => v)) });
}
Date.now = realNow;
console.table(out);
