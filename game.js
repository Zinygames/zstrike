// ZStrike - client (single-player vs bots + online deathmatch client)
import * as THREE from 'three';
import { WEAPONS, SHOP_ITEMS, CLUSTER, SERVER_URL } from './config.js';
import { MAPS, DEFAULT_MAP, createMap, rayHitPlayer } from './map.js';
import { flowField, flowDir } from './ai.js';
import * as Wallet from './wallet.js';
import { makeWeaponModel } from './weapons3d.js';

const $ = (id) => document.getElementById(id);
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------------------------------------------------------------- persistence
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('zstrike:' + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('zstrike:' + k, JSON.stringify(v)); },
};
let coins = LS.get('coins', 0);
// Coin purchases live under "guest"; SOL purchases are keyed by wallet pubkey.
function unlockKey(pk) { return 'unlocks:' + (pk || 'guest'); }
function ownedSet() {
  const s = new Set(Object.keys(LS.get(unlockKey(null), {})));
  const pk = Wallet.getPublicKey();
  if (pk) Object.keys(LS.get(unlockKey(pk), {})).forEach((k) => s.add(k));
  return s;
}
function grant(itemId, pk, proof) {
  const k = unlockKey(pk); const o = LS.get(k, {}); o[itemId] = proof || true; LS.set(k, o);
}
function stats() {
  const o = ownedSet();
  const dmgLv = ['dmg1', 'dmg2', 'dmg3'].filter((x) => o.has(x)).length;
  const hpLv = ['hp1', 'hp2'].filter((x) => o.has(x)).length;
  return { dmgMult: 1 + 0.25 * dmgLv, maxHp: 100 + 50 * hpLv, armor: o.has('armor') ? 0.4 : 0, owned: o };
}

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const SETTINGS = { sens: 1, quality: 'alta' };
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem('zstrike:settings')) || {}); } catch {}
function applyQuality() { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SETTINGS.quality === 'baja' ? 0.85 : 1.5)); }
applyQuality();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120626);
scene.fog = new THREE.Fog(0x120626, 18, 60);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xc9a6ff, 0x1a0a33, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(10, 30, 5); scene.add(sun);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// Pixel-art textures generated on a canvas (no external assets).
function pixelTex(base, accent, seed, opts = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'); let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
    const v = r(); const col = new THREE.Color(base).offsetHSL(0, 0, (v - 0.5) * 0.12);
    if (v > 0.93) col.set(accent);
    g.fillStyle = '#' + col.getHexString(); g.fillRect(x, y, 1, 1);
  }
  if (opts.border) { g.fillStyle = accent; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16); }
  if (opts.grid) { g.fillStyle = accent; g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const MATS = {
  1: new THREE.MeshLambertMaterial({ map: pixelTex('#2a1450', '#9945ff', 7, { border: true }) }),
  2: new THREE.MeshLambertMaterial({ map: pixelTex('#3b1d6e', '#14f195', 11, { border: true }) }),
  3: new THREE.MeshLambertMaterial({ map: pixelTex('#5a3a1a', '#ffb347', 3, { border: true }) }),
};

// ---------------------------------------------------------------- world
let map = null, mapId = LS.get('map', DEFAULT_MAP), worldGroup = null;
if (!MAPS[mapId]) mapId = DEFAULT_MAP;
function buildWorld(id) {
  if (worldGroup) { scene.remove(worldGroup); worldGroup.traverse((o) => o.geometry?.dispose()); }
  map = createMap(id); worldGroup = new THREE.Group();
  const floorTex = pixelTex('#0f2a22', '#14f195', 5, { grid: true });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(map.w, map.l);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.l), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(map.w / 2, 0, map.l / 2); worldGroup.add(floor);
  const box = new THREE.BoxGeometry(1, 1, 1); const m4 = new THREE.Matrix4();
  for (const k of [1, 2, 3]) {
    const cells = [];
    for (let i = 0; i < map.w; i++) for (let j = 0; j < map.l; j++)
      if (map.kind[i + j * map.w] === k) for (let y = 0; y < map.heights[i + j * map.w]; y++) cells.push([i, y, j]);
    if (!cells.length) continue;
    const im = new THREE.InstancedMesh(box, MATS[k], cells.length);
    cells.forEach(([i, y, j], n) => im.setMatrixAt(n, m4.makeTranslation(i + 0.5, y + 0.5, j + 0.5)));
    worldGroup.add(im);
  }
  // neon strips on top of the outer wall
  const strip = new THREE.Mesh(new THREE.BoxGeometry(map.w, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0x14f195 }));
  for (const z of [0.5, map.l - 0.5]) { const s = strip.clone(); s.position.set(map.w / 2, 4.02, z); worldGroup.add(s); }
  scene.add(worldGroup);
}

// ---------------------------------------------------------------- avatars
function makeAvatar(color, eyes = 0xff3df2) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color }), dark = new THREE.MeshLambertMaterial({ color: 0x1a0a2e });
  const add = (w, h, d, x, y, z, m, name) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (name) b.name = name; g.add(b); return b; };
  add(0.22, 0.6, 0.22, -0.13, 0.3, 0, dark, 'legL'); add(0.22, 0.6, 0.22, 0.13, 0.3, 0, dark, 'legR');
  add(0.56, 0.72, 0.3, 0, 0.98, 0, mat);
  add(0.18, 0.6, 0.18, -0.38, 0.98, 0, mat); add(0.18, 0.6, 0.18, 0.38, 0.98, -0.15, mat);
  add(0.46, 0.46, 0.46, 0, 1.6, 0, mat);
  const eyeM = new THREE.MeshBasicMaterial({ color: eyes });
  add(0.1, 0.08, 0.02, -0.1, 1.64, -0.235, eyeM); add(0.1, 0.08, 0.02, 0.1, 1.64, -0.235, eyeM);
  add(0.1, 0.1, 0.5, 0.38, 1.05, -0.45, dark);
  return g;
}

// ---------------------------------------------------------------- FX
const fx = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0x14f195, transparent: true });
function tracer(a, b, color = 0x14f195) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = tracerMat.clone(); m.color.setHex(color);
  m.blending = THREE.AdditiveBlending; const l = new THREE.Line(geo, m); scene.add(l); fx.push({ obj: l, life: 0.07, max: 0.07 });
}
// Plasma bolt: glowing elongated box that flies from the muzzle to the impact point.
const boltGeo = new THREE.BoxGeometry(0.05, 0.05, 1.1);
function bolt(a, b, color = 0x46c8ff, speed = 90) {
  tracer(a, b, color); // brief glow trail so every shot reads clearly
  const dir = b.clone().sub(a); const dist = dir.length(); if (dist < 0.05) return;
  const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const core = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); core.scale.set(0.4, 0.4, 0.8); m.add(core);
  m.position.copy(a); m.lookAt(b); scene.add(m);
  fx.push({ obj: m, life: dist / speed + 0.02, max: dist / speed + 0.02, v: dir.normalize().multiplyScalar(speed), noGrav: true, keep: true });
}
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
function burst(p, color, n = 8, spd = 4) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(p); scene.add(m);
    fx.push({ obj: m, life: 0.5, max: 0.5, v: new THREE.Vector3((Math.random() - 0.5) * spd, Math.random() * spd, (Math.random() - 0.5) * spd) });
  }
}
function explosion(p) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3df2, transparent: true, opacity: 0.7 }));
  m.position.copy(p); scene.add(m); fx.push({ obj: m, life: 0.35, max: 0.35, grow: 3 });
  burst(p, 0x14f195, 16, 8);
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life -= dt; const k = Math.max(f.life / f.max, 0);
    if (f.v) { if (!f.noGrav) f.v.y -= 12 * dt; f.obj.position.addScaledVector(f.v, dt); }
    if (f.grow) f.obj.scale.setScalar(0.3 + (1 - k) * f.grow);
    if (f.obj.material && !f.keep) f.obj.material.opacity = k;
    if (f.life <= 0) { scene.remove(f.obj); if (f.obj.geometry !== partGeo && f.obj.geometry !== boltGeo) f.obj.geometry.dispose(); f.obj.material?.dispose(); f.obj.children.forEach((c) => c.material?.dispose()); fx.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- viewmodel
const viewGun = new THREE.Group();
const gunModels = WEAPONS.map((w) => { const m = makeWeaponModel(w.id); m.visible = false; viewGun.add(m); return m; });
const muzzle = new THREE.PointLight(0x46c8ff, 0, 3); viewGun.add(muzzle);
// muzzle flash: additive glow sprite
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0x46c8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
flash.visible = false; viewGun.add(flash);
let flashT = 0;
viewGun.scale.setScalar(0.75); viewGun.position.set(0.2, -0.17, -0.42); camera.add(viewGun);
function gunTipWorld() {
  const m = gunModels[player.weapon]; camera.updateMatrixWorld(true);
  return m.userData.muzzle.clone().applyMatrix4(m.matrixWorld);
}

// ---------------------------------------------------------------- player + input
const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, armor: 0, onGround: true, alive: true, weapon: 0, cd: 0, recoil: 0 };
const input = { mx: 0, mz: 0, fire: false, jump: false, keys: {} };
let mode = 'menu';      // 'menu' | 'solo' | 'online'
let paused = true;

function availableWeapons() {
  if (mode === 'online') return WEAPONS.map((_, i) => i); // equal loadout online (fair, server-checked)
  const o = stats().owned; return WEAPONS.map((w, i) => (!w.unlock || o.has(w.unlock) ? i : -1)).filter((i) => i >= 0);
}
function switchWeapon(dir = 1, idx = null) {
  const av = availableWeapons();
  if (idx !== null) { if (av.includes(idx)) player.weapon = idx; }
  else { const k = av.indexOf(player.weapon); player.weapon = av[(k + dir + av.length) % av.length]; }
  const w = WEAPONS[player.weapon];
  gunModels.forEach((m, i) => (m.visible = i === player.weapon));
  const mz = gunModels[player.weapon].userData.muzzle;
  muzzle.color.setHex(w.color); muzzle.position.copy(mz); flash.position.copy(mz).add(new THREE.Vector3(0, 0, -0.03));
  flash.material.color.setHex(w.color); $('weapon-text').textContent = w.name + (av.length > 1 ? `  (${av.indexOf(player.weapon) + 1}/${av.length})` : '');
}

// Keyboard / mouse (desktop testing)
addEventListener('keydown', (e) => {
  input.keys[e.code] = true;
  if (mode === 'menu') return;
  if (e.code === 'Space') input.jump = true;
  if (e.code === 'KeyQ') switchWeapon(1);
  if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) switchWeapon(0, +e.code.slice(5) - 1);
  if (e.code === 'KeyB' && mode === 'solo') openShop();
});
addEventListener('keyup', (e) => { input.keys[e.code] = false; });
canvas.addEventListener('mousedown', () => {
  if (paused || IS_TOUCH) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); else input.fire = true;
});
addEventListener('mouseup', () => { if (!IS_TOUCH) input.fire = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX * 0.0022, e.movementY * 0.0022);
});
function look(dx, dy) {
  dx *= SETTINGS.sens; dy *= SETTINGS.sens;
  player.yaw -= dx; player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy));
}

// Touch: left virtual joystick, right-side drag to look, buttons.
const joy = { id: null, cx: 0, cy: 0 }, lookT = { id: null, x: 0, y: 0 };
const knob = $('joy-knob'), base = $('joy-base');
$('joy-zone').addEventListener('pointerdown', (e) => {
  joy.id = e.pointerId; const r = base.getBoundingClientRect(); joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
  try { e.target.setPointerCapture(e.pointerId); } catch (_) {} joyMove(e);
});
$('joy-zone').addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId === joy.id) { joy.id = null; input.mx = input.mz = 0; knob.style.transform = ''; } };
$('joy-zone').addEventListener('pointerup', joyEnd); $('joy-zone').addEventListener('pointercancel', joyEnd);
function joyMove(e) {
  let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy; const R = 50, len = Math.hypot(dx, dy);
  if (len > R) { dx *= R / len; dy *= R / len; }
  knob.style.transform = `translate(${dx}px,${dy}px)`; input.mx = dx / R; input.mz = dy / R;
}
function lookHandlers(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => { lookT.id = e.pointerId; lookT.x = e.clientX; lookT.y = e.clientY; try { el.setPointerCapture(e.pointerId); } catch (_) {} onDown?.(); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookT.id) return;
    look((e.clientX - lookT.x) * 0.006, (e.clientY - lookT.y) * 0.006); lookT.x = e.clientX; lookT.y = e.clientY;
  });
  const end = (e) => { if (e.pointerId === lookT.id) { lookT.id = null; onUp?.(); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
lookHandlers($('look-zone'));
// Fire button: hold to shoot and drag on it to aim at the same time (like PG3D).
lookHandlers($('btn-fire'), () => { input.fire = true; }, () => { input.fire = false; });
$('btn-jump').addEventListener('pointerdown', (e) => { input.jump = true; e.preventDefault(); });
$('btn-switch').addEventListener('pointerdown', (e) => { switchWeapon(1); e.preventDefault(); });

// ---------------------------------------------------------------- HUD helpers
let hitTimer = 0, flashTimer = 0, bannerTimer = 0;
function hud() {
  $('hp-fill').style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
  $('hp-text').textContent = Math.max(0, Math.ceil(player.hp));
  $('armor-bar').classList.toggle('hidden', !player.armor);
  $('coins-text').textContent = '🪙 ' + coins;
  $('score-text').textContent = mode === 'online' ? (online.myKills + ' kills') : (score + ' pts');
}
function banner(text, t = 2) { $('banner').textContent = text; $('banner').classList.add('on'); bannerTimer = t; }
function hitMarker() { $('hit-marker').classList.add('on'); hitTimer = 0.12; }
function damageFlash() { $('dmg-flash').style.opacity = 1; flashTimer = 0.2; }
// Kill feed: "<Killer> [weapon] <Victim>" in the top-right, fades after ~5 s.
const WEAPON_ICONS = {
  pistol: '<svg viewBox="0 0 26 12"><path fill="currentColor" d="M1 2h17v4h-3l-1 1-2 5H8l2-6H1z"/><rect x="18" y="3" width="6" height="2" fill="currentColor"/></svg>',
  smg: '<svg viewBox="0 0 26 12"><path fill="currentColor" d="M0 3h4V1h14v2h8v3h-8v2h-4l-1 4h-3l1-4H4v1H0z"/></svg>',
  rocket: '<svg viewBox="0 0 26 12"><rect x="2" y="2" width="20" height="5" rx="1" fill="currentColor"/><path fill="currentColor" d="M22 1l4 3.5-4 3.5zM9 7h3l-1 5H8z"/></svg>',
  bot: '<svg viewBox="0 0 26 12"><path fill="currentColor" d="M2 3h18v3H2zM20 4h5v1h-5zM6 6h3l-1 4H5z"/></svg>',
};
function addKill(killer, wIdx, victim, { head = false, killerMe = false, victimMe = false } = {}) {
  const w = WEAPONS[wIdx];
  const icon = w ? WEAPON_ICONS[w.id] : WEAPON_ICONS.bot;
  const color = w ? '#' + w.color.toString(16).padStart(6, '0') : '#cccccc';
  const d = document.createElement('div'); d.className = 'kf';
  d.innerHTML = `<span class="k ${killerMe ? 'me' : ''}">${esc(killer)}</span><span class="w" style="color:${color}">${icon}${w ? w.short : 'BLASTER'}${head ? ' 💀' : ''}</span><span class="v ${victimMe ? 'me' : ''}">${esc(victim)}</span>`;
  const feed = $('killfeed'); feed.prepend(d);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => d.classList.add('out'), 4400);
  setTimeout(() => d.remove(), 5000);
}

// ---------------------------------------------------------------- player physics
const SPEED = 6, GRAVITY = 18, JUMP_V = 6.6, EYE = 1.55, PR = 0.3;
function updatePlayer(dt) {
  let mx = input.mx, mz = input.mz;
  if (input.keys.KeyW || input.keys.ArrowUp) mz -= 1;
  if (input.keys.KeyS || input.keys.ArrowDown) mz += 1;
  if (input.keys.KeyA || input.keys.ArrowLeft) mx -= 1;
  if (input.keys.KeyD || input.keys.ArrowRight) mx += 1;
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const dx = (mx * c + mz * s) * SPEED * dt, dz = (-mx * s + mz * c) * SPEED * dt;
  if (player.alive) map.moveCircle(player.pos, dx, dz, PR);
  if (input.jump && player.onGround && player.alive) { player.vy = JUMP_V; player.onGround = false; }
  input.jump = false;
  player.vy -= GRAVITY * dt; player.pos.y += player.vy * dt;
  const g = map.groundUnder(player.pos.x, player.pos.z, PR);
  if (player.pos.y <= g) { player.pos.y = g; player.vy = 0; player.onGround = true; } else player.onGround = false;
  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  // weapon bob + recoil
  const bob = player.onGround ? Math.sin(performance.now() / 110) * 0.012 * Math.min(1, len) : 0;
  player.recoil = Math.max(0, player.recoil - dt * 6);
  viewGun.position.set(0.2, -0.17 + bob, -0.42 + player.recoil * 0.08);
  viewGun.rotation.x = player.recoil * 0.3;
}

// ---------------------------------------------------------------- shooting
const tmpDir = new THREE.Vector3();
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + EYE, player.pos.z); }
function aimDir(spread) {
  camera.getWorldDirection(tmpDir);
  tmpDir.x += (Math.random() - 0.5) * spread * 2; tmpDir.y += (Math.random() - 0.5) * spread * 2; tmpDir.z += (Math.random() - 0.5) * spread * 2;
  return tmpDir.normalize().clone();
}
function tryFire(dt) {
  player.cd -= dt;
  if (!input.fire || player.cd > 0 || !player.alive) return;
  const w = WEAPONS[player.weapon]; player.cd = w.fireRate; player.recoil = 1;
  muzzle.intensity = 4; setTimeout(() => (muzzle.intensity = 0), 50);
  flash.visible = true; flash.scale.setScalar(0.12 + Math.random() * 0.08); flash.material.rotation = Math.random() * 6; flashT = 0.05;
  const o = eyePos(), d = aimDir(w.spread);
  const gunTip = gunTipWorld();
  if (mode === 'online') {
    online.send({ t: 'shot', w: player.weapon, o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z } });
    const end = o.clone().addScaledVector(d, map.rayWallDistance(o, d, w.range));
    if (w.kind === 'rocket') { bolt(gunTip, end, w.color, 40); setTimeout(() => explosion(end), Math.min(600, end.distanceTo(gunTip) / 40 * 1000)); }
    else bolt(gunTip, end, w.color);
    return;
  }
  if (w.kind === 'rocket') { spawnRocket(gunTip, d, w); return; }
  const wallT = map.rayWallDistance(o, d, w.range);
  let best = null;
  for (const e of enemies) {
    const h = rayHitPlayer(o, d, e.pos);
    if (h && h.t < wallT && (!best || h.t < best.h.t)) best = { e, h };
  }
  const end = o.clone().addScaledVector(d, best ? best.h.t : wallT);
  bolt(gunTip, end, w.color);
  if (best) { damageEnemy(best.e, w.damage * stats().dmgMult * (best.h.head ? 2 : 1), best.h.head, player.weapon); burst(end, w.color, 5); }
  else burst(end, w.color, 3, 2);
}

// ---------------------------------------------------------------- solo mode: bots, waves
const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];
let botSeq = 0;
let enemies = [], projectiles = [], wave = 0, score = 0, waveTimer = 0, flowTimer = 0, flow = null;
function startSolo() {
  mode = 'solo'; clearSolo(); online.clearRemotes();
  buildWorld(mapId);
  const st = stats();
  Object.assign(player, { hp: st.maxHp, maxHp: st.maxHp, armor: st.armor, alive: true, vy: 0, yaw: 0, pitch: 0, cd: 0 });
  const sp = map.spawns[0][2] || map.spawns[0][0]; player.pos.set(sp[0], 0, sp[1]);
  player.yaw = Math.PI; // face north (+z) toward the far end
  player.weapon = 0; switchWeapon(0, 0);
  wave = 0; score = 0; waveTimer = 1.5; botSeq = 0; $('killfeed').innerHTML = '';
  $('mp-timer').classList.add('hidden'); $('scoreboard').classList.add('hidden'); $('btn-shop').classList.remove('hidden');
  showGame();
}
function clearSolo() {
  enemies.forEach((e) => scene.remove(e.mesh)); enemies = [];
  projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = [];
}
function spawnWave() {
  wave++; banner('OLEADA ' + wave); $('wave-text').textContent = 'OLEADA ' + wave;
  const n = 2 + wave * 2;
  const far = map.freeCells().filter(([x, z]) => Math.hypot(x - player.pos.x, z - player.pos.z) > 18);
  for (let i = 0; i < n; i++) {
    const [x, z] = far[Math.floor(Math.random() * far.length)];
    const mesh = makeAvatar(wave % 3 === 0 ? 0xff3df2 : 0x9945ff, 0x14f195);
    mesh.position.set(x, 0, z); scene.add(mesh);
    const nm = 'Bot ' + BOT_NAMES[botSeq % 26] + (botSeq >= 26 ? ' ' + Math.floor(botSeq / 26 + 1) : ''); botSeq++;
    enemies.push({ name: nm, mesh, pos: mesh.position, hp: 50 + wave * 12, speed: 2.4 + Math.min(wave * 0.18, 2), cd: 1 + Math.random() * 2, dmg: 6 + wave, walk: Math.random() * 6 });
  }
}
function damageEnemy(e, dmg, head, wIdx = player.weapon) {
  e.hp -= dmg; hitMarker();
  if (e.hp <= 0 && enemies.includes(e)) {
    burst(e.pos.clone().setY(1), 0x14f195, 14, 6); scene.remove(e.mesh); enemies.splice(enemies.indexOf(e), 1);
    const c = 10 + wave * 2 + (head ? 5 : 0); coins += c; LS.set('coins', coins);
    score += head ? 150 : 100; addKill(playerName(), wIdx, e.name, { head, killerMe: true });
  }
}
function updateBots(dt) {
  flowTimer -= dt;
  if (flowTimer <= 0) { flow = flowField(map, player.pos.x, player.pos.z); flowTimer = 0.4; }
  const eye = eyePos();
  for (const e of enemies) {
    const toP = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    const head = new THREE.Vector3(e.pos.x, e.pos.y + 1.5, e.pos.z);
    const los = toP < 26 && map.lineOfSight(head, eye);
    let dir;
    if (los && toP < 5) dir = { x: (player.pos.x - e.pos.x) / toP, z: (player.pos.z - e.pos.z) / toP };
    else dir = flowDir(map, flow, e.pos, player.pos.x, player.pos.z);
    // light separation so bots don't stack
    for (const o of enemies) if (o !== e) {
      const sx = e.pos.x - o.pos.x, sz = e.pos.z - o.pos.z, d = Math.hypot(sx, sz);
      if (d < 0.8 && d > 0) { dir.x += sx / d * 0.6; dir.z += sz / d * 0.6; }
    }
    const stop = los && toP < 7;
    if (!stop) map.moveCircle(e.pos, dir.x * e.speed * dt, dir.z * e.speed * dt, 0.35);
    e.mesh.rotation.y = Math.atan2(-(player.pos.x - e.pos.x), -(player.pos.z - e.pos.z));
    e.walk += dt * (stop ? 0 : 10);
    const legL = e.mesh.getObjectByName('legL'), legR = e.mesh.getObjectByName('legR');
    legL.rotation.x = Math.sin(e.walk) * 0.6; legR.rotation.x = -Math.sin(e.walk) * 0.6;
    e.cd -= dt;
    if (los && e.cd <= 0 && player.alive) {
      e.cd = 1.3 + Math.random() * 1.2;
      const d = eye.clone().sub(head); d.x += (Math.random() - 0.5) * 1.2; d.y += (Math.random() - 0.5) * 0.6; d.normalize();
      const mesh = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xff3df2 })); mesh.scale.setScalar(1.6);
      mesh.position.copy(head); scene.add(mesh);
      projectiles.push({ mesh, v: d.multiplyScalar(16), dmg: e.dmg, enemy: true, life: 3, from: e.name });
    }
  }
  if (enemies.length === 0) {
    waveTimer -= dt;
    if (waveTimer <= 0) { spawnWave(); waveTimer = 3; }
  }
}
function spawnRocket(from, d, w) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.4), new THREE.MeshBasicMaterial({ color: w.color }));
  mesh.position.copy(from); mesh.lookAt(from.clone().add(d)); scene.add(mesh);
  projectiles.push({ mesh, v: d.clone().multiplyScalar(w.speed), rocket: w, life: 4 });
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.life -= dt;
    p.mesh.position.addScaledVector(p.v, dt); const pos = p.mesh.position;
    let dead = p.life <= 0 || pos.y <= 0 || map.heightAt(pos.x, pos.z) > pos.y;
    if (p.enemy) {
      const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z, dy = pos.y - (player.pos.y + 1);
      if (Math.abs(dx) < 0.45 && Math.abs(dz) < 0.45 && Math.abs(dy) < 0.95) { hurtPlayer(p.dmg, p.from); dead = true; }
    } else if (p.rocket) {
      if (!dead) for (const e of enemies) if (rayHitPlayer(pos, { x: 0, y: 1, z: 0 }, { x: e.pos.x, y: e.pos.y - 0.01, z: e.pos.z }) && Math.abs(pos.x - e.pos.x) < 0.45 && Math.abs(pos.z - e.pos.z) < 0.45 && pos.y < e.pos.y + 1.9) { dead = true; break; }
      if (dead) {
        explosion(pos.clone());
        for (const e of [...enemies]) {
          const d = Math.hypot(e.pos.x - pos.x, e.pos.y + 1 - pos.y, e.pos.z - pos.z);
          if (d < p.rocket.splash) damageEnemy(e, p.rocket.damage * stats().dmgMult * (1 - d / p.rocket.splash * 0.6), false, 2);
        }
      }
    }
    if (dead) { scene.remove(p.mesh); p.mesh.material.dispose(); projectiles.splice(i, 1); }
  }
}
function hurtPlayer(dmg, by = 'Bot') {
  if (!player.alive) return;
  player.hp -= dmg * (1 - player.armor); damageFlash();
  if (player.hp <= 0) { player.hp = 0; player.alive = false; addKill(by, -1, playerName(), { victimMe: true }); setTimeout(gameOverSolo, 1200); }
}
function gameOverSolo() {
  if (mode !== 'solo') return;
  paused = true; document.exitPointerLock?.();
  $('go-stats').innerHTML = `Oleada <b>${wave}</b> · Puntos <b>${score}</b><br>🪙 Monedas totales: <b>${coins}</b>`;
  $('gameover').classList.remove('hidden'); $('touch').classList.add('hidden');
}

// ---------------------------------------------------------------- online client
const online = {
  ws: null, id: null, remotes: new Map(), myKills: 0, endsAt: 0, quote: null, inMatch: false,
  url() {
    if (SERVER_URL) return SERVER_URL;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  },
  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === 1) return resolve();
      let ws;
      try { ws = new WebSocket(this.url()); } catch (e) { return reject(e); }
      this.ws = ws;
      ws.onopen = () => { this.wasOpen = true; resolve(); this.send({ t: 'hello', name: shortName() }); };
      ws.onerror = () => reject(new Error('No se pudo conectar al servidor'));
      ws.onclose = () => { if (this.inMatch) { banner('Desconectado'); } this.ws = null; if (this.wasOpen) onlineInfo('Desconectado del servidor.', true); this.wasOpen = false; };
      ws.onmessage = (ev) => this.onMsg(JSON.parse(ev.data));
    });
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  clearRemotes() { this.remotes.forEach((r) => scene.remove(r.mesh)); this.remotes.clear(); },
  onMsg(m) {
    switch (m.t) {
      case 'info':
        this.quote = m;
        onlineInfo(`Lobby de <b>${m.lobbySize}</b> jugadores · Entrada <b>$${m.entryUsd}</b> ≈ <b>${m.entrySol.toFixed(4)} SOL</b> (1 SOL ≈ $${m.solUsd.toFixed(2)}${m.priceSource === 'fallback' ? ', precio de respaldo' : ''})<br>` +
          `Gana quien tenga más kills al final (${Math.round(m.matchSeconds / 60)} min): premio ≈ <b>$${m.winnerUsd}</b> en SOL · Red: <b>${m.cluster}</b>` + (m.testMode ? '' : '<br>(partidas de prueba desactivadas en este servidor)'));
        $('btn-join-test').classList.toggle('hidden', !m.testMode);
        refreshOnlineWallet();
        break;
      case 'error': onlineMsg(m.msg, true); break;
      case 'joined':
        this.id = m.you; this.myVote = mapId; this.lobbyState = null;
        onlineMsg(m.paid ? 'Pago verificado ✅ Vota el mapa mientras llegan los jugadores.' : 'Partida de prueba: vota el mapa mientras se llena el lobby.');
        $('online').classList.add('in-lobby'); $('lobby-vote').classList.remove('hidden');
        break;
      case 'lobby': {
        const me = m.players.find((p) => p.id === this.id); if (me?.vote) this.myVote = me.vote;
        renderVote(m, this.myVote, null);
        $('vote-timer').innerHTML = m.state === 'countdown' ? `EMPIEZA EN <b>${m.countdown}s</b>` : `ESPERANDO JUGADORES <b>${m.players.length}/${m.size}</b>`;
        $('lobby-players').innerHTML = `<div class="hm-label">JUGADORES ${m.players.length}/${m.size}</div>` +
          m.players.map((p) => `<span class="${p.id === this.id ? 'me' : ''}">${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === this.id ? ' (tú)' : ''}${p.vote ? ' · ' + esc(MAPS[p.vote]?.name || '') : ''}</span>`).join('');
        this.lastLobby = m;
        break;
      }
      case 'mapResult':
        if (this.lastLobby) renderVote({ ...this.lastLobby, votes: m.counts }, this.myVote, m.map);
        $('vote-timer').innerHTML = `MAPA: <b>${esc(m.name.toUpperCase())}</b>${m.tie ? ' (empate, elegido al azar)' : ''}`;
        break;
      case 'start': this.startMatch(m); break;
      case 'snap':
        for (const p of m.p) {
          if (p.id === this.id) { player.hp = p.hp; continue; }
          let r = this.remotes.get(p.id);
          if (!r) { r = { mesh: makeAvatar(p.bot ? 0xff3df2 : 0x14f195, 0xffffff), tgt: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, walk: 0 }; r.mesh.position.set(p.x, p.y, p.z); scene.add(r.mesh); this.remotes.set(p.id, r); }
          r.tgt.set(p.x, p.y, p.z); r.yaw = p.yaw; r.mesh.visible = p.alive;
        }
        break;
      case 'fx': {
        if (m.from === this.id) break;
        const o = new THREE.Vector3(m.o.x, m.o.y - 0.25, m.o.z), e = new THREE.Vector3(m.e.x, m.e.y, m.e.z);
        bolt(o, e, WEAPONS[m.w]?.color || 0xffffff, m.exp ? 40 : 90); if (m.exp) setTimeout(() => explosion(e), Math.min(600, o.distanceTo(e) / 40 * 1000));
        break;
      }
      case 'hit':
        if (m.by === this.id) hitMarker();
        if (m.target === this.id) { player.hp = m.hp; damageFlash(); }
        break;
      case 'kill': {
        addKill(this.name(m.killer), m.w ?? 0, this.name(m.victim), { head: m.head, killerMe: m.killer === this.id, victimMe: m.victim === this.id });
        if (m.victim === this.id) { player.alive = false; player.hp = 0; $('respawn-text').textContent = 'Reapareciendo…'; }
        break;
      }
      case 'respawn':
        if (m.id === this.id) { player.alive = true; player.hp = 100; player.pos.set(m.x, 0, m.z); player.vy = 0; player.yaw = m.z > map.l / 2 ? 0 : Math.PI; $('respawn-text').textContent = ''; }
        break;
      case 'correct': player.pos.set(m.x, m.y, m.z); break;
      case 'score': this.board = m.board; this.renderBoard(); break;
      case 'end': this.endMatch(m); break;
      case 'ending': banner('¡Tiempo! Calculando ganador…', 5); break;
      case 'refund': onlineMsg(`Reembolso enviado: <a href="${Wallet.explorerTxUrl(m.sig)}" target="_blank">ver tx</a>`); break;
    }
  },
  name(id) { return (this.board || []).find((b) => b.id === id)?.name || (id === this.id ? playerName() : '?'); },
  renderBoard() {
    const b = (this.board || []).slice().sort((a, c) => c.kills - a.kills || a.deaths - c.deaths);
    this.myKills = b.find((x) => x.id === this.id)?.kills || 0;
    $('scoreboard').innerHTML = b.slice(0, 6).map((x, i) => `<div class="${x.id === this.id ? 'me' : ''}">${i + 1}. ${esc(x.name)} ${x.kills}/${x.deaths}</div>`).join('');
  },
  startMatch(m) {
    mode = 'online'; this.inMatch = true; clearSolo(); this.clearRemotes();
    buildWorld(m.map); this.endsAt = Date.now() + m.secondsLeft * 1000; this.board = m.board; this.renderBoard();
    Object.assign(player, { hp: 100, maxHp: 100, armor: 0, alive: true, vy: 0, pitch: 0, cd: 0 });
    player.pos.set(m.spawn.x, 0, m.spawn.z); player.yaw = m.spawn.z > map.l / 2 ? 0 : Math.PI;
    switchWeapon(0, 0); $('wave-text').textContent = 'DEATHMATCH';
    $('mp-timer').classList.remove('hidden'); $('scoreboard').classList.remove('hidden'); $('btn-shop').classList.add('hidden');
    $('online').classList.add('hidden'); $('online').classList.remove('in-lobby'); showGame(); banner((MAPS[m.map]?.name || '').toUpperCase() + ' · ¡A PELEAR!');
  },
  endMatch(m) {
    this.inMatch = false; paused = true; document.exitPointerLock?.();
    const rows = m.board.sort((a, c) => c.kills - a.kills || a.deaths - c.deaths).map((x, i) => `${i + 1}. ${esc(x.name)} — ${x.kills} kills / ${x.deaths} muertes`).join('<br>');
    let pay = '';
    if (m.payout?.winnerSig) pay = `<br>💰 Premio ${m.payout.winnerSol.toFixed(4)} SOL → ganador · <a href="${Wallet.explorerTxUrl(m.payout.winnerSig)}" target="_blank">ver tx</a>`;
    else if (m.payout?.note) pay = '<br>' + esc(m.payout.note);
    else if (m.payout?.error) pay = '<br>⚠️ Error en el pago: ' + esc(m.payout.error);
    $('go-stats').innerHTML = `🏆 Ganador: <b>${esc(m.winner?.name || '—')}</b>${m.winner?.id === this.id ? ' (¡TÚ!)' : ''}<br><br>${rows}${pay}`;
    $('gameover').classList.remove('hidden'); $('touch').classList.add('hidden'); $('hud').classList.add('hidden');
    mode = 'menu';
  },
};
let stateTimer = 0;
function updateOnline(dt) {
  stateTimer -= dt;
  if (stateTimer <= 0) { stateTimer = 0.05; online.send({ t: 'state', x: +player.pos.x.toFixed(3), y: +player.pos.y.toFixed(3), z: +player.pos.z.toFixed(3), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3) }); }
  const k = Math.min(1, dt * 12);
  online.remotes.forEach((r) => {
    const moving = r.mesh.position.distanceTo(r.tgt) > 0.02;
    r.mesh.position.lerp(r.tgt, k); r.mesh.rotation.y = r.yaw; r.walk += moving ? dt * 10 : 0;
    r.mesh.getObjectByName('legL').rotation.x = Math.sin(r.walk) * 0.6; r.mesh.getObjectByName('legR').rotation.x = -Math.sin(r.walk) * 0.6;
  });
  const left = Math.max(0, online.endsAt - Date.now()) / 1000;
  $('mp-timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
}
function defaultName() {
  const pk = Wallet.getPublicKey(); if (pk) return pk.slice(0, 4) + '…' + pk.slice(-4);
  let n = LS.get('defaultName', null); if (!n) { n = 'Jugador' + Math.floor(Math.random() * 900 + 100); LS.set('defaultName', n); } return n;
}
function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N}_\- .…]/gu, '').trim().slice(0, 16); }
function playerName() { return cleanName(LS.get('name', '')) || defaultName(); }
function setPlayerName(n) { LS.set('name', cleanName(n)); online.send({ t: 'hello', name: playerName() }); refreshUserChips(); }
const shortName = playerName;
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function onlineInfo(h, err) { $('online-info').innerHTML = h; $('online-info').style.color = err ? '#ff6b8b' : ''; }
function onlineMsg(h, err) { $('online-msg').innerHTML = h; $('online-msg').classList.toggle('err', !!err); }

async function openOnline() {
  $('menu').classList.add('hidden'); $('online').classList.remove('hidden'); $('gameover').classList.add('hidden'); refreshUserChips();
  onlineMsg(''); $('lobby-players').innerHTML = ''; $('online').classList.remove('in-lobby'); $('lobby-vote').classList.add('hidden');
  refreshOnlineWallet();
  try { await online.connect(); online.send({ t: 'info' }); }
  catch (e) { onlineInfo('No hay servidor online disponible aquí (la versión estática solo tiene modo SOLO).', true); }
}
function refreshOnlineWallet() {
  const pk = Wallet.getPublicKey(), prov = Wallet.getProvider();
  $('btn-online-connect').classList.toggle('hidden', !!pk || !prov);
  $('btn-online-phantom').classList.toggle('hidden', !!prov);
  $('btn-online-phantom').href = Wallet.phantomBrowseLink();
  $('online-wallet-status').textContent = pk ? '✅ ' + pk.slice(0, 4) + '…' + pk.slice(-4) : (prov ? '' : 'Phantom no detectado');
  $('btn-join-paid').disabled = !pk || !online.quote;
  if (online.quote) $('btn-join-paid').textContent = `PAGAR $${online.quote.entryUsd} (${online.quote.entrySol.toFixed(4)} SOL)`;
}
$('btn-online-connect').onclick = async () => { try { await Wallet.connect(); online.send({ t: 'hello', name: playerName() }); } catch (e) { onlineMsg(e.message, true); } refreshOnlineWallet(); };
$('btn-join-test').onclick = () => { online.send({ t: 'joinTest', map: mapId }); onlineMsg('Buscando partida de prueba…'); };
$('btn-join-paid').onclick = async () => {
  const btn = $('btn-join-paid'); btn.disabled = true;
  try {
    // Ask for a fresh quote+nonce bound to this connection, pay it, then hand the signature to the server.
    const q = await new Promise((res, rej) => {
      const prev = online.onMsg.bind(online);
      online.onMsg = (m) => { if (m.t === 'quote') { online.onMsg = prev; res(m); } else if (m.t === 'error') { online.onMsg = prev; rej(new Error(m.msg)); } else prev(m); };
      online.send({ t: 'quote' });
      setTimeout(() => { online.onMsg = prev; rej(new Error('El servidor no respondió')); }, 8000);
    });
    const sig = await Wallet.paySol(q.lamports / 1e9, (s) => onlineMsg(s), { to: q.escrow, memo: q.nonce, lamports: q.lamports });
    onlineMsg('Pago confirmado. Verificando en el servidor…');
    online.send({ t: 'join', sig, pubkey: Wallet.getPublicKey(), map: mapId });
  } catch (e) { onlineMsg(friendlyErr(e), true); btn.disabled = false; }
};
$('btn-online-back').onclick = () => { online.send({ t: 'leave' }); goMenu('online'); };

// ---------------------------------------------------------------- shop
function openShop() {
  if (mode === 'online') return;
  paused = true; document.exitPointerLock?.(); renderShop(); $('shop').classList.remove('hidden');
}
function closeShop() {
  $('shop').classList.add('hidden');
  if (mode === 'solo' && player.alive && $('gameover').classList.contains('hidden')) {
    paused = false; const st = stats();
    player.hp += st.maxHp - player.maxHp; player.maxHp = st.maxHp; player.armor = st.armor; switchWeapon(0, player.weapon);
  }
}
function shopMsg(h, err) { $('shop-msg').innerHTML = h; $('shop-msg').classList.toggle('err', !!err); }
async function renderShop() {
  const pk = Wallet.getPublicKey(), prov = Wallet.getProvider(), owned = stats().owned;
  $('shop-coins').textContent = '🪙 ' + coins;
  $('btn-connect').classList.toggle('hidden', !!pk || !prov);
  $('btn-open-phantom').classList.toggle('hidden', !!prov);
  $('btn-open-phantom').href = Wallet.phantomBrowseLink();
  $('btn-airdrop').classList.toggle('hidden', !pk || CLUSTER !== 'devnet');
  $('btn-disconnect').classList.toggle('hidden', !pk);
  $('wallet-status').textContent = pk ? `Conectada: ${pk.slice(0, 4)}…${pk.slice(-4)} (${CLUSTER})` :
    prov ? 'Wallet no conectada' : (Wallet.isMobile() ? 'Phantom no detectado: en el celular abre el juego dentro de la app Phantom.' : 'Phantom no detectado. Instala la extensión Phantom o juega con monedas.');
  if (pk) Wallet.getBalanceSol().then((b) => { if (b !== null) $('wallet-status').textContent += ` · ${b.toFixed(3)} SOL`; }).catch(() => {});
  $('shop-list').innerHTML = '';
  for (const it of SHOP_ITEMS) {
    const has = owned.has(it.id), locked = it.requires && !owned.has(it.requires);
    const d = document.createElement('div'); d.className = 'item' + (has ? ' owned' : '');
    d.innerHTML = `<h3>${it.name}${it.priceCoins === null ? '<span class="tag solonly">SOLO SOL</span>' : ''}</h3><p>${it.desc}</p><div class="buy"></div>`;
    const buy = d.querySelector('.buy');
    if (has) buy.innerHTML = '<b style="color:#14f195">✔ Comprado</b>';
    else if (locked) buy.innerHTML = `<i>Requiere ${SHOP_ITEMS.find((x) => x.id === it.requires).name}</i>`;
    else {
      if (it.priceCoins !== null) {
        const b = document.createElement('button'); b.className = 'pill'; b.textContent = `🪙 ${it.priceCoins}`;
        b.disabled = coins < it.priceCoins; b.onclick = () => buyCoins(it); buy.appendChild(b);
      }
      if (it.priceSol !== null) {
        const b = document.createElement('button'); b.className = 'pill sol'; b.textContent = `◎ ${it.priceSol} SOL`;
        b.disabled = !pk; b.title = pk ? '' : 'Conecta Phantom'; b.onclick = () => buySol(it, b); buy.appendChild(b);
      }
    }
    $('shop-list').appendChild(d);
  }
}
function buyCoins(it) {
  if (coins < it.priceCoins) return;
  coins -= it.priceCoins; LS.set('coins', coins); grant(it.id, null, 'coins');
  shopMsg(`✅ ${it.name} desbloqueado con monedas.`); renderShop();
}
let buying = false;
async function buySol(it, btn) {
  if (buying) return; buying = true; btn.disabled = true;
  try {
    const pk = Wallet.getPublicKey();
    const sig = await Wallet.paySol(it.priceSol, (s) => shopMsg(s));
    grant(it.id, pk, sig); // unlock ONLY after confirmed + verified tx
    shopMsg(`✅ ${it.name} desbloqueado. <a href="${Wallet.explorerTxUrl(sig)}" target="_blank">Ver transacción</a>`);
  } catch (e) { shopMsg(friendlyErr(e), true); }
  buying = false; renderShop();
}
function friendlyErr(e) {
  const m = String(e?.message || e);
  if (/User rejected|rejected the request/i.test(m)) return 'Cancelaste la transacción en Phantom.';
  if (/insufficient|0x1\b|lamports/i.test(m)) return 'No tienes suficiente SOL de prueba. Pide SOL de prueba en faucet.solana.com (red devnet).';
  if (/NO_PROVIDER/.test(m)) return 'Phantom no detectado.';
  return 'Error: ' + m;
}
$('btn-shop').onclick = openShop; $('btn-menu-shop').onclick = openShop; $('btn-go-shop').onclick = openShop;
$('btn-close-shop').onclick = closeShop;
$('btn-connect').onclick = async () => { try { await Wallet.connect(); shopMsg('Wallet conectada.'); } catch (e) { shopMsg(friendlyErr(e), true); } renderShop(); };
$('btn-disconnect').onclick = async () => { await Wallet.disconnect(); renderShop(); };
Wallet.onWalletChange(() => { if (!$('shop').classList.contains('hidden')) renderShop(); refreshOnlineWallet(); });

// ---------------------------------------------------------------- menus / flow
function showGame() {
  ['menu', 'gameover', 'shop', 'online'].forEach((id) => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !IS_TOUCH);
  paused = false; $('respawn-text').textContent = '';
  showcase.visible = false;
  if (IS_TOUCH) document.documentElement.requestFullscreen?.().catch(() => {});
}
function goMenu(sec) {
  mode = 'menu'; paused = true; document.exitPointerLock?.();
  clearSolo(); online.clearRemotes(); $('killfeed').innerHTML = '';
  ['gameover', 'shop', 'online', 'hud', 'touch'].forEach((id) => $(id).classList.add('hidden'));
  buildWorld(mapId); $('menu').classList.remove('hidden');
  selectSection(sec || menuSec);
}

function mapPreview(id) {
  const m = createMap(id), c = document.createElement('canvas'); c.width = m.l; c.height = m.w; const g = c.getContext('2d');
  for (let i = 0; i < m.w; i++) for (let j = 0; j < m.l; j++) { g.fillStyle = ['#0b1a24', '#3fe3ff', '#9fb4c4', '#ffb347'][m.kind[i + j * m.w]]; g.fillRect(j, i, 1, 1); }
  return c;
}
// Lobby map vote cards (counts come from the server; the server picks the winner)
function renderVote(l, myVote, winner) {
  const total = Math.max(1, Object.values(l.votes || {}).reduce((a, b) => a + b, 0));
  const wrap = $('vote-cards'); wrap.innerHTML = '';
  for (const id of l.maps || Object.keys(MAPS)) {
    const n = l.votes?.[id] || 0;
    const b = document.createElement('button');
    b.className = 'vote-card' + (id === myVote ? ' mine' : '') + (winner ? (id === winner ? ' win' : ' lose') : '');
    b.innerHTML = `<b>${MAPS[id].name.toUpperCase()}</b><span class="cnt">${n} ${n === 1 ? 'voto' : 'votos'}</span>`;
    b.appendChild(mapPreview(id));
    const bar = document.createElement('div'); bar.className = 'vbar'; bar.innerHTML = `<i style="width:${Math.round((n / total) * 100)}%"></i>`; b.appendChild(bar);
    if (id === myVote) { const t = document.createElement('div'); t.className = 'tag-mine'; t.textContent = 'TU VOTO'; b.appendChild(t); }
    b.disabled = !!winner;
    b.onclick = () => { online.myVote = id; online.send({ t: 'vote', map: id }); renderVote(l, id, null); };
    wrap.appendChild(b);
  }
}
// Map picker cards (rendered in every .hm-maps container)
function renderMapList() {
  document.querySelectorAll('.hm-maps').forEach((wrap) => {
    wrap.innerHTML = '';
    for (const [id, def] of Object.entries(MAPS)) {
      const b = document.createElement('button'); b.className = 'map-card' + (id === mapId ? ' sel' : '');
      b.innerHTML = `<b>${def.name.toUpperCase()}</b><span>${def.desc}</span>`;
      b.appendChild(mapPreview(id));
      b.onclick = () => { mapId = id; LS.set('map', id); renderMapList(); buildWorld(mapId); };
      wrap.appendChild(b);
    }
  });
}

// Weapon showcase in the menu background (ARMAS section)
const showcase = new THREE.Group(); showcase.visible = false; scene.add(showcase);
const SHOW_POS = new THREE.Vector3(0, 60, 0);
showcase.position.copy(SHOW_POS);
const SHOW_SCALE = { pistol: 5.4, smg: 3.1, rocket: 2.8 };
const showModels = WEAPONS.map((w) => { const m = makeWeaponModel(w.id); m.scale.setScalar(SHOW_SCALE[w.id] || 2.4); m.visible = false; showcase.add(m); return m; });
const showKey = new THREE.PointLight(0x3fe3ff, 6, 6); showKey.position.set(SHOW_POS.x - 1, SHOW_POS.y + 0.8, SHOW_POS.z + 1.2); scene.add(showKey);
const showRim = new THREE.PointLight(0xffffff, 4, 6); showRim.position.set(SHOW_POS.x + 1.5, SHOW_POS.y + 0.5, SHOW_POS.z - 1); scene.add(showRim);
const showFloor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.03, 40), new THREE.MeshPhongMaterial({ color: 0x0a1622, emissive: 0x04121c, shininess: 80 }));
showFloor.position.set(0, -0.62, 0); showcase.add(showFloor);
const showRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: 0x3fe3ff }));
showRing.rotation.x = Math.PI / 2; showRing.position.set(0, -0.6, 0); showcase.add(showRing);
let showWeapon = 0;
function setShowWeapon(i) { showWeapon = i; showModels.forEach((m, k) => (m.visible = k === i)); }
setShowWeapon(0);

let menuSec = 'solo';
function selectSection(sec) {
  menuSec = sec;
  document.querySelectorAll('#hm-nav button').forEach((b) => b.classList.toggle('sel', b.dataset.sec === sec));
  document.querySelectorAll('.hm-sec').forEach((d) => d.classList.toggle('on', d.dataset.sec === sec));
  showcase.visible = sec === 'arms';
  if (sec === 'arms') renderArms();
  if (sec === 'shop') {
    const o = stats().owned;
    $('hm-shop-summary').textContent = `🪙 ${coins} monedas · ${SHOP_ITEMS.filter((i) => o.has(i.id)).length}/${SHOP_ITEMS.length} artículos desbloqueados`;
  }
  if (sec === 'settings') { $('set-name').value = cleanName(LS.get('name', '')); $('set-name').placeholder = defaultName(); }
}
document.querySelectorAll('#hm-nav button').forEach((b) => (b.onclick = () => selectSection(b.dataset.sec)));
addEventListener('keydown', (e) => {
  if ($('menu').classList.contains('hidden') || e.target.tagName === 'INPUT') return;
  const order = ['solo', 'online', 'shop', 'arms', 'settings']; const i = order.indexOf(menuSec);
  if (e.code === 'ArrowDown') selectSection(order[(i + 1) % order.length]);
  if (e.code === 'ArrowUp') selectSection(order[(i + order.length - 1) % order.length]);
  if (e.code === 'Enter') ({ solo: startSolo, online: openOnline, shop: openShop })[menuSec]?.();
});
function renderArms() {
  const o = stats().owned, maxDps = Math.max(...WEAPONS.map((w) => w.damage / w.fireRate));
  $('hm-arms').innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const owned = !w.unlock || o.has(w.unlock);
    const b = document.createElement('button'); b.className = 'arm-row' + (i === showWeapon ? ' sel' : '');
    const pct = (v) => Math.round(Math.min(1, v) * 100);
    b.innerHTML = `<span class="nm">${w.name.toUpperCase()}</span>
      <span class="st">DAÑO<div class="bar2"><i style="width:${pct(w.damage / 140)}%"></i></div>CADENCIA<div class="bar2"><i style="width:${pct((w.damage / w.fireRate) / maxDps)}%"></i></div></span>
      <span class="own" style="color:${owned ? '#3fe3ff' : '#ffb347'}">${owned ? 'EQUIPADA' : 'BLOQUEADA'}</span>`;
    b.onclick = () => { setShowWeapon(i); renderArms(); };
    $('hm-arms').appendChild(b);
  });
}
// Top bar: player name + wallet
function refreshUserChips() {
  $('hm-name-text').textContent = playerName();
  const pk = Wallet.getPublicKey();
  $('hm-wallet-text').textContent = pk ? pk.slice(0, 4) + '…' + pk.slice(-4) : (Wallet.getProvider() ? 'Conectar wallet' : 'Sin wallet');
  if ($('online-name')) { $('online-name').value = cleanName(LS.get('name', '')); $('online-name').placeholder = defaultName(); }
}
$('hm-name').onclick = () => { selectSection('settings'); setTimeout(() => $('set-name').focus(), 50); };
$('hm-wallet').onclick = async () => {
  if (Wallet.getPublicKey()) return openShop();
  if (!Wallet.getProvider()) { location.href = Wallet.phantomBrowseLink(); return; }
  try { await Wallet.connect(); } catch (_) {}
  refreshUserChips();
};
$('set-name').addEventListener('change', (e) => setPlayerName(e.target.value));
$('online-name').addEventListener('change', (e) => setPlayerName(e.target.value));
$('set-sens').value = SETTINGS.sens; $('set-sens-val').textContent = '×' + SETTINGS.sens;
$('set-sens').addEventListener('input', (e) => { SETTINGS.sens = +e.target.value; $('set-sens-val').textContent = '×' + SETTINGS.sens; localStorage.setItem('zstrike:settings', JSON.stringify(SETTINGS)); });
$('set-quality').value = SETTINGS.quality;
$('set-quality').addEventListener('change', (e) => { SETTINGS.quality = e.target.value; applyQuality(); resize(); localStorage.setItem('zstrike:settings', JSON.stringify(SETTINGS)); });
Wallet.onWalletChange(refreshUserChips);

$('btn-play').onclick = startSolo;
$('btn-online').onclick = openOnline;
$('btn-restart').onclick = () => { if (online.board && mode === 'menu' && online.id) { online.board = null; openOnline(); } else startSolo(); };
$('btn-go-menu').onclick = () => goMenu();
$('cluster-label').textContent = CLUSTER;
$('controls-hint').textContent = IS_TOUCH
  ? 'Controles: joystick izquierdo para moverte · arrastra a la derecha para apuntar · 🔫 disparar (arrastra para apuntar) · ⤒ saltar · ⇄ cambiar arma'
  : 'Controles: WASD moverte · ratón apuntar (clic para capturar) · clic disparar · Espacio saltar · Q / 1-3 arma · B tienda · ↑↓ Enter en el menú';
renderMapList(); refreshUserChips();
buildWorld(mapId);
camera.position.set(map.w / 2, 6, 2); camera.lookAt(map.w / 2, 0, map.l / 2);
Wallet.tryEagerConnect().then(refreshUserChips);

// ---------------------------------------------------------------- main loop
let last = performance.now(), menuSpin = 0, timeScale = 1;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) * timeScale; last = now;
  if (!paused && (mode === 'solo' || mode === 'online')) {
    updatePlayer(dt); tryFire(dt);
    if (mode === 'solo') { updateBots(dt); updateProjectiles(dt); }
    else updateOnline(dt);
    hud();
  } else if (mode === 'menu' && !$('menu').classList.contains('hidden')) {
    menuSpin += dt * 0.12;
    camera.rotation.set(0, 0, 0);
    if (showcase.visible) { // slowly rotating weapon on a lit pedestal
      showModels[showWeapon].rotation.y = Math.PI / 2 + Math.sin(menuSpin * 2.5) * 0.3; // side profile, gentle sway
      showModels[showWeapon].position.y = Math.sin(menuSpin * 6) * 0.03;
      // weapon sits in the right part of the screen, clear of the left menu + stats panel
      const off = 2.55 * camera.aspect / 2.16;
      camera.position.set(SHOW_POS.x - off, SHOW_POS.y + 0.3, SHOW_POS.z + 2.4);
      camera.lookAt(SHOW_POS.x - off, SHOW_POS.y - 0.05, SHOW_POS.z);
    } else { // low cinematic orbit over the selected map
      camera.position.set(map.w / 2 + Math.sin(menuSpin) * map.w * 0.9, 5.5, map.l / 2 + Math.cos(menuSpin) * map.l * 0.55);
      camera.lookAt(map.w / 2, 1, map.l / 2);
    }
  }
  updateFx(dt);
  if (flashT > 0 && (flashT -= dt) <= 0) flash.visible = false;
  if (hitTimer > 0 && (hitTimer -= dt) <= 0) $('hit-marker').classList.remove('on');
  if (flashTimer > 0 && (flashTimer -= dt) <= 0) $('dmg-flash').style.opacity = 0;
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) $('banner').classList.remove('on');
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test hook (used by the headless screenshot script).
window.__zstrike = { setTimeScale: (v) => (timeScale = v), startSolo, openShop, openOnline, goMenu, selectSection, setShowWeapon, switchWeapon, addKill, damageEnemy, player, get enemies() { return enemies; }, get mode() { return mode; }, online, look };
