// Plays a free test lobby on a given map: checks the vote picks it, bots move on
// multiple height levels, fight, and don't get stuck. Usage: node test/map-sim.js <mapId> [wsUrl]
import WebSocket from 'ws';
const MAP = process.argv[2] || 'fortaleza', URL = process.argv[3] || 'ws://localhost:8080/ws';
const ws = new WebSocket(URL); const msgs = []; let start = null; const track = new Map();
ws.on('message', (r) => { const m = JSON.parse(r); msgs.push(m); if (m.t === 'start') start = m;
  if (m.t === 'snap') for (const p of m.p) if (p.bot) { const t = track.get(p.id) || { maxY: 0, path: 0, last: null, levels: new Set() };
    if (t.last) t.path += Math.hypot(p.x - t.last.x, p.z - t.last.z); t.last = p; t.maxY = Math.max(t.maxY, p.y); t.levels.add(p.y.toFixed(1)); track.set(p.id, t); } });
await new Promise((r) => ws.on('open', r));
const send = (m) => ws.send(JSON.stringify(m)); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
send({ t: 'hello', name: 'MapTester' }); send({ t: 'joinTest', map: MAP }); await wait(500); send({ t: 'vote', map: MAP });
for (let i = 0; i < 40 && !start; i++) await wait(500);
await wait(25000);
const bots = [...track.values()];
const levels = new Set(bots.flatMap((b) => [...b.levels]));
console.log(JSON.stringify({ map: MAP, startedOn: start?.map, kills: msgs.filter((m) => m.t === 'kill').length,
  botsMovedOver10m: bots.filter((b) => b.path > 10).length + '/' + bots.length, maxBotY: Math.max(...bots.map((b) => b.maxY)), heightLevelsSeen: [...levels].sort() }));
process.exit(0);
