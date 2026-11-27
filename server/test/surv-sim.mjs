// Offline Survive the 150 simulation (simulated clock): co-op bots in the Coliseo.
// Checks waves start/clear, zombies spawn from the gates and chase, bosses every 10 waves, points,
// mystery box (incl. Mono Bomba), weapon pickups, the Mono Bomba lure + explosion, and the end result.
// Usage: node test/surv-sim.mjs [startWave=1] [simSeconds=300] [bots=4]
import { createMap } from '../../map.js';
import { WEAPONS, SURV } from '../../config.js';
import { initMatch, newPlayer, beginMatch, tickMatch, handleMsg, waveSpec } from '../../match.js';
let T = 1_000_000; const realNow = Date.now; Date.now = () => T;
const START = +(process.argv[2] || 1), SIM = +(process.argv[3] || 300), NB = +(process.argv[4] || 4);
const ev = { kill: 0, zkill: 0, boss: 0, wave: 0, waveClear: 0, boxOpen: 0, boxGot: 0, monoNade: 0, survLo: 0, hitsOnHumans: 0, humanDeaths: 0 };
let ended = null, maxWave = 0, maxZ = 0, lureFollow = null;
const L = { id: 't', paid: false, mapId: 'coliseo', map: createMap('coliseo'), size: 8, players: new Map(), state: 'waiting' };
initMatch(L, { mode: 'surv', botSkill: 1, survStart: START,
  bcast: (m) => {
    if (m.t === 'kill') { ev.kill++; if (m.zt) ev.zkill++; if (m.zt === 'boss') ev.boss++; if (!m.zt && String(m.victim).startsWith('B')) ev.humanDeaths++; }
    if (m.t === 'obj' && m.ev === 'wave') { ev.wave++; maxWave = Math.max(maxWave, m.wave); }
    if (m.t === 'obj' && m.ev === 'waveClear') ev.waveClear++;
    if (m.t === 'boxOpen') ev.boxOpen++;
    if (m.t === 'nade' && m.kind === 'mono') ev.monoNade++;
    if (m.t === 'hit' && String(m.target).startsWith('B')) ev.hitsOnHumans++;
  },
  sendTo: (p, m) => { if (m.t === 'boxGot') ev.boxGot++; if (m.t === 'survLo') ev.survLo++; },
  onEnd: (L2, r) => { ended = r; } });
for (let i = 0; i < NB; i++) newPlayer(L, { id: 'B' + i, name: 'Bot' + i, bot: true, conn: { fake: true } });
beginMatch(L);
const b0 = L.players.get('B0');
let t = 0, boxTried = false, picked = false, monoT = null;
for (; t < SIM && !ended; t += 0.05) {
  T += 50; tickMatch(L, 0.05, T);
  if (process.env.WEAK) for (const p of L.players.values()) if (p.zombie) p.hp = Math.min(p.hp, 1);
  if (process.env.GOD) for (const p of L.players.values()) if (!p.zombie) p.hp = 1e6;
  maxZ = Math.max(maxZ, [...L.players.values()].filter((p) => p.zombie).length);
  // scripted checks on bot 0: box when rich, a pickup, then a Mono Bomba
  if (!boxTried && b0.alive && b0.score >= SURV.boxCost) { boxTried = true; b0.x = L.surv.box.x; b0.z = L.surv.box.z - 1.5; handleMsg(L, b0, { t: 'box' }); }
  if (!picked && b0.alive && L.surv.pickups.length && t > 3) { picked = true; const k = L.surv.pickups[0]; b0.x = k.x; b0.z = k.z; const before = b0.loadout.primary; handleMsg(L, b0, { t: 'pick', id: k.id }); ev.pickSwap = before !== b0.loadout.primary || b0.loadout.secondary !== undefined; }
  if (monoT === null && b0.alive && L.surv.phase === 'wave' && [...L.players.values()].filter((p) => p.zombie).length >= 5) {
    b0.nades.mono = 1; monoT = t; handleMsg(L, b0, { t: 'nade', kind: 'mono', o: { x: b0.x, y: b0.y + 1.5, z: b0.z }, d: { x: 0, y: 0.2, z: 1 } });
  }
  if (monoT !== null && lureFollow === null && t > monoT + 5.6 && L.surv.lures.length) {
    const l = L.surv.lures[0], zs = [...L.players.values()].filter((p) => p.zombie && p.alive);
    lureFollow = { zombies: zs.length, within6m: zs.filter((z) => Math.hypot(z.x - l.x, z.z - l.z) < 6).length };
  }
}
Date.now = realNow;
if (process.env.DBG) console.log([...L.players.values()].filter((p) => p.zombie).map((z) => `${z.zombie} ${z.x.toFixed(1)},${z.z.toFixed(1)} hp${Math.round(z.hp)}`).join(" | "), L.surv.toSpawn, [...L.players.values()].filter((p) => !p.zombie).map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(" "));
console.log(JSON.stringify({ startWave: START, simSecs: Math.round(t), ended, reachedWave: L.surv.wave, maxAliveZombies: maxZ, pickups: L.surv.pickups.length,
  scores: [...L.players.values()].filter((p) => !p.zombie).map((p) => Math.round(p.score)), b0: { primary: WEAPONS[b0.loadout.primary]?.id, secondary: WEAPONS[b0.loadout.secondary]?.id, mono: b0.nades.mono }, lureFollow, ...ev,
  spec10: waveSpec(10), spec150: waveSpec(150) }, null, 1));
