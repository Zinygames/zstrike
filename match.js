// ZStrike shared match simulation (server-authoritative).
// Runs on the Node server for online lobbies AND in the browser for offline "VS BOTS" matches,
// so hits, damage, scorestreaks, perks and objectives follow exactly the same rules.
// The host provides L.bcast(msg) (to everyone) and L.sendTo(player, msg).
import { WEAPONS, MODES, STREAKS, PERK_IDS, ZTYPES, SURV, MONO } from './config.js';
import { rayHitPlayer } from './map.js';
import { flowField, flowDir } from './ai.js';

export const EYE = 1.55, MAX_HP = 100, RESPAWN_MS = 3000, SPEED = 6;
const ARROW_G = 9, NADE_G = 18, FUSE = 1.6;
const PRIMARIES = WEAPONS.map((w, i) => (!w.legacy && w.slot === 'primary' ? i : -1)).filter((i) => i >= 0);
const idx = (id) => WEAPONS.findIndex((w) => w.id === id);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------ setup
export function initMatch(L, { mode = null, botSkill = 1, bcast, sendTo, onEnd, scoreLimit, seconds, survStart = 1 }) {
  L.survStart = Math.max(1, Math.min(SURV.waves, survStart | 0));
  L.mode = MODES[mode] ? mode : null;          // null = v1 free-for-all (paid / free test lobbies)
  L.legacy = !L.mode;
  L.M = L.mode ? MODES[L.mode] : null;
  L.teamMode = !!L.M?.team;
  L.bcast = bcast; L.sendTo = sendTo; L.onEnd = onEnd; L.botSkill = botSkill;
  L.scoreLimit = scoreLimit ?? L.M?.scoreLimit ?? 0; L.seconds = seconds ?? L.M?.seconds ?? 300;
  L.score = [0, 0]; L.pending = []; L.uav = []; L.helis = []; L.flowCache = new Map(); L.snapN = 0;
}
export function newPlayer(L, { id, conn = null, name, bot = false, pubkey = null, entryLamports = 0, entrySig = null }) {
  const p = { id, name, conn, bot, pubkey, entryLamports, entrySig,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastKillAt: 0, multi: 0,
    cdUntil: 0, respawnAt: 0, lastStateAt: Date.now(), side: L.players.size % 2, team: L.players.size % 2,
    loadout: { primary: idx('carmesi'), secondary: idx('clasica'), perks: ['agil', 'manos', 'suave'] },
    ammo: {}, reloadUntil: {}, lastShot: {}, lastShotAt: 0, streak: 0, ready: new Set(), nades: { frag: 1, flash: 1 },
    secondUsed: false, flashedUntil: 0, caps: 0, score: 0,
    ai: bot ? { cd: 1, flowAt: 0, flow: null, target: null, strafe: Math.random() < 0.5 ? 1 : -1, blindUntil: 0, role: Math.random() } : null };
  if (bot && !L.legacy) p.loadout = { primary: rnd(PRIMARIES), secondary: idx('clasica'), perks: [rnd(PERK_IDS[1]), rnd(PERK_IDS[2]), rnd(PERK_IDS[3])] };
  L.players.set(p.id, p);
  return p;
}
const hasPerk = (L, p, id) => !L.legacy && p.loadout.perks.includes(id);
const isEnemy = (L, a, b) => a !== b && (!L.teamMode || a.team !== b.team);
export function setLoadout(L, p, lo) {
  if (L.legacy || !lo) return;
  const pr = idx(String(lo.primary)), se = idx(String(lo.secondary));
  if (pr >= 0 && WEAPONS[pr].slot === 'primary') p.loadout.primary = pr;
  if (se >= 0 && WEAPONS[se].slot === 'secondary') p.loadout.secondary = se;
  if (Array.isArray(lo.perks)) p.loadout.perks = [1, 2, 3].map((k, i) => (PERK_IDS[k].includes(lo.perks[i]) ? lo.perks[i] : p.loadout.perks[i]));
  p.nades.frag = hasPerk(L, p, 'bolsillo') ? 2 : 1;
}
function allowed(L, p, w) { return L.legacy ? w >= 0 && w <= 2 : w === p.loadout.primary || w === p.loadout.secondary; }
const isZombie = (p) => !!p.zombie;

// ------------------------------------------------------------ objectives
function nearestFree(map, x, z) {
  let best = null, bd = 1e9;
  for (const [cx, cz] of map.freeCells()) { const d = Math.hypot(cx - x, cz - z); if (d < bd) { bd = d; best = { x: cx, z: cz }; } }
  return best || { x, z };
}
function spawnCenter(map, side) { const s = map.spawns[side]; return { x: s.reduce((a, b) => a + b[0], 0) / s.length, z: s.reduce((a, b) => a + b[1], 0) / s.length }; }
function setupObjectives(L) {
  const m = L.map;
  if (L.mode === 'dom') L.flags = ['A', 'B', 'C'].map((id, i) => ({ id, ...nearestFree(m, m.w / 2, m.l * (0.2 + i * 0.3)), owner: -1, prog: 0 }));
  if (L.mode === 'ctf') L.ctf = [0, 1].map((t) => { const h = nearestFree(m, spawnCenter(m, t).x, t === 0 ? 8.5 : m.l - 8.5); return { team: t, home: h, x: h.x, z: h.z, carrier: null, droppedAt: 0 }; });
  if (L.mode === 'snd') {
    L.sites = [{ id: 'A', ...nearestFree(m, m.w * 0.27, m.l * 0.72) }, { id: 'B', ...nearestFree(m, m.w * 0.73, m.l * 0.72) }];
    L.snd = { round: 1, wins: [0, 0], phase: 'live', bomb: null, roundEndsAt: Date.now() + L.M.round * 1000, postUntil: 0, plant: new Map(), defuse: 0, defuser: null };
  }
}
function objState(L) {
  if (L.mode === 'dom') return { f: L.flags.map((f) => [f.id, +f.x.toFixed(1), +f.z.toFixed(1), f.owner, +f.prog.toFixed(2)]) };
  if (L.mode === 'ctf') return { c: L.ctf.map((f) => [f.team, +f.x.toFixed(1), +f.z.toFixed(1), f.carrier, f.home.x, f.home.z]) };
  if (L.mode === 'surv') {
    const S = L.surv, zs = [...L.players.values()].filter(isZombie).length;
    return { sv: [S.wave, S.phase, S.toSpawn + zs, Math.max(0, Math.ceil((S.nextAt - Date.now()) / 1000))], bx: [S.box.x, S.box.z, SURV.boxCost],
      pk: S.pickups.map((k) => [k.id, +k.x.toFixed(1), +k.z.toFixed(1), k.w]), lu: S.lures.filter((l) => l.active).map((l) => [+l.x.toFixed(1), +l.z.toFixed(1)]) };
  }
  if (L.mode === 'snd') {
    const s = L.snd, b = s.bomb; let plant = 0; for (const v of s.plant.values()) plant = Math.max(plant, v);
    return { s: L.sites.map((x) => [x.id, x.x, x.z]), r: s.round, w: s.wins, ph: s.phase, b: b && [+b.x.toFixed(1), +b.z.toFixed(1), Math.max(0, Math.ceil((b.explodeAt - Date.now()) / 1000))], pl: +plant.toFixed(2), df: +s.defuse.toFixed(2), t: Math.max(0, Math.ceil((s.roundEndsAt - Date.now()) / 1000)) };
  }
  return null;
}

// ------------------------------------------------------------ start / spawn
export function beginMatch(L) {
  L.state = 'playing'; L.endsAt = Date.now() + L.seconds * 1000; L.score = [0, 0];
  if (L.teamMode) { let i = 0; for (const p of L.players.values()) { p.team = p.side = i % 2; i++; } }
  else { let i = 0; for (const p of L.players.values()) { p.side = i % 2; p.team = 10 + i; i++; } }
  if (!L.legacy) setupObjectives(L);
  if (L.mode === 'surv') { for (const p of L.players.values()) { p.team = p.side = 0; } setupSurv(L); }
  for (const p of L.players.values()) {
    placeAtSpawn(L, p, true);
    if (p.conn) L.sendTo(p, { t: 'start', map: L.mapId, secondsLeft: L.seconds, spawn: { x: p.x, z: p.z }, board: board(L), mode: L.mode, legacy: L.legacy, team: p.team, teamMode: L.teamMode, scoreLimit: L.scoreLimit, obj: objState(L) });
  }
}
function spawnPoints(L, p) {
  if (!L.legacy && L.teamMode) return L.map.spawns[p.team];
  return [...L.map.spawns[0], ...L.map.spawns[1]];
}
function pickSpawn(L, p) {
  const all = spawnPoints(L, p);
  let best = all[0], bestD = -1;
  for (const s of all) {
    let dmin = 1e9;
    for (const o of L.players.values()) if (o !== p && o.alive && (!L.teamMode || isEnemy(L, o, p))) dmin = Math.min(dmin, Math.hypot(o.x - s[0], o.z - s[1]));
    const d = dmin + Math.random() * 3;
    if (d > bestD) { bestD = d; best = s; }
  }
  return best;
}
function placeAtSpawn(L, p, first) {
  const [x0, z0] = pickSpawn(L, p);
  const x = x0 + (first && !L.legacy ? (Math.random() - 0.5) * 0.6 : 0), z = z0;
  Object.assign(p, { x, y: L.map.groundUnder(x, z, 0.3), z, hp: MAX_HP, alive: true, lastStateAt: Date.now(), yaw: z > L.map.l / 2 ? 0 : Math.PI,
    ammo: {}, reloadUntil: {}, secondUsed: false, flashedUntil: 0 });
  p.nades = { frag: hasPerk(L, p, 'bolsillo') ? 2 : 1, flash: 1, mono: p.nades?.mono || 0 };
}
function respawn(L, p) {
  placeAtSpawn(L, p, false);
  L.bcast({ t: 'respawn', id: p.id, x: p.x, z: p.z });
}
export function board(L) { return [...L.players.values()].filter((p) => !p.zombie).map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, bot: p.bot, team: p.team, caps: p.caps, score: Math.round(p.score || 0) })); }

// ------------------------------------------------------------ combat
function aimRay(L, p, o, d) {
  const eye = { x: p.x, y: p.y + EYE, z: p.z };
  if (!o || Math.hypot(o.x - eye.x, o.y - eye.y, o.z - eye.z) > 1.2 || ![o.x, o.y, o.z].every(Number.isFinite)) o = eye; // don't trust client origin
  const len = Math.hypot(d.x, d.y, d.z); if (!(len > 1e-6) || !Number.isFinite(len)) return null;
  return { o, d: { x: d.x / len, y: d.y / len, z: d.z / len } };
}
export function fire(L, p, wIdx, o0, d0, charge = 1) {
  const w = WEAPONS[wIdx]; const now = Date.now();
  if (!w || !p.alive || L.state !== 'playing' || !allowed(L, p, wIdx)) return;
  if (L.mode === 'snd' && L.snd.phase === 'post') return;
  if (now < p.cdUntil) return;                          // fire-rate enforced server-side (per weapon stats)
  if (!L.legacy && w.mag) {                              // magazine + reload enforced server-side
    if (now < (p.reloadUntil[wIdx] || 0)) return;
    if (p.ammo[wIdx] === undefined) p.ammo[wIdx] = w.mag;
    if (p.ammo[wIdx] <= 0) { startReload(L, p, wIdx, now); return; }
    p.ammo[wIdx]--;
  }
  if (w.kind === 'arrow') { // draw time: a full-power arrow needs the bow held for `draw` seconds since the last shot
    const maxC = Math.min(1, Math.max(0.2, (now - (p.lastShot[wIdx] || 0) - w.fireRate * 1000) / (w.draw * 1000) + 0.35));
    charge = Math.max(0.15, Math.min(+charge || 0, maxC));
  }
  p.cdUntil = now + w.fireRate * 1000 * 0.85; p.lastShot[wIdx] = now; p.lastShotAt = now;
  const r = aimRay(L, p, o0, d0); if (!r) return;
  const { o, d } = r;
  if (w.kind === 'arrow') return fireArrow(L, p, wIdx, w, o, d, charge);
  const wallT = L.map.rayWallDistance(o, d, w.range);
  let best = null;
  if (w.kind !== 'rocket' || L.legacy) for (const t of L.players.values()) {
    if (!t.alive || !isEnemy(L, p, t)) continue;
    const h = rayHitPlayer(o, d, t);
    if (h && h.t < wallT && (!best || h.t < best.h.t)) best = { t, h };
  }
  if (w.kind === 'rocket' && !L.legacy) { // v2 rockets hit the first player OR wall on their path, after flight time
    for (const t of L.players.values()) { if (!t.alive || t === p) continue; const h = rayHitPlayer(o, d, t); if (h && h.t < wallT && (!best || h.t < best.h.t)) best = { t, h }; }
  }
  const endT = best ? best.h.t : wallT;
  const e = { x: o.x + d.x * endT, y: o.y + d.y * endT, z: o.z + d.z * endT };
  L.bcast({ t: 'fx', from: p.id, w: wIdx, o, e, exp: w.kind === 'rocket', q: w.quiet ? 1 : 0 });
  if (w.kind === 'rocket') {
    const boom = () => splash(L, p, e, d, w.splash, w.damage, wIdx);
    if (L.legacy) boom(); else L.pending.push({ at: now + (endT / (w.speed || 26)) * 1000, fn: boom });
  } else if (best) damage(L, p, best.t, w.damage * (best.h.head ? 2 : 1), best.h.head, wIdx);
}
function splash(L, by, e, d, radius, dmg, wIdx, kind = 'exp') {
  for (const t of L.players.values()) {
    if (!t.alive || (t !== by && !isEnemy(L, by, t)) || t === by) continue;
    const c = { x: t.x, y: t.y + 0.9, z: t.z };
    const dist = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
    if (dist < radius && L.map.lineOfSight({ x: e.x - (d?.x || 0) * 0.1, y: Math.max(e.y, 0.1) + (d ? 0 : 0.4), z: e.z - (d?.z || 0) * 0.1 }, c))
      damage(L, by, t, dmg * (1 - (dist / radius) * 0.6), false, wIdx, kind);
  }
}
function fireArrow(L, p, wIdx, w, o, d, charge) {
  const spd = (w.speed || 50) * (0.45 + 0.55 * charge), dmg = w.damage * (0.35 + 0.65 * charge);
  const pos = { x: o.x + d.x * 0.4, y: o.y + d.y * 0.4, z: o.z + d.z * 0.4 }, v = { x: d.x * spd, y: d.y * spd, z: d.z * spd };
  const dt = 0.02; let tt = 0, hit = null, end = pos;
  for (; tt < 3; tt += dt) {
    v.y -= ARROW_G * dt;
    const np = { x: pos.x + v.x * dt, y: pos.y + v.y * dt, z: pos.z + v.z * dt };
    const sl = Math.hypot(np.x - pos.x, np.y - pos.y, np.z - pos.z), dn = { x: (np.x - pos.x) / sl, y: (np.y - pos.y) / sl, z: (np.z - pos.z) / sl };
    let best = null;
    for (const t of L.players.values()) { if (!t.alive || !isEnemy(L, p, t)) continue; const h = rayHitPlayer(pos, dn, t); if (h && h.t <= sl && (!best || h.t < best.h.t)) best = { t, h }; }
    const wt = L.map.rayWallDistance(pos, dn, sl);
    if (best && best.h.t <= wt) { hit = best; end = { x: pos.x + dn.x * best.h.t, y: pos.y + dn.y * best.h.t, z: pos.z + dn.z * best.h.t }; break; }
    if (wt < sl) { end = { x: pos.x + dn.x * wt, y: pos.y + dn.y * wt, z: pos.z + dn.z * wt }; break; }
    Object.assign(pos, np); end = np;
  }
  L.bcast({ t: 'fx', from: p.id, w: wIdx, o, e: end, arrow: 1, c: +charge.toFixed(2), q: 1 });
  if (hit) L.pending.push({ at: Date.now() + tt * 1000, fn: () => { if (hit.t.alive) damage(L, p, hit.t, dmg * (hit.h.head ? 2 : 1), hit.h.head, wIdx); } });
}
function startReload(L, p, wIdx, now = Date.now()) {
  const w = WEAPONS[wIdx]; if (!w?.mag || L.legacy || !allowed(L, p, wIdx)) return;
  if (now < (p.reloadUntil[wIdx] || 0)) return;
  if ((p.ammo[wIdx] ?? w.mag) >= w.mag) return;
  p.reloadUntil[wIdx] = now + w.reload * 1000 * (hasPerk(L, p, 'manos') ? 0.65 : 1) * 0.85; // 15% latency tolerance
  p.ammo[wIdx] = w.mag;
}
export function damage(L, by, t, amount, head, wIdx = 0, kind = 'gun') {
  if (!t.alive || L.state !== 'playing') return;
  if (by !== t && !isEnemy(L, by, t)) return;                       // no friendly fire
  if (kind === 'exp' && hasPerk(L, t, 'blindaje')) amount *= 0.5;    // Blindaje Térmico
  if (t.hp - amount <= 0 && t.hp > 1 && hasPerk(L, t, 'segunda') && !t.secondUsed && by !== t) { t.secondUsed = true; amount = t.hp - 1; L.sendTo(t, { t: 'second' }); }
  t.hp -= amount;
  L.bcast({ t: 'hit', by: by.id, target: t.id, dmg: Math.round(amount), hp: Math.max(0, Math.round(t.hp)) });
  if (t.hp <= 0 && t.alive) kill(L, by, t, head, wIdx);
}
function kill(L, by, t, head, wIdx) {
  const now = Date.now();
  t.alive = false; t.hp = 0; t.deaths++; t.respawnAt = now + RESPAWN_MS; t.streak = 0;
  if (L.ctf) for (const f of L.ctf) if (f.carrier === t.id) { f.carrier = null; f.x = t.x; f.z = t.z; f.droppedAt = now; L.bcast({ t: 'obj', ev: 'drop', team: f.team, by: t.id }); }
  let multi = 0, streakN = 0;
  if (by !== t) {
    by.kills++; by.multi = now - by.lastKillAt < 4000 ? by.multi + 1 : 1; by.lastKillAt = now; multi = by.multi;
    if (!L.legacy && wIdx >= 0) { by.streak++; streakN = by.streak; for (const s of STREAKS) if (by.streak === s.kills && !by.ready.has(s.id)) { by.ready.add(s.id); L.sendTo(by, { t: 'streakReady', id: s.id }); } }
    if (L.mode === 'tdm') L.score[by.team]++;
  }
  let pts = 0;
  if (t.zombie && !by.zombie) { pts = Math.round(ZTYPES[t.zombie].pts * (head ? 1.3 : 1)); by.score = (by.score || 0) + pts; t.deadAt = now; }
  L.bcast({ t: 'kill', killer: by.id, victim: t.id, head, w: wIdx, multi, streak: streakN, first: L.firstBlood ? 0 : 1, pts: pts || undefined, zt: t.zombie || undefined });
  L.firstBlood = true;
  L.bcast({ t: 'score', board: board(L), sc: L.score });
  checkLimits(L);
}

// ------------------------------------------------------------ scorestreaks, grenades, falls
export function useStreak(L, p, id, arg = {}) {
  if (L.legacy || !p.ready.has(id) || L.state !== 'playing') return;
  const now = Date.now(); p.ready.delete(id);
  if (id === 'uav') { L.uav.push({ team: p.team, owner: p.id, until: now + 25000 }); L.bcast({ t: 'streak', id, by: p.id, team: p.team, until: now + 25000 }); }
  if (id === 'air') {
    let x = +arg.x, z = +arg.z; if (!Number.isFinite(x) || !Number.isFinite(z)) { x = p.x - Math.sin(p.yaw) * 15; z = p.z - Math.cos(p.yaw) * 15; }
    x = Math.max(1.5, Math.min(L.map.w - 1.5, x)); z = Math.max(1.5, Math.min(L.map.l - 1.5, z));
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw), pts = [];
    for (let i = -3; i <= 3; i++) pts.push({ x: Math.max(1, Math.min(L.map.w - 1, x + dx * i * 2.4)), y: 0.3, z: Math.max(1, Math.min(L.map.l - 1, z + dz * i * 2.4)) });
    L.bcast({ t: 'streak', id, by: p.id, team: p.team, pts, at: now + 2500 });
    pts.forEach((pt, k) => L.pending.push({ at: now + 2500 + k * 140, fn: () => { pt.y = L.map.heightAt(pt.x, pt.z) + 0.3; splash(L, p, pt, null, 4.2, 170, -2); } }));
  }
  if (id === 'heli') { const h = { owner: p.id, team: p.team, until: now + 25000, ang: Math.random() * 6, x: L.map.w / 2, y: 9, z: L.map.l / 2, cd: 1 }; L.helis.push(h); L.bcast({ t: 'streak', id, by: p.id, team: p.team, until: h.until }); }
}
export function throwNade(L, p, kind, o0, d0) {
  if (L.legacy || !p.alive || L.state !== 'playing' || !(kind === 'frag' || kind === 'flash' || (kind === 'mono' && L.mode === 'surv')) || !(p.nades[kind] > 0)) return;
  const r = aimRay(L, p, o0, d0); if (!r) return; p.nades[kind]--;
  const { o, d } = r, now = Date.now();
  const pos = { ...o }, v = { x: d.x * 15, y: d.y * 15 + 3, z: d.z * 15 }; let stuck = false;
  for (let tt = 0; tt < FUSE; tt += 0.02) {
    if (stuck) break;
    v.y -= NADE_G * 0.02;
    const np = { x: pos.x + v.x * 0.02, y: pos.y + v.y * 0.02, z: pos.z + v.z * 0.02 };
    const g = L.map.heightAt(np.x, np.z);
    if (g > pos.y) { stuck = true; break; }                 // hit a wall: drop next to it
    if (np.y <= g + 0.1) { np.y = g + 0.1; v.x *= 0.4; v.z *= 0.4; v.y = Math.abs(v.y) * 0.25; if (Math.hypot(v.x, v.z) < 0.5) stuck = true; }
    Object.assign(pos, np);
  }
  pos.y = Math.max(pos.y, L.map.heightAt(pos.x, pos.z) + 0.1);
  if (kind === 'mono') { // lands, clangs + flashes for 5 s (zombies chase it), then explodes
    const land = now + 900, at = land + SURV.monoLureMs, lure = { x: pos.x, z: pos.z, active: false, until: at };
    L.surv.lures.push(lure);
    L.bcast({ t: 'nade', kind, by: p.id, o, e: pos, land, at });
    L.pending.push({ at: land, fn: () => { lure.active = true; } });
    L.pending.push({ at, fn: () => { lure.active = false; splash(L, p, pos, null, MONO.radius, MONO.damage, -8); } });
    sendSurvLo(L, p);
    return;
  }
  L.bcast({ t: 'nade', kind, by: p.id, o, e: pos, at: now + FUSE * 1000 });
  L.pending.push({ at: now + FUSE * 1000, fn: () => {
    if (kind === 'frag') return splash(L, p, pos, null, 4.2, 130, -4);
    for (const t of L.players.values()) {
      if (!t.alive || !isEnemy(L, p, t)) continue;
      const dd = Math.hypot(t.x - pos.x, t.z - pos.z); if (dd > 10 || !L.map.lineOfSight({ x: pos.x, y: pos.y + 0.3, z: pos.z }, { x: t.x, y: t.y + EYE, z: t.z })) continue;
      const dur = (3.2 - dd * 0.2) * (hasPerk(L, t, 'antiflash') ? 0.3 : 1);
      t.flashedUntil = Date.now() + dur * 1000; if (t.ai) t.ai.blindUntil = t.flashedUntil;
      L.sendTo(t, { t: 'flashed', dur });
    }
  } });
}
export function fallDamage(L, p, dmg) {
  if (L.legacy || !p.alive || hasPerk(L, p, 'pluma')) return;
  dmg = Math.max(0, Math.min(60, +dmg || 0)); if (dmg) damage(L, p, p, dmg, false, -5, 'fall');
}

// ------------------------------------------------------------ client messages
export function handleMsg(L, p, m) {
  if (!p) return;
  const now = Date.now();
  switch (m.t) {
    case 'state': {
      if (!p.alive || L.state !== 'playing') return;
      const x = +m.x, y = +m.y, z = +m.z; if (![x, y, z].every(Number.isFinite)) return;
      const dt = Math.max(0.016, (now - p.lastStateAt) / 1000); p.lastStateAt = now;
      const dist = Math.hypot(x - p.x, z - p.z), maxSp = SPEED * (L.legacy ? 1 : 1.5); // v2: sprint + light-weapon bonus
      if (dist > maxSp * dt * 1.6 + 0.4 || y < -0.1 || y > 5 || L.map.blocked(x, z, 0.25, y)) { L.sendTo(p, { t: 'correct', x: p.x, y: p.y, z: p.z }); return; }
      Object.assign(p, { x, y, z, yaw: +m.yaw || 0, pitch: +m.pitch || 0 });
      break;
    }
    case 'shot': if (m.o && m.d) fire(L, p, m.w | 0, { x: +m.o.x, y: +m.o.y, z: +m.o.z }, { x: +m.d.x, y: +m.d.y, z: +m.d.z }, +m.c); break;
    case 'reload': startReload(L, p, m.w | 0); break;
    case 'streak': useStreak(L, p, String(m.id), m); break;
    case 'nade': if (m.o && m.d) throwNade(L, p, String(m.kind), { x: +m.o.x, y: +m.o.y, z: +m.o.z }, { x: +m.d.x, y: +m.d.y, z: +m.d.z }); break;
    case 'fall': fallDamage(L, p, m.dmg); break;
    case 'loadout': setLoadout(L, p, m.lo); break;
    case 'box': if (L.mode === 'surv') openBox(L, p); break;
    case 'pick': if (L.mode === 'surv') pickUp(L, p, m.id | 0); break;
  }
}

// ------------------------------------------------------------ bots
function flowTo(L, x, z) {
  const k = Math.floor(x) + Math.floor(z) * L.map.w, now = Date.now();
  let c = L.flowCache.get(k);
  if (!c || now - c.at > 1500) { c = { at: now, f: flowField(L.map, x, z) }; L.flowCache.set(k, c); }
  return c.f;
}
function botLegacy(L, b, dt) { // v1 behaviour (paid / free test lobbies), unchanged
  const ai = b.ai, now = Date.now();
  let tgt = null, td = 1e9;
  for (const o of L.players.values()) if (o !== b && o.alive) { const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < td) { td = d; tgt = o; } }
  if (!tgt) return;
  const eye = { x: b.x, y: b.y + EYE, z: b.z }, tEye = { x: tgt.x, y: tgt.y + 1.2, z: tgt.z };
  const los = td < 30 && L.map.lineOfSight(eye, tEye);
  if (now > ai.flowAt || ai.target !== tgt.id) { ai.flow = flowField(L.map, tgt.x, tgt.z); ai.flowAt = now + 500; ai.target = tgt.id; }
  let dir;
  if (los && td < 12) {
    const fx = (tgt.x - b.x) / td, fz = (tgt.z - b.z) / td;
    if (Math.random() < 0.01) ai.strafe *= -1;
    dir = { x: -fz * ai.strafe + fx * (td > 6 ? 0.6 : -0.2), z: fx * ai.strafe + fz * (td > 6 ? 0.6 : -0.2) };
  } else dir = flowDir(L.map, ai.flow, b, tgt.x, tgt.z);
  const sp = 4.2 * dt; L.map.moveWalker(b, dir.x * sp, dir.z * sp, 0.3);
  b.yaw = Math.atan2(-(tgt.x - b.x), -(tgt.z - b.z));
  ai.cd -= dt;
  if (los && ai.cd <= 0) {
    ai.cd = 0.35 + Math.random() * 0.6;
    const err = 0.06 + td * 0.004;
    const dx = tEye.x - eye.x + (Math.random() - 0.5) * err * td, dy = tEye.y - eye.y + (Math.random() - 0.5) * err * td * 0.5, dz = tEye.z - eye.z + (Math.random() - 0.5) * err * td;
    fire(L, b, td < 10 ? 1 : 0, eye, { x: dx, y: dy, z: dz });
  }
}
// objective the bot walks to when nobody is in sight
function botGoal(L, b) {
  const ai = b.ai;
  if (L.mode === 'dom') {
    const mine = L.flags.filter((f) => f.owner !== b.team);
    const list = mine.length ? mine : L.flags;
    return list.reduce((a, f) => (dist2(f, b) + (f.id === 'B' ? -4 : 0) + ai.role * 6 < dist2(a, b) + ai.role * 6 ? f : a), list[0]);
  }
  if (L.mode === 'ctf') {
    const own = L.ctf[b.team], enemy = L.ctf[1 - b.team];
    if (enemy.carrier === b.id) return own.home;                          // bring it home
    if (own.carrier) { const c = L.players.get(own.carrier); if (c) return c; } // chase our flag
    if (own.carrier === null && (own.x !== own.home.x || own.z !== own.home.z)) return own;   // return dropped flag
    return ai.role < 0.75 ? enemy : own.home;
  }
  if (L.mode === 'surv') return { x: L.map.w / 2 + (ai.role - 0.5) * 8, z: L.map.l / 2 + Math.sin(ai.role * 20) * 4 };
  if (L.mode === 'snd') {
    const s = L.snd, site = L.sites[ai.role < 0.5 ? 0 : 1];
    if (s.bomb) return b.team === 1 ? s.bomb : { x: s.bomb.x + (ai.role - 0.5) * 6, z: s.bomb.z + 2 };
    return b.team === 0 ? site : { x: site.x + (ai.role - 0.5) * 4, z: site.z + 1.5 };
  }
  return null;
}
function botThink(L, b, dt) {
  if (!b.alive) return;
  if (L.legacy) return botLegacy(L, b, dt);
  const ai = b.ai, now = Date.now();
  const eye = { x: b.x, y: b.y + EYE, z: b.z };
  // visible enemies (quiet-footsteps perk: only noticed up close unless they just fired)
  let tgt = null, td = 1e9, vis = false;
  for (const o of L.players.values()) {
    if (!o.alive || !isEnemy(L, b, o)) continue;
    const d = Math.hypot(o.x - b.x, o.z - b.z);
    const range = hasPerk(L, o, 'suave') && now - o.lastShotAt > 1500 ? 16 : 32;
    if (d < range && d < td && L.map.lineOfSight(eye, { x: o.x, y: o.y + 1.2, z: o.z })) { td = d; tgt = o; vis = true; }
  }
  const goal = botGoal(L, b);
  if (!tgt && !goal) for (const o of L.players.values()) if (o.alive && isEnemy(L, b, o)) { const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < td) { td = d; tgt = o; } }
  let dir = { x: 0, z: 0 };
  const carrying = L.ctf && L.ctf.some((f) => f.carrier === b.id);
  const rush = goal && L.mode !== 'tdm' && Math.hypot(goal.x - b.x, goal.z - b.z) < 9; // push the objective while shooting
  if (vis && td < 12 && !carrying && !rush) {
    const fx = (tgt.x - b.x) / td, fz = (tgt.z - b.z) / td;
    if (Math.random() < 0.01) ai.strafe *= -1;
    dir = { x: -fz * ai.strafe + fx * (td > 6 ? 0.6 : -0.2), z: fx * ai.strafe + fz * (td > 6 ? 0.6 : -0.2) };
  } else {
    const dest = goal && (!vis || carrying || L.mode !== 'tdm') ? goal : tgt;
    if (dest) {
      const near = Math.hypot(dest.x - b.x, dest.z - b.z);
      if (near > (goal === dest ? 0.8 : 1.5)) dir = flowDir(L.map, flowTo(L, dest.x, dest.z), b, dest.x, dest.z);
      else if (goal === dest && L.mode !== 'snd') dir = { x: Math.sin(now / 700 + ai.role * 9) * 0.5, z: Math.cos(now / 900 + ai.role * 9) * 0.5 };
    }
  }
  const sp = 4.0 * dt * (WEAPONS[b.loadout.primary].move || 1); L.map.moveWalker(b, dir.x * sp, dir.z * sp, 0.3);
  if (vis) b.yaw = Math.atan2(-(tgt.x - b.x), -(tgt.z - b.z)); else if (dir.x || dir.z) b.yaw = Math.atan2(-dir.x, -dir.z);
  // scorestreaks: use them right away
  for (const id of [...b.ready]) {
    const foe = [...L.players.values()].find((o) => o.alive && isEnemy(L, b, o));
    useStreak(L, b, id, foe ? { x: foe.x, z: foe.z } : {});
  }
  ai.cd -= dt;
  if (vis && ai.cd <= 0 && now > ai.blindUntil) {
    const w = WEAPONS[b.loadout.primary];
    ai.cd = Math.max(w.fireRate, 0.12) + Math.random() * 0.35 + (w.bolt ? 0.6 : 0);
    if (b.nades.frag > 0 && td > 7 && td < 16 && Math.random() < 0.04) { throwNade(L, b, 'frag', eye, { x: tgt.x - b.x, y: 0.35 * td / 8, z: tgt.z - b.z }); return; }
    const tEye = { x: tgt.x, y: tgt.y + 1.2, z: tgt.z };
    const err = (0.05 + td * 0.004) / Math.max(0.3, L.botSkill);
    const dx = tEye.x - eye.x + (Math.random() - 0.5) * err * td, dy = tEye.y - eye.y + (Math.random() - 0.5) * err * td * 0.5, dz = tEye.z - eye.z + (Math.random() - 0.5) * err * td;
    if ((p => p.ammo[b.loadout.primary] ?? 1)(b) <= 0) startReload(L, b, b.loadout.primary, now);
    fire(L, b, b.loadout.primary, eye, { x: dx, y: dy, z: dz }, 1);
  }
}

// ------------------------------------------------------------ objective ticks
function tickObjectives(L, dt, now) {
  const alive = [...L.players.values()].filter((p) => p.alive);
  if (L.mode === 'dom') {
    for (const f of L.flags) {
      const n = [0, 0]; for (const p of alive) if (Math.hypot(p.x - f.x, p.z - f.z) < 2.6 && p.team < 2) n[p.team]++;
      if (n[0] && n[1]) continue; // contested
      const t = n[0] ? 0 : n[1] ? 1 : -1; if (t < 0) continue;
      const dir = t === 0 ? -1 : 1, rate = 0.28 * Math.min(3, n[t]) * dt;
      if (f.owner === t) { f.prog = dir; continue; }
      f.prog = Math.max(-1, Math.min(1, f.prog + dir * rate));
      if (Math.abs(f.prog) >= 1 && f.owner !== t) {
        f.owner = t; L.bcast({ t: 'obj', ev: 'cap', flag: f.id, team: t });
        for (const p of alive) if (p.team === t && Math.hypot(p.x - f.x, p.z - f.z) < 2.6) { p.caps++; L.sendTo(p, { t: 'medal', id: 'cap' }); }
      }
    }
    L.domAcc = (L.domAcc || 0) + dt;
    if (L.domAcc >= 1.5) { L.domAcc = 0; for (const f of L.flags) if (f.owner >= 0) L.score[f.owner]++; L.bcast({ t: 'score', board: board(L), sc: L.score }); checkLimits(L); }
  }
  if (L.mode === 'ctf') {
    for (const f of L.ctf) {
      if (f.carrier) { const c = L.players.get(f.carrier); if (c?.alive) { f.x = c.x; f.z = c.z; } else { f.carrier = null; f.droppedAt = now; } continue; }
      const atHome = f.x === f.home.x && f.z === f.home.z;
      if (!atHome && now - f.droppedAt > 20000) { f.x = f.home.x; f.z = f.home.z; L.bcast({ t: 'obj', ev: 'return', team: f.team }); continue; }
      for (const p of alive) {
        if (Math.hypot(p.x - f.x, p.z - f.z) > 1.3) continue;
        if (p.team !== f.team) { f.carrier = p.id; L.bcast({ t: 'obj', ev: 'take', team: f.team, by: p.id }); break; }
        if (!atHome) { f.x = f.home.x; f.z = f.home.z; L.bcast({ t: 'obj', ev: 'return', team: f.team, by: p.id }); break; }
      }
    }
    for (const t of [0, 1]) { // capture: carry the enemy flag to your home flag while yours is home
      const enemy = L.ctf[1 - t], own = L.ctf[t]; if (!enemy.carrier) continue;
      const c = L.players.get(enemy.carrier);
      if (c && own.carrier === null && own.x === own.home.x && own.z === own.home.z && Math.hypot(c.x - own.home.x, c.z - own.home.z) < 1.6) {
        L.score[t]++; c.caps++; enemy.carrier = null; enemy.x = enemy.home.x; enemy.z = enemy.home.z;
        L.bcast({ t: 'obj', ev: 'capture', team: t, by: c.id }); L.sendTo(c, { t: 'medal', id: 'capture' });
        L.bcast({ t: 'score', board: board(L), sc: L.score }); checkLimits(L);
      }
    }
  }
  if (L.mode === 'snd') tickSnd(L, dt, now, alive);
}
function tickSnd(L, dt, now, alive) {
  const s = L.snd;
  if (s.phase === 'post') { if (now >= s.postUntil) newRound(L); return; }
  const att = alive.filter((p) => p.team === 0), def = alive.filter((p) => p.team === 1);
  if (!s.bomb) {
    for (const p of att) {
      const site = L.sites.find((x) => Math.hypot(p.x - x.x, p.z - x.z) < 1.9);
      const v = site ? (s.plant.get(p.id) || 0) + dt / 3 : 0; s.plant.set(p.id, v);
      if (v >= 1) { s.bomb = { x: p.x, z: p.z, site: site.id, explodeAt: now + 30000 }; s.phase = 'planted'; s.plant.clear(); L.bcast({ t: 'obj', ev: 'plant', site: site.id, by: p.id }); L.sendTo(p, { t: 'medal', id: 'plant' }); p.caps++; break; }
    }
    if (!att.length) return endRound(L, 1, 'elim');
    if (!def.length) return endRound(L, 0, 'elim');
    if (now >= s.roundEndsAt) return endRound(L, 1, 'time');
  } else {
    const d = def.find((p) => Math.hypot(p.x - s.bomb.x, p.z - s.bomb.z) < 1.7);
    if (d) { if (s.defuser !== d.id) { s.defuser = d.id; s.defuse = 0; } s.defuse += dt / 5; } else { s.defuse = 0; s.defuser = null; }
    if (s.defuse >= 1) { L.bcast({ t: 'obj', ev: 'defuse', by: d.id }); L.sendTo(d, { t: 'medal', id: 'defuse' }); d.caps++; return endRound(L, 1, 'defuse'); }
    if (now >= s.bomb.explodeAt) {
      const by = [...L.players.values()].find((p) => p.team === 0) || alive[0];
      L.bcast({ t: 'obj', ev: 'boom', x: s.bomb.x, z: s.bomb.z });
      if (by) splash(L, by, { x: s.bomb.x, y: 0.5, z: s.bomb.z }, null, 8, 250, -6);
      return endRound(L, 0, 'boom');
    }
    if (!def.length) return endRound(L, 0, 'elim');
  }
}
function endRound(L, winner, why) {
  const s = L.snd; s.wins[winner]++; L.score = [...s.wins]; s.phase = 'post'; s.postUntil = Date.now() + 4500;
  L.bcast({ t: 'obj', ev: 'round', winner, why, wins: s.wins, round: s.round });
  L.bcast({ t: 'score', board: board(L), sc: L.score });
  checkLimits(L);
}
function newRound(L) {
  const s = L.snd; s.round++; s.phase = 'live'; s.bomb = null; s.defuse = 0; s.defuser = null; s.plant.clear(); s.roundEndsAt = Date.now() + L.M.round * 1000;
  for (const p of L.players.values()) { placeAtSpawn(L, p, true); p.respawnAt = 0; L.bcast({ t: 'respawn', id: p.id, x: p.x, z: p.z }); }
  L.bcast({ t: 'obj', ev: 'newround', round: s.round });
}
function checkLimits(L) {
  if (L.state !== 'playing' || !L.scoreLimit) return;
  if (L.teamMode ? Math.max(...L.score) >= L.scoreLimit : [...L.players.values()].some((p) => p.kills >= L.scoreLimit)) finish(L);
}
function finish(L) {
  if (L.state !== 'playing') return;
  L.state = 'ended';
  let winTeam = null;
  if (L.teamMode) winTeam = L.score[0] === L.score[1] ? -1 : (L.score[0] > L.score[1] ? 0 : 1);
  L.onEnd?.(L, { winTeam, sc: L.score });
}

// ------------------------------------------------------------ helicopters
function tickHelis(L, dt, now) {
  for (let i = L.helis.length - 1; i >= 0; i--) {
    const h = L.helis[i];
    if (now > h.until) { L.helis.splice(i, 1); continue; }
    h.ang += dt * 0.35;
    const R = Math.min(L.map.w, L.map.l) * 0.33;
    h.x = L.map.w / 2 + Math.cos(h.ang) * R; h.z = L.map.l / 2 + Math.sin(h.ang) * R * 1.4; h.y = 9;
    h.cd -= dt; if (h.cd > 0) continue;
    const owner = L.players.get(h.owner); if (!owner) continue;
    let best = null, bd = 1e9;
    for (const t of L.players.values()) {
      if (!t.alive || !isEnemy(L, owner, t)) continue;
      const d = Math.hypot(t.x - h.x, t.z - h.z);
      if (d < bd && d < 34 && L.map.lineOfSight({ x: h.x, y: h.y, z: h.z }, { x: t.x, y: t.y + 1, z: t.z })) { bd = d; best = t; }
    }
    if (!best) { h.cd = 0.3; continue; }
    h.cd = 0.32;
    const hitIt = Math.random() < 0.55;
    const e = { x: best.x + (hitIt ? 0 : (Math.random() - 0.5) * 2), y: best.y + 1, z: best.z + (hitIt ? 0 : (Math.random() - 0.5) * 2) };
    L.bcast({ t: 'fx', from: 'heli', w: -3, o: { x: h.x, y: h.y - 0.6, z: h.z }, e, q: 1 });
    if (hitIt) damage(L, owner, best, 11, false, -3);
  }
}

// ------------------------------------------------------------ main tick
export function tickMatch(L, dt, now = Date.now()) {
  if (L.state !== 'playing') return;
  for (let i = L.pending.length - 1; i >= 0; i--) if (now >= L.pending[i].at) { const e = L.pending[i]; L.pending.splice(i, 1); e.fn(); if (L.state !== 'playing') return; }
  const respawns = L.legacy || L.M.respawn;
  for (const p of L.players.values()) {
    if (p.zombie) continue;
    if (!p.alive && respawns && now >= p.respawnAt) respawn(L, p);
    if (p.bot) botThink(L, p, dt);
  }
  if (!L.legacy) { tickObjectives(L, dt, now); tickHelis(L, dt, now); L.uav = L.uav.filter((u) => u.until > now); }
  if (L.mode === 'surv') tickSurv(L, dt, now);
  if (L.state !== 'playing') return;
  const snap = { t: 'snap', p: [...L.players.values()].map((p) => p.zombie
    ? { id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), mh: p.maxHp, alive: p.alive, tm: 1, zt: p.zombie }
    : { id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), alive: p.alive, bot: p.bot, tm: p.team, g: hasPerk(L, p, 'fantasma') ? 1 : 0, w: p.bot && !L.legacy ? p.loadout.primary : undefined, pt: L.mode === 'surv' ? Math.round(p.score || 0) : undefined }) };
  if (!L.legacy) {
    snap.sc = L.score; snap.u = L.uav.map((u) => [u.team, u.owner]);
    if (L.helis.length) snap.h = L.helis.map((h) => [+h.x.toFixed(1), h.y, +h.z.toFixed(1), +h.ang.toFixed(2), h.team, h.owner]);
    if ((L.snapN++ % 4) === 0 || L.objDirty) { snap.o = objState(L); L.objDirty = false; }
  }
  L.bcast(snap);
  if (now >= L.endsAt) finish(L);
}

// ------------------------------------------------------------ Survive the 150 (co-op zombie waves)
// Zombies live in L.players (team 1) so every weapon, splash, streak and heli already hits them server-side.
const BOX_POOL = WEAPONS.map((w, i) => i);                 // ALL weapons (v1 + v2) ...
const PICKUP_POOL = WEAPONS.map((w, i) => (w.legacy ? -1 : i)).filter((i) => i >= 0);
function setupSurv(L) {
  const m = L.map, free = m.freeCells().filter(([x, z]) => Math.hypot(x - m.w / 2, z - m.l / 2) < 13.5);
  L.surv = { wave: L.survStart - 1, phase: 'break', nextAt: Date.now() + SURV.firstBreakMs, toSpawn: 0, queue: [], spawnAt: 0, zid: 0, pid: 0,
    gates: m.gates || [[m.w / 2, 2.5], [m.w / 2, m.l - 2.5]], box: m.box || { x: m.w / 2, z: m.l / 2 + 6 }, free, pickups: [], lures: [], boxBusy: new Map() };
  for (const p of L.players.values()) { p.score = 0; p.nades.mono = 0; }
  refillPickups(L);
}
function refillPickups(L) {
  const S = L.surv;
  while (S.pickups.length < SURV.pickups && S.free.length) {
    const [x, z] = S.free[Math.floor(Math.random() * S.free.length)];
    if (S.pickups.some((k) => Math.hypot(k.x - x, k.z - z) < 4) || Math.hypot(x - S.box.x, z - S.box.z) < 3) { if (Math.random() < 0.9) continue; }
    S.pickups.push({ id: ++S.pid, x, z, w: rnd(PICKUP_POOL) });
  }
  L.objDirty = true;
}
export function waveSpec(n) {
  return { total: Math.min(60, 5 + Math.round(n * 1.4)), hpK: 1 + n * 0.045, spK: Math.min(1.55, 1 + n * 0.006), dmgK: 1 + n * 0.02,
    bosses: n % 10 === 0 ? 1 + Math.floor(n / 60) : 0, runnerP: n < 4 ? 0 : Math.min(0.45, 0.1 + n * 0.006), bruteP: n < 8 ? 0 : Math.min(0.25, 0.04 + n * 0.0025) };
}
function startWave(L, now) {
  const S = L.surv; S.wave++; S.phase = 'wave';
  const sp = waveSpec(S.wave), q = [];
  for (let i = 0; i < sp.total; i++) { const r = Math.random(); q.push(r < sp.bruteP ? 'brute' : r < sp.bruteP + sp.runnerP ? 'runner' : 'walker'); }
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  for (let i = 0; i < sp.bosses; i++) q.splice(Math.floor(q.length * 0.4), 0, 'boss');
  S.queue = q; S.toSpawn = q.length; S.spawnAt = now + 800; S.spec = sp;
  for (const p of L.players.values()) if (!p.zombie && !p.alive) { placeAtSpawn(L, p, true); p.respawnAt = 0; L.bcast({ t: 'respawn', id: p.id, x: p.x, z: p.z }); sendSurvLo(L, p); }
  L.bcast({ t: 'obj', ev: 'wave', wave: S.wave, total: q.length, boss: sp.bosses });
  L.objDirty = true;
}
function spawnZombie(L, type) {
  const S = L.surv, T = ZTYPES[type], sp = S.spec, [gx, gz] = S.gates[Math.floor(Math.random() * S.gates.length)];
  const x = gx + (Math.random() - 0.5) * 1.6, z = gz + (Math.random() - 0.5) * 1.6;
  const hp = Math.round(T.hp * sp.hpK);
  const zb = { id: 'Z' + (++S.zid), name: T.name, zombie: type, conn: null, bot: false, x, y: L.map.groundUnder(x, z, 0.3), z, yaw: 0, pitch: 0, hp, maxHp: hp, alive: true,
    kills: 0, deaths: 0, lastKillAt: 0, multi: 0, team: 1, side: 1, loadout: { primary: -1, secondary: -1, perks: [] }, ammo: {}, reloadUntil: {}, lastShot: {}, ready: new Set(),
    nades: {}, streak: 0, score: 0, sc: T.scale, sp: T.sp * sp.spK * (0.9 + Math.random() * 0.2), dmg: T.dmg * sp.dmgK, atkAt: 0, lastShotAt: 0, caps: 0, flashedUntil: 0 };
  L.players.set(zb.id, zb);
}
function zombieThink(L, zb, dt, now, humans, zs) {
  if (!zb.alive) return;
  const S = L.surv;
  let tgt = null, td = 1e9, lure = null;
  for (const l of S.lures) if (l.active) { const d = Math.hypot(l.x - zb.x, l.z - zb.z); if (d < 30 && d < td) { td = d; lure = l; } }
  if (lure) tgt = lure;
  else for (const h of humans) if (h.alive) { const d = Math.hypot(h.x - zb.x, h.z - zb.z); if (d < td) { td = d; tgt = h; } }
  if (zb.flashedUntil > now || !tgt) return;
  let dir = { x: 0, z: 0 };
  if (td > (lure ? 0.6 : 0.95)) {
    if (td < 3) dir = { x: (tgt.x - zb.x) / td, z: (tgt.z - zb.z) / td };
    else dir = flowDir(L.map, flowTo(L, tgt.x, tgt.z), zb, tgt.x, tgt.z);
  }
  for (const o of zs) { // don't stack on top of each other
    if (o === zb || !o.alive) continue; const dx = zb.x - o.x, dz = zb.z - o.z, d = Math.hypot(dx, dz);
    if (d < 0.7 && d > 1e-3) { dir.x += (dx / d) * 0.6; dir.z += (dz / d) * 0.6; }
  }
  const sp = zb.sp * dt; L.map.moveWalker(zb, dir.x * sp, dir.z * sp, 0.3);
  if (dir.x || dir.z) zb.yaw = Math.atan2(-(tgt.x - zb.x), -(tgt.z - zb.z));
  if (!lure && td < (zb.zombie === 'boss' ? 1.8 : 1.2) && now >= zb.atkAt && Math.abs((tgt.y || 0) - zb.y) < 1.5) {
    zb.atkAt = now + (zb.zombie === 'runner' ? 700 : 1000);
    damage(L, zb, tgt, zb.dmg, false, -7, 'zombie');
  }
}
function sendSurvLo(L, p) { if (p.conn) L.sendTo(p, { t: 'survLo', primary: p.loadout.primary, secondary: p.loadout.secondary, mono: p.nades.mono || 0, frag: p.nades.frag || 0 }); }
function giveWeapon(L, p, w) {
  const slot = WEAPONS[w].slot === 'secondary' ? 'secondary' : 'primary', old = p.loadout[slot];
  p.loadout[slot] = w; delete p.ammo[w]; p.reloadUntil[w] = 0;
  sendSurvLo(L, p);
  return { slot, old };
}
function openBox(L, p) {
  const S = L.surv, now = Date.now();
  if (!p.alive || L.state !== 'playing' || Math.hypot(p.x - S.box.x, p.z - S.box.z) > 2.6) return;
  if ((S.boxBusy.get(p.id) || 0) > now || (p.score || 0) < SURV.boxCost) return L.sendTo(p, { t: 'boxNo', need: SURV.boxCost, have: Math.round(p.score || 0) });
  p.score -= SURV.boxCost; S.boxBusy.set(p.id, now + 2600);
  const mono = Math.random() < 0.12, w = mono ? -1 : rnd(BOX_POOL);              // ... plus the Mono Bomba
  L.bcast({ t: 'boxOpen', by: p.id, w, at: now + 2200 });
  L.pending.push({ at: now + 2200, fn: () => {
    if (mono) { p.nades.mono = Math.min(SURV.monoMax, (p.nades.mono || 0) + 2); sendSurvLo(L, p); }
    else giveWeapon(L, p, w);
    L.sendTo(p, { t: 'boxGot', w });
  } });
}
function pickUp(L, p, id) {
  const S = L.surv, k = S.pickups.find((x) => x.id === id);
  if (!k || !p.alive || Math.hypot(p.x - k.x, p.z - k.z) > 2.0) return;
  const { old } = giveWeapon(L, p, k.w);
  if (old >= 0 && !WEAPONS[old].legacy) k.w = old; else S.pickups.splice(S.pickups.indexOf(k), 1); // swap: your old gun stays on the floor
  L.sendTo(p, { t: 'boxGot', w: p.loadout[WEAPONS[k.w]?.slot === 'secondary' ? 'secondary' : 'primary'], pick: 1 });
  L.objDirty = true;
}
function tickSurv(L, dt, now) {
  const S = L.surv, all = [...L.players.values()];
  for (const p of all) if (p.zombie && !p.alive && now - (p.deadAt || 0) > 100) L.players.delete(p.id);
  const humans = all.filter((p) => !p.zombie), zs = all.filter((p) => p.zombie && p.alive);
  const core = humans.filter((p) => !p.bot), pool = core.length ? core : humans;  // all-bot sims: bots count as players
  if (!pool.some((p) => p.alive)) return finishSurv(L, false);
  if (S.phase === 'break') { if (now >= S.nextAt) startWave(L, now); }
  else {
    if (S.toSpawn > 0 && zs.length < SURV.maxAlive && now >= S.spawnAt) { spawnZombie(L, S.queue.pop()); S.toSpawn--; S.spawnAt = now + Math.max(220, 1100 - S.wave * 7); }
    if (S.toSpawn <= 0 && !zs.length) {
      for (const p of humans) if (p.alive) p.score = (p.score || 0) + 100 + S.wave * 10;
      L.bcast({ t: 'obj', ev: 'waveClear', wave: S.wave, bonus: 100 + S.wave * 10 });
      if (S.wave >= SURV.waves) return finishSurv(L, true);
      S.phase = 'break'; S.nextAt = now + SURV.breakMs; refillPickups(L);
      for (const p of humans) { p.nades.frag = Math.max(p.nades.frag || 0, hasPerk(L, p, 'bolsillo') ? 2 : 1); sendSurvLo(L, p); }
      L.objDirty = true;
    }
  }
  for (const zb of zs) zombieThink(L, zb, dt, now, humans, zs);
  S.lures = S.lures.filter((l) => l.until > now);
}
function finishSurv(L, win) {
  if (L.state !== 'playing') return;
  const S = L.surv; L.state = 'ended';
  L.onEnd?.(L, { winTeam: win ? 0 : 1, sc: [win ? SURV.waves : S.wave - 1, SURV.waves], surv: { wave: S.wave, win } });
}
