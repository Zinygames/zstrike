// ZStrike multiplayer server (free: Node + ws).
// - Serves the static game (parent folder) and a WebSocket endpoint at /ws
// - Lobby matchmaking, server-authoritative movement checks, hits, kills, score
// - Paid lobbies: entry paid on-chain to an escrow wallet and verified before seating;
//   winner + treasury payout signed by the escrow keypair (stored ONLY on this server).
// DEVNET ONLY in v1. See README.md for the legal warning before any mainnet use.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as web3 from '@solana/web3.js';
import { createMap, MAPS, DEFAULT_MAP, rayHitPlayer } from '../map.js';
import { flowField, flowDir } from '../ai.js';
import { WEAPONS } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------ env
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*([^#]*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
})();
const E = process.env;
const CFG = {
  port: +(E.PORT || 8080),
  cluster: E.CLUSTER || 'devnet',
  rpc: E.RPC_URL || 'https://api.devnet.solana.com',
  treasury: E.TREASURY || 'EiitkVBCV75BgSxrGMjr49if3Ug4n3orgvvE7E5vU6iH',
  lobbySize: +(E.LOBBY_SIZE || 10),
  entryUsd: +(E.ENTRY_USD || 2),
  winnerShare: +(E.WINNER_SHARE || 0.5),
  matchSeconds: +(E.MATCH_SECONDS || 300),
  testMode: (E.TEST_MODE ?? '1') === '1',
  testLobbySize: +(E.TEST_LOBBY_SIZE || E.LOBBY_SIZE || 10),
  fallbackSolUsd: +(E.FALLBACK_SOL_USD || 150),
  lobbyTimeoutMin: +(E.LOBBY_TIMEOUT_MIN || 15),
  voteSeconds: +(E.VOTE_SECONDS || 10),
};
if (CFG.cluster !== 'devnet' && E.ALLOW_MAINNET !== 'I_HAVE_LEGAL_ADVICE') {
  console.error('Refusing to start: v1 is DEVNET ONLY (see README legal warning).'); process.exit(1);
}

// ------------------------------------------------------------ escrow keypair (server-only secret)
function loadEscrow() {
  if (E.ESCROW_SECRET_KEY) return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(E.ESCROW_SECRET_KEY)));
  const dir = path.join(__dirname, 'secrets'), f = path.join(dir, 'escrow.json');
  if (fs.existsSync(f)) return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const kp = web3.Keypair.generate();
  fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log('Generated new escrow keypair at server/secrets/escrow.json (keep private, never commit).');
  return kp;
}
const escrow = loadEscrow();
const conn = new web3.Connection(CFG.rpc, 'confirmed');
const LAMPORTS = web3.LAMPORTS_PER_SOL;
const RESERVE_LAMPORTS = 0.01 * LAMPORTS; // escrow float for fees + rent; never paid out

// ------------------------------------------------------------ persistence (used signatures, payouts)
const DATA = path.join(__dirname, 'data'); fs.mkdirSync(DATA, { recursive: true });
const usedSigsFile = path.join(DATA, 'used-sigs.json');
const usedSigs = new Set(fs.existsSync(usedSigsFile) ? JSON.parse(fs.readFileSync(usedSigsFile, 'utf8')) : []);
const saveSigs = () => fs.writeFileSync(usedSigsFile, JSON.stringify([...usedSigs]));
const logLedger = (o) => fs.appendFileSync(path.join(DATA, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');

// ------------------------------------------------------------ SOL/USD price (CoinGecko free API + fallback)
let price = { usd: CFG.fallbackSolUsd, source: 'fallback', at: 0 };
// Free price sources, tried in order (some APIs rate-limit or block cloud IPs).
const PRICE_SOURCES = [
  ['coingecko', 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', (j) => j?.solana?.usd],
  ['coinbase', 'https://api.coinbase.com/v2/prices/SOL-USD/spot', (j) => parseFloat(j?.data?.amount)],
  ['kraken', 'https://api.kraken.com/0/public/Ticker?pair=SOLUSD', (j) => parseFloat(Object.values(j?.result || {})[0]?.c?.[0])],
];
async function solUsd() {
  if (Date.now() - price.at < 60_000) return price;
  for (const [name, url, pick] of PRICE_SOURCES) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json', 'user-agent': 'zstrike-server' } });
      const v = pick(await r.json());
      if (v > 0) { price = { usd: v, source: name, at: Date.now() }; return price; }
    } catch { /* try next source */ }
  }
  // all sources failed: keep the last live price (marked stale) or use the configured fallback
  price = price.source === 'fallback' ? { usd: CFG.fallbackSolUsd, source: 'fallback', at: Date.now() }
    : { usd: price.usd, source: price.source.replace(/-stale$/, '') + '-stale', at: Date.now() };
  return price;
}
const usdToLamports = (usd, p) => Math.ceil((usd / p) * LAMPORTS);

// ------------------------------------------------------------ static file server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, lobbies: lobbies.size, cluster: CFG.cluster })); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  // never serve the server folder, dotfiles or anything outside the game folder
  if (!f.startsWith(ROOT + path.sep) || f.startsWith(path.join(ROOT, 'server')) || f.split(path.sep).some((s) => s.startsWith('.')) || f.includes('node_modules')) {
    res.writeHead(404); return res.end('not found');
  }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

// ------------------------------------------------------------ game state
const TICK = 50, EYE = 1.55, MAX_HP = 100, RESPAWN_MS = 3000, SPEED = 6;
const lobbies = new Map();
const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];
let nextId = 1;
const newId = (p) => p + (nextId++).toString(36);

function makeLobby({ paid, mapId, size }) {
  const id = newId('L');
  const L = { id, paid, mapId: MAPS[mapId] ? mapId : DEFAULT_MAP, size, players: new Map(), votes: new Map(), state: 'waiting', createdAt: Date.now(), potLamports: 0, endsAt: 0, countdownAt: 0 };
  L.map = createMap(L.mapId);
  lobbies.set(id, L); return L;
}
function lobbyBroadcast(L, m) { const s = JSON.stringify(m); for (const p of L.players.values()) if (p.conn?.ws.readyState === 1) p.conn.ws.send(s); }
function lobbySummary(L) {
  return { t: 'lobby', id: L.id, size: L.size, state: L.state, map: L.mapId, paid: L.paid,
    countdown: L.state === 'countdown' ? Math.ceil((L.countdownAt - Date.now()) / 1000) : 0,
    maps: Object.keys(MAPS), votes: voteCounts(L),
    players: [...L.players.values()].map((p) => ({ id: p.id, name: p.name, bot: p.bot, vote: L.votes.get(p.id) || null })) };
}
// ---- map vote (server-authoritative): humans vote, majority wins, ties broken at random
function voteCounts(L) {
  const c = Object.fromEntries(Object.keys(MAPS).map((k) => [k, 0]));
  for (const [pid, m] of L.votes) if (L.players.has(pid) && c[m] !== undefined) c[m]++;
  return c;
}
function castVote(L, pid, mapId) {
  if (!MAPS[mapId] || !(L.state === 'waiting' || L.state === 'countdown')) return false;
  L.votes.set(pid, mapId); return true;
}
function resolveVote(L) {
  const c = voteCounts(L), max = Math.max(...Object.values(c));
  const tied = Object.keys(c).filter((k) => c[k] === max); // max 0 => all maps tie => random
  const pick = tied[crypto.randomInt(tied.length)];
  L.mapId = pick; L.map = createMap(pick);
  return { map: pick, counts: c, tie: tied.length > 1, tied };
}
function board(L) { return [...L.players.values()].map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, bot: p.bot })); }

function addPlayer(L, { conn, name, bot = false, pubkey = null, entryLamports = 0, entrySig = null }) {
  const p = { id: bot ? newId('B') : conn.id, name, conn, bot, pubkey, entryLamports, entrySig,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastKillAt: 0,
    cdUntil: 0, respawnAt: 0, lastStateAt: Date.now(), side: L.players.size % 2, ai: bot ? { cd: 1, flowAt: 0, flow: null, target: null, strafe: Math.random() < 0.5 ? 1 : -1 } : null };
  L.players.set(p.id, p);
  if (conn) conn.lobby = L;
  L.potLamports += entryLamports;
  return p;
}

function pickSpawn(L, p) {
  const all = [...L.map.spawns[0], ...L.map.spawns[1]];
  // spawn as far as possible from living opponents
  let best = all[0], bestD = -1;
  for (const s of all) {
    let dmin = 1e9;
    for (const o of L.players.values()) if (o !== p && o.alive) dmin = Math.min(dmin, Math.hypot(o.x - s[0], o.z - s[1]));
    const d = dmin + Math.random() * 3;
    if (d > bestD) { bestD = d; best = s; }
  }
  return best;
}
function respawn(L, p) {
  const [x, z] = pickSpawn(L, p);
  Object.assign(p, { x, y: L.map.groundUnder(x, z, 0.3), z, hp: MAX_HP, alive: true, lastStateAt: Date.now(), yaw: z > L.map.l / 2 ? 0 : Math.PI });
  lobbyBroadcast(L, { t: 'respawn', id: p.id, x, z });
}

function maybeStart(L) {
  if (L.state !== 'waiting' || L.players.size < L.size) return;
  L.state = 'countdown'; L.countdownAt = Date.now() + CFG.voteSeconds * 1000;
  lobbyBroadcast(L, lobbySummary(L));
}
function startMatch(L) {
  const vote = resolveVote(L);
  lobbyBroadcast(L, { t: 'mapResult', ...vote, name: MAPS[vote.map].name });
  L.state = 'playing'; L.endsAt = Date.now() + CFG.matchSeconds * 1000;
  const spawns = [...L.map.spawns[0], ...L.map.spawns[1]];
  let i = 0;
  for (const p of L.players.values()) {
    const s = spawns[(i % 2 ? Math.floor(i / 2) + L.map.spawns[0].length : Math.floor(i / 2)) % spawns.length]; i++;
    Object.assign(p, { x: s[0], y: L.map.groundUnder(s[0], s[1], 0.3), z: s[1], hp: MAX_HP, alive: true, lastStateAt: Date.now() });
    if (p.conn) send(p.conn, { t: 'start', map: L.mapId, secondsLeft: CFG.matchSeconds, spawn: { x: s[0], z: s[1] }, board: board(L) });
  }
  console.log(`[${L.id}] match started (${L.paid ? 'PAID' : 'test'}) map=${L.mapId} players=${L.players.size}`);
}

// ------------------------------------------------------------ combat (server-authoritative)
function fire(L, p, wIdx, o, d) {
  const w = WEAPONS[wIdx]; const now = Date.now();
  if (!w || !p.alive || L.state !== 'playing') return;
  if (now < p.cdUntil) return;                          // fire-rate enforced server-side
  p.cdUntil = now + w.fireRate * 1000 * 0.85;
  const eye = { x: p.x, y: p.y + EYE, z: p.z };
  if (Math.hypot(o.x - eye.x, o.y - eye.y, o.z - eye.z) > 1.2) o = eye; // don't trust client origin
  const len = Math.hypot(d.x, d.y, d.z); if (!(len > 1e-6) || !Number.isFinite(len)) return;
  d = { x: d.x / len, y: d.y / len, z: d.z / len };
  const wallT = L.map.rayWallDistance(o, d, w.range);
  let best = null;
  for (const t of L.players.values()) {
    if (t === p || !t.alive) continue;
    const h = rayHitPlayer(o, d, t);
    if (h && h.t < wallT && (!best || h.t < best.h.t)) best = { t, h };
  }
  const endT = best ? best.h.t : wallT;
  const e = { x: o.x + d.x * endT, y: o.y + d.y * endT, z: o.z + d.z * endT };
  lobbyBroadcast(L, { t: 'fx', from: p.id, w: wIdx, o, e, exp: w.kind === 'rocket' });
  if (w.kind === 'rocket') {
    for (const t of L.players.values()) {
      if (t === p || !t.alive) continue;
      const c = { x: t.x, y: t.y + 0.9, z: t.z };
      const dist = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
      if (dist < w.splash && L.map.lineOfSight({ x: e.x - d.x * 0.1, y: Math.max(e.y, 0.1), z: e.z - d.z * 0.1 }, c))
        damage(L, p, t, w.damage * (1 - (dist / w.splash) * 0.6), false, wIdx);
    }
  } else if (best) damage(L, p, best.t, w.damage * (best.h.head ? 2 : 1), best.h.head, wIdx);
}
function damage(L, by, t, amount, head, wIdx = 0) {
  t.hp -= amount;
  lobbyBroadcast(L, { t: 'hit', by: by.id, target: t.id, dmg: Math.round(amount), hp: Math.max(0, Math.round(t.hp)) });
  if (t.hp <= 0 && t.alive) {
    t.alive = false; t.hp = 0; t.deaths++; t.respawnAt = Date.now() + RESPAWN_MS;
    by.kills++; by.lastKillAt = Date.now();
    lobbyBroadcast(L, { t: 'kill', killer: by.id, victim: t.id, head, w: wIdx });
    lobbyBroadcast(L, { t: 'score', board: board(L) });
  }
}

// ------------------------------------------------------------ server bots (test lobbies only)
function botThink(L, b, dt) {
  if (!b.alive) return;
  const ai = b.ai, now = Date.now();
  // nearest living opponent
  let tgt = null, td = 1e9;
  for (const o of L.players.values()) if (o !== b && o.alive) { const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < td) { td = d; tgt = o; } }
  if (!tgt) return;
  const eye = { x: b.x, y: b.y + EYE, z: b.z }, tEye = { x: tgt.x, y: tgt.y + 1.2, z: tgt.z };
  const los = td < 30 && L.map.lineOfSight(eye, tEye);
  if (now > ai.flowAt || ai.target !== tgt.id) { ai.flow = flowField(L.map, tgt.x, tgt.z); ai.flowAt = now + 500; ai.target = tgt.id; }
  let dir;
  if (los && td < 12) { // strafe while fighting
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

// ------------------------------------------------------------ match end + payout
async function endMatch(L) {
  L.state = 'ended';
  const ranked = [...L.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.lastKillAt - b.lastKillAt);
  const winner = ranked[0];
  lobbyBroadcast(L, { t: 'ending' });
  let payout = null;
  if (L.paid && winner?.pubkey) {
    try { payout = await payWinner(L, winner); }
    catch (e) { payout = { error: String(e.message || e) }; logLedger({ type: 'payout-error', lobby: L.id, error: payout.error }); console.error('payout failed', e); }
  } else payout = { note: L.paid ? 'Sin ganador válido.' : 'Partida de prueba: sin premio en SOL.' };
  lobbyBroadcast(L, { t: 'end', board: board(L), winner: winner && { id: winner.id, name: winner.name }, payout });
  console.log(`[${L.id}] match ended. winner=${winner?.name} kills=${winner?.kills}`, payout);
  for (const p of L.players.values()) if (p.conn) p.conn.lobby = null;
  setTimeout(() => lobbies.delete(L.id), 5000);
}
async function payWinner(L, winner) {
  const pot = L.potLamports;
  const winnerLamports = Math.floor(pot * CFG.winnerShare);
  const treasuryLamports = pot - winnerLamports - 5000; // the tx fee comes out of the house cut
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({ fromPubkey: escrow.publicKey, toPubkey: new web3.PublicKey(winner.pubkey), lamports: winnerLamports }),
    web3.SystemProgram.transfer({ fromPubkey: escrow.publicKey, toPubkey: new web3.PublicKey(CFG.treasury), lamports: Math.max(0, treasuryLamports) }));
  const sig = await web3.sendAndConfirmTransaction(conn, tx, [escrow], { commitment: 'confirmed' });
  logLedger({ type: 'payout', lobby: L.id, sig, pot, winner: winner.pubkey, winnerLamports, treasury: CFG.treasury, treasuryLamports });
  return { winnerSig: sig, treasurySig: sig, winnerSol: winnerLamports / LAMPORTS, treasurySol: treasuryLamports / LAMPORTS };
}
async function refund(p, reason) {
  if (!p.pubkey || !p.entryLamports) return null;
  const lamports = p.entryLamports - 5000;
  const tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: escrow.publicKey, toPubkey: new web3.PublicKey(p.pubkey), lamports }));
  const sig = await web3.sendAndConfirmTransaction(conn, tx, [escrow], { commitment: 'confirmed' });
  logLedger({ type: 'refund', reason, to: p.pubkey, lamports, sig, entrySig: p.entrySig });
  return sig;
}

// ------------------------------------------------------------ entry verification
async function verifyEntry(sig, pubkey, nonce, minLamports) {
  if (typeof sig !== 'string' || sig.length > 100) throw new Error('Firma inválida');
  if (usedSigs.has(sig)) throw new Error('Esta transacción ya fue usada');
  let tx = null;
  for (let i = 0; i < 12 && !tx; i++) {
    tx = await conn.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!tx) throw new Error('No se encontró la transacción en ' + CFG.cluster);
  if (tx.meta?.err) throw new Error('La transacción falló en la blockchain');
  if (tx.blockTime && Date.now() / 1000 - tx.blockTime > 15 * 60) throw new Error('La transacción es demasiado vieja');
  const ixs = tx.transaction.message.instructions;
  const pay = ixs.find((ix) => ix.program === 'system' && ix.parsed?.type === 'transfer' &&
    ix.parsed.info.source === pubkey && ix.parsed.info.destination === escrow.publicKey.toBase58());
  if (!pay) throw new Error('La transacción no paga al escrow desde tu wallet');
  const lamports = Number(pay.parsed.info.lamports);
  if (lamports < minLamports) throw new Error('Pago insuficiente');
  const memoOk = ixs.some((ix) => (ix.program === 'spl-memo' || ix.programId?.toBase58?.() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') && String(ix.parsed) === nonce);
  if (!memoOk) throw new Error('El memo de la transacción no corresponde a esta sesión');
  usedSigs.add(sig); saveSigs();
  logLedger({ type: 'entry', sig, from: pubkey, lamports });
  return lamports;
}

// ------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const send = (c, m) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
const clean = (s) => String(s || '').replace(/[^\p{L}\p{N}_\- .…]/gu, '').trim().slice(0, 16) || 'Jugador';

wss.on('connection', (ws) => {
  const c = { id: newId('P'), ws, name: 'Jugador', lobby: null, quote: null, joining: false, msgs: 0, msgWindow: Date.now() };
  ws.on('message', async (raw) => {
    // simple flood protection
    const now = Date.now(); if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgs = 0; }
    if (++c.msgs > 80) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    const L = c.lobby, p = L?.players.get(c.id);
    switch (m.t) {
      case 'hello': c.name = clean(m.name); break;
      case 'info': {
        const pr = await solUsd(); const lam = usdToLamports(CFG.entryUsd, pr.usd);
        send(c, { t: 'info', cluster: CFG.cluster, lobbySize: CFG.lobbySize, entryUsd: CFG.entryUsd, entrySol: lam / LAMPORTS, solUsd: pr.usd, priceSource: pr.source,
          winnerUsd: +(CFG.entryUsd * CFG.lobbySize * CFG.winnerShare).toFixed(2), matchSeconds: CFG.matchSeconds, testMode: CFG.testMode, escrow: escrow.publicKey.toBase58() });
        break;
      }
      case 'quote': {
        if (c.lobby) return send(c, { t: 'error', msg: 'Ya estás en un lobby' });
        const pr = await solUsd();
        c.quote = { nonce: 'zstrike:' + crypto.randomBytes(8).toString('hex'), lamports: usdToLamports(CFG.entryUsd, pr.usd), at: Date.now() };
        send(c, { t: 'quote', ...c.quote, escrow: escrow.publicKey.toBase58(), usd: CFG.entryUsd, solUsd: pr.usd });
        break;
      }
      case 'join': { // paid lobby
        if (c.lobby || c.joining) return;
        if (!c.quote || Date.now() - c.quote.at > 10 * 60_000) return send(c, { t: 'error', msg: 'Cotización vencida, inténtalo otra vez' });
        c.joining = true;
        try {
          new web3.PublicKey(m.pubkey);
          const lamports = await verifyEntry(m.sig, m.pubkey, c.quote.nonce, c.quote.lamports);
          c.quote = null;
          let lobby = [...lobbies.values()].find((x) => x.paid && x.state === 'waiting' && x.players.size < x.size);
          if (!lobby) lobby = makeLobby({ paid: true, mapId: m.map, size: CFG.lobbySize });
          addPlayer(lobby, { conn: c, name: c.name !== 'Jugador' ? c.name : m.pubkey.slice(0, 4) + '…' + m.pubkey.slice(-4), pubkey: m.pubkey, entryLamports: lamports, entrySig: m.sig });
          castVote(lobby, c.id, m.map);
          send(c, { t: 'joined', lobbyId: lobby.id, you: c.id, map: lobby.mapId, paid: true, voteSeconds: CFG.voteSeconds });
          lobbyBroadcast(lobby, lobbySummary(lobby)); maybeStart(lobby);
        } catch (e) { send(c, { t: 'error', msg: e.message }); }
        c.joining = false;
        break;
      }
      case 'joinTest': {
        if (!CFG.testMode || c.lobby) return;
        // humans pressing "test" within a few seconds share a lobby, then bots fill the rest
        let lobby = [...lobbies.values()].find((x) => !x.paid && x.state === 'waiting' && x.players.size < x.size);
        if (!lobby) {
          lobby = makeLobby({ paid: false, mapId: m.map, size: CFG.testLobbySize });
          setTimeout(() => {
            if (lobby.state !== 'waiting' || ![...lobby.players.values()].some((q) => !q.bot)) return;
            let n = 0; while (lobby.players.size < lobby.size) addPlayer(lobby, { name: 'Bot ' + BOT_NAMES[n++ % BOT_NAMES.length], bot: true });
            lobbyBroadcast(lobby, lobbySummary(lobby)); maybeStart(lobby);
          }, 4000);
        }
        addPlayer(lobby, { conn: c, name: c.name });
        castVote(lobby, c.id, m.map);
        send(c, { t: 'joined', lobbyId: lobby.id, you: c.id, map: lobby.mapId, paid: false, voteSeconds: CFG.voteSeconds });
        lobbyBroadcast(lobby, lobbySummary(lobby)); maybeStart(lobby);
        break;
      }
      case 'state': {
        if (!p || !p.alive || L.state !== 'playing') return;
        const x = +m.x, y = +m.y, z = +m.z; if (![x, y, z].every(Number.isFinite)) return;
        const dt = Math.max(0.016, (now - p.lastStateAt) / 1000); p.lastStateAt = now;
        const dist = Math.hypot(x - p.x, z - p.z);
        // anti-teleport / anti-wallhack movement check
        if (dist > SPEED * dt * 1.6 + 0.4 || y < -0.1 || y > 5 || L.map.blocked(x, z, 0.25, y)) {
          send(c, { t: 'correct', x: p.x, y: p.y, z: p.z }); return;
        }
        Object.assign(p, { x, y, z, yaw: +m.yaw || 0, pitch: +m.pitch || 0 });
        break;
      }
      case 'shot':
        if (p && m.o && m.d) fire(L, p, m.w | 0, { x: +m.o.x, y: +m.o.y, z: +m.o.z }, { x: +m.d.x, y: +m.d.y, z: +m.d.z });
        break;
      case 'vote':
        if (L && p && !p.bot && castVote(L, c.id, String(m.map))) lobbyBroadcast(L, lobbySummary(L));
        break;
      case 'leave': leave(c, 'leave'); break;
    }
  });
  ws.on('close', () => leave(c, 'disconnect'));
});

async function leave(c, why) {
  const L = c.lobby; if (!L) return;
  const p = L.players.get(c.id); c.lobby = null;
  if (!p) return;
  if (L.state === 'waiting' || L.state === 'countdown') {
    L.players.delete(p.id); L.votes.delete(p.id); L.potLamports -= p.entryLamports;
    if (L.state === 'countdown') L.state = 'waiting';
    lobbyBroadcast(L, lobbySummary(L));
    if (L.paid && p.entryLamports) {
      try { const sig = await refund(p, why); send(c, { t: 'refund', sig }); } catch (e) { console.error('refund failed', e); logLedger({ type: 'refund-error', to: p.pubkey, error: String(e) }); }
    }
    if (![...L.players.values()].some((q) => !q.bot)) lobbies.delete(L.id);
  } else {
    p.conn = null; // keeps their score; a paid winner is still paid to their wallet
  }
}

// ------------------------------------------------------------ main loop
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = (now - lastTick) / 1000; lastTick = now;
  for (const L of lobbies.values()) {
    if (L.state === 'waiting' && L.paid && now - L.createdAt > CFG.lobbyTimeoutMin * 60_000) {
      // lobby never filled: refund everyone
      for (const p of [...L.players.values()]) if (p.conn) leave(p.conn, 'timeout');
      lobbies.delete(L.id); continue;
    }
    if (L.state === 'countdown') {
      if (now >= L.countdownAt) startMatch(L);
      else if (now % 1000 < TICK) lobbyBroadcast(L, lobbySummary(L));
      continue;
    }
    if (L.state !== 'playing') continue;
    for (const p of L.players.values()) {
      if (!p.alive && now >= p.respawnAt) respawn(L, p);
      if (p.bot) botThink(L, p, dt);
    }
    lobbyBroadcast(L, { t: 'snap', p: [...L.players.values()].map((p) => ({ id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), alive: p.alive, bot: p.bot })) });
    if (now >= L.endsAt) endMatch(L);
  }
}, TICK);

// keep a small SOL float in the escrow for fees/rent (devnet airdrop)
async function ensureEscrowFloat() {
  try {
    const bal = await conn.getBalance(escrow.publicKey);
    console.log(`Escrow ${escrow.publicKey.toBase58()} balance: ${bal / LAMPORTS} SOL (${CFG.cluster})`);
    if (bal < RESERVE_LAMPORTS && CFG.cluster === 'devnet') {
      const sig = await conn.requestAirdrop(escrow.publicKey, LAMPORTS);
      console.log('Requested devnet airdrop for escrow float:', sig);
    }
  } catch (e) { console.warn('Escrow float check failed (fund it at faucet.solana.com):', e.message); }
}

server.listen(CFG.port, '0.0.0.0', () => {
  console.log(`ZStrike server on http://localhost:${CFG.port}  (ws: /ws)  cluster=${CFG.cluster} lobby=${CFG.lobbySize} entry=$${CFG.entryUsd} testMode=${CFG.testMode}`);
  ensureEscrowFloat(); solUsd().then((p) => console.log('SOL/USD', p.usd, p.source));
});
