// Simulated clients: 2 humans join a free test lobby (bots fill the rest), then
// checks server authority: kills only via valid shots, teleports corrected,
// fire-rate enforced. Usage: node test/sim.js [ws://localhost:8080/ws]
import WebSocket from 'ws';
const URL = process.argv[2] || 'ws://localhost:8080/ws';
const results = {};
function client(name) {
  const ws = new WebSocket(URL); const c = { ws, name, msgs: [], state: null, id: null };
  ws.on('message', (raw) => { const m = JSON.parse(raw); c.msgs.push(m); if (m.t === 'joined') c.id = m.you; if (m.t === 'start') c.start = m; if (m.t === 'snap') c.snap = m; if (m.t === 'end') c.end = m; });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.ready = new Promise((r) => ws.on('open', r));
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const A = client('SimA'), B = client('SimB');
await Promise.all([A.ready, B.ready]);
A.send({ t: 'hello', name: 'SimA' }); B.send({ t: 'hello', name: 'SimB' });
A.send({ t: 'joinTest', map: 'carriles' }); await wait(300); B.send({ t: 'joinTest', map: 'carriles' });
await wait(500); A.send({ t: 'vote', map: 'puente' }); B.send({ t: 'vote', map: 'puente' }); A.send({ t: 'vote', map: 'nope' });
// wait for start (4s fill + 5s countdown)
for (let i = 0; i < 40 && !(A.start && B.start); i++) await wait(500);
results.bothStarted = !!(A.start && B.start);
results.voteResult = A.msgs.find((m) => m.t === 'mapResult'); results.startMap = A.start?.map;
results.sameLobby = A.msgs.find((m) => m.t === 'joined')?.lobbyId === B.msgs.find((m) => m.t === 'joined')?.lobbyId;
await wait(300);
// teleport cheat -> should get 'correct'
A.send({ t: 'state', x: A.start.spawn.x, y: 0, z: A.start.spawn.z + 30, yaw: 0, pitch: 0 });
await wait(300);
results.teleportCorrected = A.msgs.some((m) => m.t === 'correct');
// spam 50 shots in 0.5s at nothing -> server should accept only a few (pistol 0.32s)
const before = A.msgs.filter((m) => m.t === 'fx' && m.from === A.id).length;
for (let i = 0; i < 50; i++) { A.send({ t: 'shot', w: 0, o: { x: A.start.spawn.x, y: 1.55, z: A.start.spawn.z }, d: { x: 0, y: 1, z: 0 } }); await wait(10); }
await wait(400);
results.shotsAcceptedOutOf50 = A.msgs.filter((m) => m.t === 'fx' && m.from === A.id).length - before;
// A aims at the nearest living player (server positions) with the pistol for 15s.
// B walks toward A along valid paths so they meet; the server decides every hit.
const t0 = Date.now();
while (Date.now() - t0 < 15000) {
  const me = A.snap?.p.find((p) => p.id === A.id);
  const bme = B.snap?.p.find((p) => p.id === B.id);
  if (bme && bme.alive && me) { // B moves 0.25 m per 50 ms toward A (5 m/s, under the limit)
    const dx = me.x - bme.x, dz = me.z - bme.z, L = Math.hypot(dx, dz) || 1;
    if (L > 3) B.send({ t: 'state', x: bme.x + dx / L * 0.25 * (Math.abs(dx) > 0.5 ? 1 : 0), y: 0, z: bme.z + dz / L * 0.25, yaw: 0, pitch: 0 });
  }
  if (me && me.alive) {
    let best = null, bd = 1e9;
    for (const p of A.snap.p) if (p.id !== A.id && p.alive) { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < bd) { bd = d; best = p; } }
    if (best) { const o = { x: me.x, y: me.y + 1.55, z: me.z }; A.send({ t: 'shot', w: 0, o, d: { x: best.x - o.x, y: best.y + 1.0 - o.y, z: best.z - o.z } }); }
  }
  await wait(50);
}
results.hitsByA = A.msgs.filter((m) => m.t === 'hit' && m.by === A.id).length;
results.killsByA = A.msgs.filter((m) => m.t === 'kill' && m.killer === A.id).length;
results.hitsOnB_byA = A.msgs.filter((m) => m.t === 'hit' && m.by === A.id && m.target === B.id).length;
results.totalKillsInLobby = A.msgs.filter((m) => m.t === 'kill').length;
results.allFx = A.msgs.filter((m) => m.t === 'fx').length; results.allHits = A.msgs.filter((m) => m.t === 'hit').length; results.botPositions = A.snap.p.filter(p=>p.bot).map(p=>p.x+','+p.z).join(' ');
results.scoreboard = (A.msgs.filter((m) => m.t === 'score').pop()?.board || []).map((b) => `${b.name}:${b.kills}/${b.deaths}`).join(' ');
results.snapshotsReceived = A.msgs.filter((m) => m.t === 'snap').length;
results.playersInSnap = A.snap?.p.length;
console.log(JSON.stringify(results, null, 2));
A.ws.close(); B.ws.close();
process.exit(0);
