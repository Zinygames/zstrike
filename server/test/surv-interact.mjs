// Survive regression (online path): join a surv lobby, walk to a weapon pickup and the mystery box
// sending real 'state' moves (speed-checked by the server), then interact like the ✋ button / E key does.
// Usage: node test/surv-interact.mjs [ws://localhost:8787/ws]
import WebSocket from 'ws';
import { createMap } from '../../map.js';
import { flowField, flowDir } from '../../ai.js';
const URL = process.argv[2] || 'ws://localhost:8787/ws';
const map = createMap('coliseo'), ws = new WebSocket(URL), log = [];
let me = null, obj = null, lo = null, pts = 0, started = false, res = { pick: null, box: null, boxNo: null };
const send = (m) => ws.send(JSON.stringify(m)), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.on('open', () => { send({ t: 'hello', name: 'TouchTest' }); send({ t: 'joinMode', mode: 'surv', map: 'coliseo', lo: { primary: 'vibora', secondary: 'gemelas', perks: [] } }); });
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'joined') me = { id: m.you };
  if (m.t === 'start') { started = true; me.x = m.spawn.x; me.z = m.spawn.z; me.y = 0; obj = m.obj; }
  if (m.t === 'snap') { if (m.o) obj = m.o; const s = m.p.find((p) => p.id === me?.id); if (s) pts = s.pt; }
  if (m.t === 'correct') { me.x = m.x; me.z = m.z; me.y = m.y; log.push('correct'); }
  if (m.t === 'survLo') lo = m;
  if (m.t === 'boxGot') (m.pick ? (res.pick = m.w) : (res.box = m.w));
  if (m.t === 'boxNo') res.boxNo = m;
  if (m.t === 'boxOpen') res.boxOpen = m.w;
});
async function walkTo(tx, tz, stop) {
  const f = flowField(map, Math.floor(tx) + 0.5, Math.floor(tz) + 0.5);
  for (let i = 0; i < 600 && Math.hypot(me.x - tx, me.z - tz) > stop; i++) {
    const near = Math.hypot(me.x - tx, me.z - tz) < 1.2;
    const d = near ? { x: (tx - me.x), z: (tz - me.z) } : flowDir(map, f, me, Math.floor(tx) + 0.5, Math.floor(tz) + 0.5);
    const l = Math.hypot(d.x, d.z) || 1, step = 0.22;
    const p = { x: me.x + d.x / l * step, y: 0, z: me.z + d.z / l * step };
    if (!map.blocked(p.x, p.z, 0.3, 0)) { me.x = p.x; me.z = p.z; }
    send({ t: 'state', x: +me.x.toFixed(3), y: 0, z: +me.z.toFixed(3), yaw: 0, pitch: 0 });
    await sleep(50);
  }
  return Math.hypot(me.x - tx, me.z - tz);
}
const t0 = Date.now(); while (!started && Date.now() - t0 < 30000) await sleep(100);
if (!started) { console.log(JSON.stringify({ ok: false, why: 'no start' })); process.exit(1); }
await sleep(500);
const startPts = pts, k = obj.pk.slice().sort((a, b) => Math.hypot(a[1] - me.x, a[2] - me.z) - Math.hypot(b[1] - me.x, b[2] - me.z))[0];
const dPick = await walkTo(k[1], k[2], 1.6);   // stop at the edge of the prompt range, like a player would
send({ t: 'pick', id: k[0] }); await sleep(700);
const [bx, bz, cost] = obj.bx;
const dBox = await walkTo(bx, bz - 1.4, 0.3);
send({ t: 'box' }); await sleep(3000);
const out = { url: URL, startPts, cost, pickup: { id: k[0], w: k[3], dist: +dPick.toFixed(2), got: res.pick, lo: lo && [lo.primary, lo.secondary] },
  box: { dist: +Math.hypot(me.x - bx, me.z - bz).toFixed(2), opened: res.boxOpen ?? null, got: res.box, no: res.boxNo }, corrections: log.length };
out.ok = out.pickup.got === k[3] && (startPts >= cost ? out.box.got !== null : !!out.box.no);
console.log(JSON.stringify(out)); ws.close(); process.exit(out.ok ? 0 : 1);
