// ZStrike - client (single-player vs bots + online deathmatch client)
import * as THREE from 'three';
import { WEAPONS, SHOP_ITEMS, CLUSTER, SERVER_URL, PUBLIC_SERVER_URL, PERKS, STREAKS, MODES, DEFAULT_LOADOUT, CLASS_NAMES, weaponIndex, ZTYPES, SURV, MONO } from './config.js';
import { MAPS, DEFAULT_MAP, createMap, rayHitPlayer, HQ_PORTALS, HQ_BENCH, HQ_RANGE, HQ_SPAWN, V2_MAPS, HQ_COLISEO, HUBS } from './map.js';
import { weaponIcon } from './voxguns.js';
import { flowField, flowDir } from './ai.js';
import { initMatch, newPlayer, beginMatch, tickMatch, handleMsg as matchHandle, board as matchBoard, setLoadout as matchLoadout } from './match.js';
import * as Wallet from './wallet.js';
import { makeWeaponModel } from './weapons3d.js';

const $ = (id) => document.getElementById(id);
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (IS_TOUCH) document.body.classList.add('touch');

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
const hemi = new THREE.HemisphereLight(0xc9a6ff, 0x1a0a33, 1.1); scene.add(hemi);
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
  if (opts.planks) { // light wooden planks with staggered seams
    g.fillStyle = 'rgba(90,60,30,.35)'; for (let y = 0; y < 16; y += 4) { g.fillRect(0, y, 16, 1); g.fillRect(((y / 4) % 2) * 8 + 3, y, 1, 4); }
  }
  if (opts.arch) { // stone face with a dark arched opening (rows of arches on the stands)
    g.fillStyle = '#2a2018'; g.fillRect(4, 7, 8, 9); g.beginPath(); g.arc(8, 7, 4, Math.PI, 0); g.fill();
    g.fillStyle = accent; g.fillRect(3, 6, 1, 10); g.fillRect(12, 6, 1, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Per-theme block materials (cached by map theme).
const matCache = new Map();
const BLOCK_KINDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
function themeMats(theme) {
  if (matCache.has(theme)) return matCache.get(theme);
  const mats = {};
  for (const k of BLOCK_KINDS) {
    if (!theme[k]) continue;
    const [base, accent, style] = theme[k];
    const tex = pixelTex(base, accent, 3 + k * 4, { border: true });
    // glowing kinds (windows / neon trims) are unlit so they read as light sources
    mats[k] = (theme.glow || []).includes(k) ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex });
    if (style === 'arch') { // arches on the sides, plain stone on top/bottom (BoxGeometry face order +x,-x,+y,-y,+z,-z)
      const side = new THREE.MeshLambertMaterial({ map: pixelTex(base, accent, 5 + k * 4, { arch: true }) });
      mats[k] = [side, side, mats[k], mats[k], side, side];
    }
  }
  matCache.set(theme, mats); return mats;
}

// ---------------------------------------------------------------- world
let map = null, mapId = LS.get('map', DEFAULT_MAP), worldGroup = null;
if (!MAPS[mapId]) mapId = DEFAULT_MAP;
function buildWorld(id) {
  if (worldGroup) { scene.remove(worldGroup); worldGroup.traverse((o) => o.geometry?.dispose()); }
  map = createMap(id); worldGroup = new THREE.Group();
  const th = map.theme, mats = themeMats(th);
  scene.background.setHex(th.bg); scene.fog.color.setHex(th.bg);
  const hl = th.hemi || [0xc9a6ff, 0x1a0a33, 1.1]; hemi.color.setHex(hl[0]); hemi.groundColor.setHex(hl[1]); hemi.intensity = hl[2]; // sunny themes (Coliseo)
  const floorTex = pixelTex(th.floor[0], th.floor[1], 5, th.planks ? { planks: true } : { grid: true });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(map.w, map.l);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.l), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(map.w / 2, 0, map.l / 2); worldGroup.add(floor);
  // one instance per 1-high block, plus a partial block for fractional tops (stairs/ramps)
  const box = new THREE.BoxGeometry(1, 1, 1); const m4 = new THREE.Matrix4();
  const S = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Quaternion();
  for (const k of BLOCK_KINDS) {
    if (!mats[k]) continue;
    const parts = [];
    for (let i = 0; i < map.w; i++) for (let j = 0; j < map.l; j++) {
      if (map.kind[i + j * map.w] !== k) continue;
      const h = map.heights[i + j * map.w];
      let y = 0; for (; y + 1 <= h + 1e-6; y++) parts.push([i, y, j, 1]);
      if (h - y > 1e-3) parts.push([i, y, j, h - y]);
    }
    if (!parts.length) continue;
    const im = new THREE.InstancedMesh(box, mats[k], parts.length);
    parts.forEach(([i, y, j, hh], n) => im.setMatrixAt(n, m4.compose(P.set(i + 0.5, y + hh / 2, j + 0.5), Q, S.set(1, hh, 1))));
    worldGroup.add(im);
  }
  // neon strips on top of the end walls
  const strip = new THREE.Mesh(new THREE.BoxGeometry(map.w, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: th.strip }));
  for (const z of [0.5, map.l - 0.5]) { const s2 = strip.clone(); s2.position.set(map.w / 2, 4.02, z); worldGroup.add(s2); }
  scene.add(worldGroup);
}

// ---------------------------------------------------------------- avatars
// Blocky operator: helmet + glowing visor, vest, both arms forward holding a voxel weapon.
function makeAvatar(color, eyes = 0xff3df2, weaponId = null) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color }), dark = new THREE.MeshLambertMaterial({ color: 0x1a1d24 });
  const vest = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) }), skin = new THREE.MeshLambertMaterial({ color: 0x2a2230 });
  const add = (w, h, d, x, y, z, m, name) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (name) b.name = name; g.add(b); return b; };
  add(0.22, 0.6, 0.22, -0.13, 0.3, 0, dark, 'legL'); add(0.22, 0.6, 0.22, 0.13, 0.3, 0, dark, 'legR');
  add(0.56, 0.72, 0.3, 0, 0.98, 0, mat); add(0.6, 0.38, 0.36, 0, 1.08, 0, vest);
  add(0.16, 0.16, 0.46, 0.3, 1.2, -0.17, mat); add(0.16, 0.16, 0.5, -0.2, 1.2, -0.27, mat).rotation.y = -0.35;
  add(0.42, 0.3, 0.42, 0, 1.5, 0, skin); add(0.48, 0.24, 0.48, 0, 1.72, 0.01, mat);
  const eyeM = new THREE.MeshBasicMaterial({ color: eyes });
  add(0.38, 0.08, 0.03, 0, 1.58, -0.215, eyeM);
  if (weaponId && WEAPONS.find((w) => w.id === weaponId)) {
    const gun = makeWeaponModel(weaponId); gun.name = 'gun'; gun.position.set(0.12, 1.24, -0.42); g.add(gun);
  } else add(0.1, 0.1, 0.5, 0.25, 1.22, -0.45, dark, 'gun');
  return g;
}
function setAvatarGun(av, weaponId) {
  const old = av.getObjectByName('gun'); if (old) av.remove(old);
  const gun = makeWeaponModel(weaponId); gun.name = 'gun'; gun.position.set(0.12, 1.24, -0.42); av.add(gun);
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
// floating damage number (firing range)
function dmgNumber(pos, dmg, head) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = '#000'; g.fillStyle = head ? '#ffd84d' : '#fff';
  g.strokeText(Math.round(dmg), 64, 46); g.fillText(Math.round(dmg), 64, 46);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sp.scale.set(0.8, 0.4, 1); sp.position.set(pos.x + (Math.random() - 0.5) * 0.4, pos.y + 2.1, pos.z); scene.add(sp);
  fx.push({ obj: sp, life: 0.8, max: 0.8, v: new THREE.Vector3(0, 1.4, 0), noGrav: true });
}
function explosion(p, size = 3.2, color = 0xff3df2) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }));
  m.position.copy(p); scene.add(m); fx.push({ obj: m, life: 0.35, max: 0.35, grow: size * 0.95 });
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
const gunCache = {};
function gunModel(i) {
  if (!gunCache[i]) {
    const w = WEAPONS[i], m = makeWeaponModel(w.id); m.visible = false;
    if (w.cls === 'bow') { m.rotation.z = 1.05; m.position.set(-0.05, 0.04, 0); }       // canted bow so you see the limbs
    if (w.cls === 'launcher' && w.style) { m.position.set(0.06, 0.05, 0.05); m.scale.setScalar(0.85); } // shoulder-fired
    if (w.cls === 'sniper' || w.cls === 'lmg') m.position.set(0, 0.01, 0.06);
    viewGun.add(m); gunCache[i] = m;
  }
  return gunCache[i];
}
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
  const m = gunModel(player.weapon); camera.updateMatrixWorld(true);
  return m.userData.muzzle.clone().applyMatrix4(m.matrixWorld);
}

// ---------------------------------------------------------------- player + input
const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, armor: 0, onGround: true, alive: true, weapon: 0, cd: 0, recoil: 0,
  ammo: {}, reloadT: 0, reloadMax: 1, adsK: 0, draw: 0, boltT: 0, dualSide: 0, sprint: false, stamina: 1, fallFrom: 0 };
const input = { mx: 0, mz: 0, fire: false, jump: false, ads: false, keys: {} };
const v2On = () => !(mode === 'online' && online.legacy);
function hasPerk(id) { return v2On() && curLoadout().perks.includes(id); }
const curW = () => WEAPONS[player.weapon];
function ammoOf(i) { if (player.ammo[i] === undefined) player.ammo[i] = WEAPONS[i].mag || Infinity; return player.ammo[i]; }
function resetAmmo() { player.ammo = {}; player.reloadT = 0; player.draw = 0; player.boltT = 0; player.adsK = 0; input.ads = false; }
function startReload() {
  const w = curW(); if (!w.mag || player.reloadT > 0 || ammoOf(player.weapon) >= w.mag || !player.alive) return;
  player.reloadMax = player.reloadT = w.reload * (hasPerk('manos') ? 0.65 : 1); player.reloadW = player.weapon; player.draw = 0;
  if (mode === 'online' && !online.legacy) online.send({ t: 'reload', w: player.weapon });
}
let mode = 'menu';      // 'menu' | 'solo' | 'online'
let paused = true;

function availableWeapons() {
  if (mode === 'online' && online.legacy) return [0, 1, 2]; // v1 lobbies (paid / free test): equal loadout, server-checked
  if (mode === 'online' && online.mode === 'surv' && online.survLo) return [online.survLo.primary, online.survLo.secondary].filter((i) => i >= 0 && WEAPONS[i]);
  const lo = curLoadout(), list = [weaponIndex(lo.primary), weaponIndex(lo.secondary)];
  if (mode === 'solo') { // waves: loadout + every v1 shop weapon you own
    const o = stats().owned; WEAPONS.forEach((w, i) => { if (w.legacy && (!w.unlock || o.has(w.unlock)) && !list.includes(i)) list.push(i); });
  }
  return list.filter((i) => i >= 0);
}
function switchWeapon(dir = 1, idx = null) {
  const av = availableWeapons();
  if (idx !== null) { if (av.includes(idx)) player.weapon = idx; }
  else { const k = av.indexOf(player.weapon); player.weapon = av[(k + dir + av.length) % av.length]; }
  const w = WEAPONS[player.weapon];
  if (player.reloadW !== player.weapon) player.reloadT = 0;
  player.draw = 0; player.boltT = 0; player.cd = Math.max(player.cd, 0.25);
  Object.entries(gunCache).forEach(([i, m]) => (m.visible = +i === player.weapon));
  const mz = gunModel(player.weapon).userData.muzzle; gunModel(player.weapon).visible = true;
  muzzle.color.setHex(w.color); muzzle.position.copy(mz); flash.position.copy(mz).add(new THREE.Vector3(0, 0, -0.03));
  flash.material.color.setHex(w.color); $('weapon-text').textContent = w.name + (av.length > 1 ? `  (${av.indexOf(player.weapon) + 1}/${av.length})` : '');
}

// Keyboard / mouse (desktop testing)
addEventListener('keydown', (e) => {
  input.keys[e.code] = true;
  if (mode === 'menu') return;
  if (e.code === 'Space') input.jump = true;
  if (e.code === 'KeyQ') switchWeapon(1);
  if (e.code === 'KeyR') startReload();
  if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) switchWeapon(0, +e.code.slice(5) - 1);
  if (e.code === 'KeyB' && mode === 'solo') openShop();
  if (e.code === 'KeyE' && mode === 'hq') hqInteract();
  if (mode === 'online' && !online.legacy) {
    const st = STREAKS.find((x) => x.key === e.code); if (st) useStreakNow(st.id);
    if (e.code === 'KeyG') throwNade(curLoadout().lethal || 'frag');
    if (e.code === 'KeyF') throwNade(curLoadout().tactical || 'flash');
    if (online.mode === 'surv') { if (e.code === 'KeyE') survInteract(); if (e.code === 'KeyT') throwMono(); }
  }
});
$('btn-nade').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); throwNade(curLoadout().lethal || 'frag'); });
$('btn-use').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); survInteract(); });
$('btn-mono').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); throwMono(); });
$('btn-flash').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); throwNade(curLoadout().tactical || 'flash'); });
addEventListener('keyup', (e) => { input.keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => {
  if (paused || IS_TOUCH) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  else if (e.button === 2) input.ads = true; else input.fire = true;
});
addEventListener('mouseup', (e) => { if (IS_TOUCH) return; if (e.button === 2) input.ads = false; else input.fire = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (mode === 'solo' || mode === 'online' || (mode === 'hq' && hqInRange)) switchWeapon(e.deltaY > 0 ? 1 : -1); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX * 0.0022, e.movementY * 0.0022);
});
function look(dx, dy) {
  const zoom = camera.fov / 75; // slower aim while zoomed (ADS / scope)
  dx *= SETTINGS.sens * zoom; dy *= SETTINGS.sens * zoom;
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
$('btn-ads').addEventListener('pointerdown', (e) => { input.ads = !input.ads; $('btn-ads').classList.toggle('on', input.ads); e.preventDefault(); });
$('btn-reload').addEventListener('pointerdown', (e) => { startReload(); e.preventDefault(); });

// ---------------------------------------------------------------- HUD helpers
let hitTimer = 0, flashTimer = 0, bannerTimer = 0;
function hud() {
  $('hp-fill').style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
  $('hp-text').textContent = Math.max(0, Math.ceil(player.hp));
  $('armor-bar').classList.toggle('hidden', !player.armor);
  $('coins-text').textContent = '🪙 ' + coins;
  $('score-text').textContent = mode === 'online' ? (online.myKills + ' kills') : (score + ' pts');
  const w = curW(), am = ammoOf(player.weapon);
  $('ammo-n').textContent = player.reloadT > 0 ? '··' : (am === Infinity ? '∞' : am);
  $('ammo-n').classList.toggle('low', w.mag > 0 && am <= Math.max(1, Math.floor(w.mag * 0.25)));
  $('ammo-m').textContent = w.mag ? '/' + w.mag : '';
  if (document.body.classList.contains('v2match')) { const lv = level(); $('mm-lvn').textContent = 'LV ' + lv; $('mm-xpf').style.width = (lv >= 50 ? 100 : ((xp % 600) / 6)) + '%'; }
  $('ammo-w').textContent = player.reloadT > 0 ? 'RECARGANDO…' : (w.kind === 'arrow' && player.draw > 0 ? 'TENSANDO ' + Math.round(Math.min(1, player.draw / w.draw) * 100) + '%' : w.name.toUpperCase());
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
const SPECIAL_KILLS = { '-7': ['🧟', 'ZOMBI'], '-8': ['🐒', 'MONO BOMBA'], '-2': ['✈', 'BOMBARDEO'], '-3': ['🚁', 'HELICÓPTERO'], '-4': ['●', 'GRANADA'], '-5': ['⇣', 'CAÍDA'], '-6': ['✸', 'BOMBA'] };
function addKill(killer, wIdx, victim, { head = false, killerMe = false, victimMe = false, side = null } = {}) {
  const w = WEAPONS[wIdx], sp = SPECIAL_KILLS[wIdx];
  let icon, label, color = '#cccccc';
  if (w) { color = '#' + w.color.toString(16).padStart(6, '0'); label = w.short; icon = w.style ? `<img src="${weaponIcon(w, 52, 22)}">` : WEAPON_ICONS[w.id]; }
  else if (sp) { icon = `<b class="sp">${sp[0]}</b>`; label = sp[1]; color = '#ffd84d'; }
  else { icon = WEAPON_ICONS.bot; label = 'BLASTER'; }
  const d = document.createElement('div'); d.className = 'kf' + (side ? ' ' + side : '');
  d.innerHTML = `<span class="k ${killerMe ? 'me' : ''}">${esc(killer)}</span><span class="w" style="color:${color}">${icon}${label}${head ? ' 💀' : ''}</span><span class="v ${victimMe ? 'me' : ''}">${esc(victim)}</span>`;
  const feed = $('killfeed'); feed.prepend(d);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => d.classList.add('out'), 4400);
  setTimeout(() => d.remove(), 5000);
}

// ---------------------------------------------------------------- player physics
const SPEED = 6, GRAVITY = 18, JUMP_V = 6.6, EYE = 1.55, PR = 0.3;
function updatePlayer(dt, speedMult = 1) {
  let mx = input.mx, mz = input.mz;
  if (input.keys.KeyW || input.keys.ArrowUp) mz -= 1;
  if (input.keys.KeyS || input.keys.ArrowDown) mz += 1;
  if (input.keys.KeyA || input.keys.ArrowLeft) mx -= 1;
  if (input.keys.KeyD || input.keys.ArrowRight) mx += 1;
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const wq = curW();
  let sp = SPEED * speedMult * (v2On() ? (wq.move || 1) * (hasPerk('agil') ? 1.1 : 1) * (1 - player.adsK * 0.35) : 1);
  // sprint (Shift, or joystick pushed to the edge): faster, weapon lowered, can't shoot
  const wantSprint = v2On() && player.alive && mz < -0.6 && (input.keys.ShiftLeft || input.keys.ShiftRight || Math.hypot(input.mx, input.mz) > 0.97) && !input.ads && !input.fire;
  const maxSt = hasPerk('maraton') ? 8 : 4;
  if (wantSprint && player.stamina > 0) { player.sprint = true; player.stamina = Math.max(0, player.stamina - dt / maxSt); sp *= 1.35; }
  else { player.sprint = false; player.stamina = Math.min(1, player.stamina + dt / 3); }
  const dx = (mx * c + mz * s) * sp * dt, dz = (-mx * s + mz * c) * sp * dt;
  if (player.alive) map.moveCircle(player.pos, dx, dz, PR);
  if (input.jump && player.onGround && player.alive) { player.vy = JUMP_V; player.onGround = false; }
  input.jump = false;
  player.vy -= GRAVITY * dt; player.pos.y += player.vy * dt;
  const g = map.groundUnder(player.pos.x, player.pos.z, PR);
  if (player.pos.y <= g) {
    // fall damage for big drops (Pluma perk = none); online the server applies it
    if (!player.onGround && v2On() && player.alive) { const drop = player.fallFrom - g; if (drop > 3.2 && !hasPerk('pluma')) fallDamage(Math.round((drop - 3.2) * 18)); }
    player.pos.y = g; player.vy = 0; player.onGround = true;
  } else { if (player.onGround || player.pos.y > player.fallFrom) player.fallFrom = player.pos.y; player.onGround = false; }
  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  // weapon bob + recoil
  const bob = player.onGround ? Math.sin(performance.now() / 110) * 0.012 * Math.min(1, len) : 0;
  player.recoil = Math.max(0, player.recoil - dt * 6);
  // ADS (aim down sights): FOV zoom + gun to the centre; snipers switch to a scope overlay
  const w = curW(), adsRate = 1 / ((w.adsTime || 0.2) * (hasPerk('halcon') ? 0.6 : 1));
  const wantAds = input.ads && player.alive && player.reloadT <= 0 && !player.sprint;
  player.adsK = Math.max(0, Math.min(1, player.adsK + (wantAds ? dt : -dt) * adsRate));
  const fov = 75 + ((w.ads || 60) - 75) * player.adsK * (w.cls === 'sniper' ? (player.adsK > 0.85 ? 1 : 0.3) : 1);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const scoped = w.cls === 'sniper' && player.adsK > 0.85 && (mode !== 'hq' || hqInRange);
  $('scope').classList.toggle('on', scoped); $('crosshair').classList.toggle('hidden', scoped || player.adsK > 0.5);
  // reload / bolt / bow-draw / sprint animations
  if (player.reloadT > 0) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) { player.ammo[player.reloadW] = WEAPONS[player.reloadW].mag || Infinity; player.reloadT = 0; }
  }
  const rk = player.reloadT > 0 ? Math.sin((1 - player.reloadT / player.reloadMax) * Math.PI) : 0;
  player.boltT = Math.max(0, player.boltT - dt);
  const bk = w.bolt && player.boltT > 0 ? Math.sin(Math.min(1, (1 - player.boltT / (w.fireRate * 0.8))) * Math.PI) : 0;
  const drawK = w.kind === 'arrow' ? Math.min(1, player.draw / (w.draw || 0.8)) : 0;
  const spk = player.sprint ? 1 : 0; player.sprintK = (player.sprintK || 0) + (spk - (player.sprintK || 0)) * Math.min(1, dt * 10);
  const a = player.adsK, sw = Math.sin(performance.now() / 600) * 0.004 * (1 - a);
  const dual = w.dual ? 0.1 : 0;
  viewGun.position.set(0.2 * (1 - a) + dual + sw, -0.17 + 0.065 * a + bob * (1 - a * 0.8) - rk * 0.12 - player.sprintK * 0.06, -0.42 + 0.06 * a + player.recoil * 0.08 * (1 - a * 0.5) + drawK * 0.07);
  viewGun.rotation.set(player.recoil * 0.3 * (1 - a * 0.6) - rk * 0.7 - player.sprintK * 0.5, player.sprintK * 0.6, rk * 0.35 + bk * 0.45);
  viewGun.visible = !scoped && (mode !== 'hq' || hqInRange);
  if (w.dual) { const L = gunModel(player.weapon).getObjectByName('left'); if (L) L.position.z = 0.02 + (player.dualSide ? player.recoil * 0.06 : 0); }
}

// ---------------------------------------------------------------- shooting
const tmpDir = new THREE.Vector3();
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + EYE, player.pos.z); }
function aimDir(spread) {
  camera.getWorldDirection(tmpDir);
  tmpDir.x += (Math.random() - 0.5) * spread * 2; tmpDir.y += (Math.random() - 0.5) * spread * 2; tmpDir.z += (Math.random() - 0.5) * spread * 2;
  return tmpDir.normalize().clone();
}
function curSpread(w) {
  let sp = w.spread * (hasPerk('pulso') ? 0.6 : 1) * (Math.hypot(input.mx, input.mz) > 0.2 || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.keys[k]) ? 1.3 : 1);
  if (!player.onGround) sp *= 1.6;
  const adsSp = w.cls === 'sniper' ? 0 : w.spread * 0.18;
  return sp + (adsSp - sp) * player.adsK;
}
function tryFire(dt) {
  player.cd -= dt;
  const w = curW();
  if (!player.alive || player.reloadT > 0) { player.draw = 0; return; }
  if (w.kind === 'arrow') { // bows: hold to draw, release to shoot (damage + speed scale with the draw)
    if (input.fire && player.cd <= 0 && !player.sprint) { player.draw += dt; return; }
    if (player.draw > 0.08 && !input.fire) { const c = Math.min(1, player.draw / (w.draw || 0.8)); player.draw = 0; shoot(w, c); }
    else if (!input.fire) player.draw = 0;
    return;
  }
  if (!input.fire || player.cd > 0 || player.sprint) return;
  if (ammoOf(player.weapon) <= 0) { startReload(); return; }
  shoot(w, 1);
}
function shoot(w, charge) {
  player.cd = w.fireRate; player.recoil = 1;
  if (w.mag) { player.ammo[player.weapon] = ammoOf(player.weapon) - 1; if (player.ammo[player.weapon] <= 0) setTimeout(startReload, w.bolt ? 450 : 150); }
  if (w.bolt) player.boltT = w.fireRate * 0.8;
  if (v2On()) player.pitch = Math.min(1.45, player.pitch + ({ sniper: 0.03, lmg: 0.008, rifle: 0.007, smg: 0.004, pistol: 0.012, launcher: 0.03, bow: 0.006 }[w.cls] || 0.005) * (1 - player.adsK * 0.4));
  muzzle.intensity = 4; setTimeout(() => (muzzle.intensity = 0), 50);
  const gm = gunModel(player.weapon);
  if (w.dual) { player.dualSide ^= 1; const mz = player.dualSide ? gm.userData.muzzle2 : gm.userData.muzzle; flash.position.copy(mz); muzzle.position.copy(mz); }
  flash.visible = true; flash.scale.setScalar(0.12 + Math.random() * 0.08); flash.material.rotation = Math.random() * 6; flashT = 0.05;
  const o = eyePos(), d = aimDir(curSpread(w));
  const gunTip = gunTipWorld();
  if (mode === 'online') {
    online.send({ t: 'shot', w: player.weapon, o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z }, c: +charge.toFixed(2) });
    if (w.kind === 'arrow') { spawnArrow(o, d, w, charge, true); return; }
    const end = o.clone().addScaledVector(d, map.rayWallDistance(o, d, w.range));
    if (w.kind === 'rocket') { const spd = w.speed || 26; bolt(gunTip, end, w.color, spd); setTimeout(() => explosion(end, w.splash), Math.min(3000, end.distanceTo(gunTip) / spd * 1000)); }
    else bolt(gunTip, end, w.color);
    return;
  }
  if (w.kind === 'rocket') { spawnRocket(gunTip, d, w); return; }
  if (w.kind === 'arrow') { spawnArrow(o, d, w, charge, false); return; }
  const wallT = map.rayWallDistance(o, d, w.range);
  let best = null;
  for (const e of enemies) {
    if (e.dummy && !e.mesh.visible) continue;
    const h = rayHitPlayer(o, d, e.pos);
    if (h && h.t < wallT && (!best || h.t < best.h.t)) best = { e, h };
  }
  const end = o.clone().addScaledVector(d, best ? best.h.t : wallT);
  bolt(gunTip, end, w.color);
  if (best) { damageEnemy(best.e, w.damage * stats().dmgMult * (best.h.head ? 2 : 1), best.h.head, player.weapon); burst(end, w.color, 5); }
  else burst(end, w.color, 3, 2);
}
function fallDamage(n) {
  if (n <= 0) return;
  if (mode === 'online') online.send({ t: 'fall', dmg: n });
  else if (mode === 'solo') hurtPlayer(n, 'Caída');
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
  resetAmmo(); player.weapon = availableWeapons()[0]; switchWeapon(0, player.weapon);
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
  if (e.dummy) { // HQ firing range target
    if (!e.mesh.visible) return;
    e.hp -= dmg; hitMarker(); dmgNumber(e.pos, dmg, head);
    if (e.hp <= 0) { e.mesh.visible = false; e.respawnAt = performance.now() + 1500; burst(e.pos.clone().setY(1), 0xff8a1a, 14, 6); }
    return;
  }
  e.hp -= dmg; hitMarker();
  if (e.hp <= 0 && enemies.includes(e)) {
    burst(e.pos.clone().setY(1), 0x14f195, 14, 6); scene.remove(e.mesh); enemies.splice(enemies.indexOf(e), 1);
    const c = 10 + wave * 2 + (head ? 5 : 0); coins += c; LS.set('coins', coins);
    score += head ? 150 : 100; addKill(playerName(), wIdx, e.name, { head, killerMe: true }); addXp(head ? 150 : 100, head ? 'HEADSHOT' : 'KILL');
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
    if (!stop) map.moveWalker(e.pos, dir.x * e.speed * dt, dir.z * e.speed * dt, 0.35);
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
  projectiles.push({ mesh, v: d.clone().multiplyScalar(w.speed), rocket: w, wIdx: player.weapon, life: 4 });
}
// Bow arrows: ballistic (gravity), speed + damage scale with the draw. cosmetic=true online (server decides).
const ARROW_G = 9;
function spawnArrow(o, d, w, charge, cosmetic) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.6), new THREE.MeshBasicMaterial({ color: w.color }));
  mesh.position.copy(o).addScaledVector(d, 0.4); scene.add(mesh);
  const spd = (w.speed || 50) * (0.45 + 0.55 * charge);
  projectiles.push({ mesh, v: d.clone().multiplyScalar(spd), arrow: w, charge, cosmetic, wIdx: player.weapon, life: 4, g: ARROW_G });
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.life -= dt;
    const prev = p.mesh.position.clone();
    if (p.g) { p.v.y -= p.g * dt; p.mesh.lookAt(prev.clone().add(p.v)); }
    p.mesh.position.addScaledVector(p.v, dt); const pos = p.mesh.position;
    let dead = p.life <= 0 || pos.y <= 0 || map.heightAt(pos.x, pos.z) > pos.y;
    if (p.arrow) {
      if (!p.cosmetic && !p.stuck) {
        const seg = pos.clone().sub(prev), L = seg.length(), dn = seg.clone().divideScalar(L || 1);
        let best = null;
        for (const e of enemies) { if (e.dummy && !e.mesh.visible) continue; const h = rayHitPlayer(prev, dn, e.pos); if (h && h.t <= L && (!best || h.t < best.h.t)) best = { e, h }; }
        if (best) { damageEnemy(best.e, p.arrow.damage * (0.35 + 0.65 * p.charge) * stats().dmgMult * (best.h.head ? 2 : 1), best.h.head, p.wIdx); burst(pos.clone(), p.arrow.color, 6); dead = true; }
      }
      if (dead && !p.stuck && p.life > 0) { p.stuck = true; p.v.set(0, 0, 0); p.g = 0; p.life = Math.min(p.life, 2.5); dead = false; } // arrow sticks in the wall
      if (p.stuck) dead = p.life <= 0;
    }
    if (p.enemy) {
      const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z, dy = pos.y - (player.pos.y + 1);
      if (Math.abs(dx) < 0.45 && Math.abs(dz) < 0.45 && Math.abs(dy) < 0.95) { hurtPlayer(p.dmg, p.from); dead = true; }
    } else if (p.rocket) {
      if (!dead) for (const e of enemies) if (rayHitPlayer(pos, { x: 0, y: 1, z: 0 }, { x: e.pos.x, y: e.pos.y - 0.01, z: e.pos.z }) && Math.abs(pos.x - e.pos.x) < 0.45 && Math.abs(pos.z - e.pos.z) < 0.45 && pos.y < e.pos.y + 1.9) { dead = true; break; }
      if (dead) {
        explosion(pos.clone(), p.rocket.splash);
        for (const e of [...enemies]) {
          if (e.dummy && !e.mesh.visible) continue;
          const d = Math.hypot(e.pos.x - pos.x, e.pos.y + 1 - pos.y, e.pos.z - pos.z);
          if (d < p.rocket.splash) damageEnemy(e, p.rocket.damage * stats().dmgMult * (1 - d / p.rocket.splash * 0.6), false, p.wIdx ?? 2);
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
  urls() {
    if (SERVER_URL) return [SERVER_URL];
    const same = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    let pubHost = ''; try { pubHost = new URL(PUBLIC_SERVER_URL).host; } catch (_) {}
    // Same-origin only when this page is served by the game server itself (or a local dev server);
    // on static hosts (itch.io, GitHub Pages) go straight to PUBLIC_SERVER_URL.
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
    const list = location.protocol.startsWith('http') && (location.host === pubHost || local || !pubHost) ? [same] : [];
    if (PUBLIC_SERVER_URL && !list.includes(PUBLIC_SERVER_URL)) list.push(PUBLIC_SERVER_URL);
    return list;
  },
  open(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let ws, done = false;
      try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (_) {} reject(new Error('timeout')); } }, timeoutMs);
      ws.onopen = () => { if (!done) { done = true; clearTimeout(t); resolve(ws); } };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(t); reject(new Error('No se pudo conectar al servidor')); } };
    });
  },
  async connect() {
    if (this.ws && this.ws.readyState === 1) return;
    let ws = null, last = null;
    for (const url of this.urls()) {
      // a sleeping free-tier server can take ~30-60 s to wake up
      if (url === PUBLIC_SERVER_URL && !url.includes(location.host)) onlineInfo('Conectando al servidor online… (si estaba dormido puede tardar hasta 1 minuto)');
      try { ws = await this.open(url, url === PUBLIC_SERVER_URL ? 75000 : 8000); break; } catch (e) { last = e; }
    }
    if (!ws) throw last || new Error('No se pudo conectar al servidor');
    this.ws = ws; this.wasOpen = true;
    ws.onclose = () => { if (this.inMatch) { banner('Desconectado'); } this.ws = null; if (this.wasOpen) onlineInfo('Desconectado del servidor.', true); this.wasOpen = false; };
    ws.onmessage = (ev) => this.onMsg(JSON.parse(ev.data));
    this.send({ t: 'hello', name: shortName() });
  },
  send(m) {
    if (this.local) { const me = this.local.players.get('ME'); if (me) matchHandle(this.local, me, m); return; }
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  },
  clearRemotes() { this.remotes.forEach((r) => scene.remove(r.mesh)); this.remotes.clear(); clearMatchFx(); },
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
          if (p.id === this.id) { player.hp = p.hp; this.myTeam = p.tm ?? this.myTeam; if (p.pt !== undefined) SV.myPts = p.pt; continue; }
          let r = this.remotes.get(p.id);
          if (!r && p.zt) {
            r = { mesh: makeZombie(p.zt), tgt: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, walk: 0, zombie: p.zt, phase: Math.random() * 6 };
            r.mesh.position.set(p.x, p.y, p.z); scene.add(r.mesh); this.remotes.set(p.id, r);
          }
          if (!r) {
            const v2 = !this.legacy, mate = v2 && this.teamMode && p.tm === this.myTeam;
            const col = !v2 ? (p.bot ? 0xff3df2 : 0x14f195) : mate ? 0x3f8cff : (this.teamMode ? 0xff4a3d : 0xff3df2);
            r = { mesh: makeAvatar(col, mate ? 0x14f195 : 0xffffff, v2 && p.w !== undefined ? WEAPONS[p.w]?.id : null), tgt: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, walk: 0, mate };
            if (mate) { const tag = makeLabel('▼ ' + this.name(p.id), '#14f195', 256); tag.scale.multiplyScalar(0.55); tag.position.y = 2.35; r.mesh.add(tag); }
            r.mesh.position.set(p.x, p.y, p.z); scene.add(r.mesh); this.remotes.set(p.id, r);
          }
          r.tgt.set(p.x, p.y, p.z); r.yaw = p.yaw; r.mesh.visible = p.alive; r.alive = p.alive; r.tm = p.tm; r.ghost = p.g; r.hp = p.hp; r.mh = p.mh; r.seen = m;
        }
        if (this.mode === 'surv') for (const [id, r] of this.remotes) if (r.zombie && r.seen !== m) { scene.remove(r.mesh); this.remotes.delete(id); }
        if (m.sc) this.sc = m.sc;
        if (m.u) this.uav = m.u;
        syncHelis(m.h || []);
        if (m.o) { this.obj = m.o; syncObjectives(m.o); syncSurvObj(m.o); }
        break;
      case 'streakReady': streakReady(m.id); break;
      case 'streak': onStreak(m); break;
      case 'nade': onNade(m); break;
      case 'survLo': onSurvLo(m); break;
      case 'boxOpen': onBoxOpen(m); break;
      case 'boxGot': onBoxGot(m); break;
      case 'boxNo': banner(`NECESITAS ${m.need} PUNTOS (tienes ${m.have})`, 1.6); break;
      case 'flashed': flashOverlay(m.dur); break;
      case 'second': banner('¡SEGUNDA OPORTUNIDAD!', 1.5); break;
      case 'medal': medal({ cap: 'BANDERA CAPTURADA', capture: '¡CAPTURA!', plant: 'BOMBA PLANTADA', defuse: 'BOMBA DESACTIVADA' }[m.id] || m.id, 150); break;
      case 'obj': onObjEvent(m); break;
      case 'fx': {
        if (m.from !== this.id && !m.q && m.from !== 'heli') { const r = this.remotes.get(m.from); if (r) r.pingUntil = performance.now() + 1500; }
        if (m.w === -3) { bolt(new THREE.Vector3(m.o.x, m.o.y, m.o.z), new THREE.Vector3(m.e.x, m.e.y, m.e.z), 0xffd84d, 120); break; }
        if (m.from === this.id) break;
        if (m.arrow) { const o = new THREE.Vector3(m.o.x, m.o.y, m.o.z), e = new THREE.Vector3(m.e.x, m.e.y, m.e.z); bolt(o, e, WEAPONS[m.w]?.color || 0xffffff, 45); break; }
        const o = new THREE.Vector3(m.o.x, m.o.y - 0.25, m.o.z), e = new THREE.Vector3(m.e.x, m.e.y, m.e.z);
        const spd = m.exp ? (WEAPONS[m.w]?.speed || 40) : 90;
        bolt(o, e, WEAPONS[m.w]?.color || 0xffffff, spd); if (m.exp) setTimeout(() => explosion(e, WEAPONS[m.w]?.splash), Math.min(this.legacy ? 600 : 3000, o.distanceTo(e) / spd * 1000));
        break;
      }
      case 'hit':
        if (m.by === this.id) hitMarker();
        if (m.target === this.id) { player.hp = m.hp; damageFlash(); }
        break;
      case 'kill': {
        if (m.zt) { onSurvKill(m); break; }
        const kr = this.remotes.get(m.killer), kTeam = m.killer === this.id ? this.myTeam : kr?.tm;
        const side = this.legacy ? null : (m.killer === this.id || (this.teamMode && kTeam === this.myTeam) ? 'good' : 'bad');
        addKill(this.name(m.killer), m.w ?? 0, this.name(m.victim), { head: m.head, killerMe: m.killer === this.id, victimMe: m.victim === this.id, side });
        if (m.victim === this.id) {
          player.alive = false; player.hp = 0; this.streakN = 0;
          $('respawn-text').textContent = this.mode === 'snd' ? 'Eliminado · esperando la siguiente ronda' : this.mode === 'surv' ? 'Caíste · vuelves en la siguiente oleada (si tu equipo sobrevive)' : 'Reapareciendo…';
        }
        if (m.killer === this.id && m.victim !== this.id && !this.legacy) killRewards(m);
        break;
      }
      case 'respawn':
        if (m.id === this.id) { player.alive = true; player.hp = 100; player.pos.set(m.x, 0, m.z); player.vy = 0; player.yaw = m.z > map.l / 2 ? 0 : Math.PI; $('respawn-text').textContent = ''; }
        break;
      case 'correct': player.pos.set(m.x, m.y, m.z); break;
      case 'score': this.board = m.board; if (m.sc) this.sc = m.sc; this.renderBoard(); break;
      case 'end': this.endMatch(m); break;
      case 'ending': banner('¡Tiempo! Calculando ganador…', 5); break;
      case 'refund': onlineMsg(`Reembolso enviado: <a href="${Wallet.explorerTxUrl(m.sig)}" target="_blank">ver tx</a>`); break;
    }
  },
  name(id) { if (String(id).startsWith('Z')) return 'Zombi'; return (this.board || []).find((b) => b.id === id)?.name || (id === this.id ? playerName() : '?'); },
  renderBoard() {
    const b = (this.board || []).slice().sort((a, c) => c.kills - a.kills || a.deaths - c.deaths);
    this.myKills = b.find((x) => x.id === this.id)?.kills || 0;
    $('scoreboard').innerHTML = b.slice(0, 6).map((x, i) => `<div class="${x.id === this.id ? 'me' : ''}">${i + 1}. ${esc(x.name)} ${x.kills}/${x.deaths}</div>`).join('');
  },
  startMatch(m) {
    mode = 'online'; this.inMatch = true; clearSolo(); this.clearRemotes(); this.legacy = m.legacy ?? !m.mode; resetAmmo();
    buildWorld(m.map); this.endsAt = Date.now() + m.secondsLeft * 1000; this.board = m.board; this.renderBoard();
    Object.assign(player, { hp: 100, maxHp: 100, armor: 0, alive: true, vy: 0, pitch: 0, cd: 0 });
    player.pos.set(m.spawn.x, 0, m.spawn.z); player.yaw = m.spawn.z > map.l / 2 ? 0 : Math.PI;
    this.mode = m.mode || null; this.teamMode = !!m.teamMode; this.myTeam = m.team; this.scoreLimit = m.scoreLimit || 0; this.sc = [0, 0];
    this.uav = []; this.ready = new Set(); this.streakN = 0; this.obj = m.obj || null; renderStreakPrompt();
    player.weapon = availableWeapons()[0]; switchWeapon(0, player.weapon); $('wave-text').textContent = this.mode ? MODES[this.mode].name : 'DEATHMATCH';
    if (this.mode) { buildMinimap(); if (m.obj) syncObjectives(m.obj); }
    $('mp-timer').classList.remove('hidden'); $('scoreboard').classList.remove('hidden'); $('btn-shop').classList.add('hidden');
    $('online').classList.add('hidden'); $('online').classList.remove('in-lobby'); showGame();
    banner(this.mode ? MODES[this.mode].name + (this.teamMode ? ' · EQUIPO AZUL' : '') : (MAPS[m.map]?.name || '').toUpperCase() + ' · ¡A PELEAR!', 2.5);
    $('mp-timer').classList.toggle('hidden', !!this.mode); $('scoreboard').classList.toggle('hidden', !!this.mode);
    document.body.classList.toggle('v2match', !!this.mode); document.body.classList.toggle('surv', this.mode === 'surv');
    if (this.mode === 'surv') { banner('SURVIVE THE 150 · ¡AGUANTA 150 OLEADAS!', 3); if (m.obj) syncSurvObj(m.obj); }
  },
  endMatch(m) {
    this.inMatch = false; paused = true; document.exitPointerLock?.();
    const rows = m.board.sort((a, c) => c.kills - a.kills || a.deaths - c.deaths).map((x, i) => `${i + 1}. ${esc(x.name)} — ${x.kills} ${m.mode === 'surv' ? 'zombis · ' + (x.score || 0) + ' pts' : 'kills / ' + x.deaths + ' muertes'}`).join('<br>');
    let pay = '';
    if (m.payout?.winnerSig) pay = `<br>💰 Premio ${m.payout.winnerSol.toFixed(4)} SOL → ganador · <a href="${Wallet.explorerTxUrl(m.payout.winnerSig)}" target="_blank">ver tx</a>`;
    else if (m.payout?.note) pay = '<br>' + esc(m.payout.note);
    else if (m.payout?.error) pay = '<br>⚠️ Error en el pago: ' + esc(m.payout.error);
    let head = `🏆 Ganador: <b>${esc(m.winner?.name || '—')}</b>${m.winner?.id === this.id ? ' (¡TÚ!)' : ''}`;
    if (m.mode === 'surv') {
      const won = m.winTeam === 0, waves = m.sc?.[0] ?? 0;
      head = won
        ? `<span class="champ">🏆 ¡CAMPEÓN DEL COLISEO! 🏆</span><br><b>Sobreviviste las ${SURV.waves} oleadas</b>`
        : `<b style="font-size:22px;color:#ff5a5a">CAÍSTE EN EL COLISEO</b><br>Oleadas superadas: <b>${waves} / ${SURV.waves}</b>`;
      addXp(won ? 5000 : Math.min(3000, 40 * waves + 100), won ? 'CAMPEÓN DEL COLISEO' : 'SURVIVE THE 150');
      $('gameover').classList.toggle('victory', won);
    } else if (m.mode && MODES[m.mode]?.team) {
      const won = m.winTeam === this.myTeam, tie = m.winTeam === -1;
      head = `<b style="font-size:22px;color:${tie ? '#fff' : won ? '#14f195' : '#ff5a5a'}">${tie ? 'EMPATE' : won ? '¡VICTORIA!' : 'DERROTA'}</b> · ${MODES[m.mode].name} ${m.sc ? m.sc.join(' - ') : ''}`;
      addXp(tie ? 300 : won ? 600 : 200, tie ? 'EMPATE' : won ? 'VICTORIA' : 'PARTIDA');
    } else if (m.mode) addXp(m.winner?.id === this.id ? 600 : 200, m.winner?.id === this.id ? 'VICTORIA' : 'PARTIDA');
    $('go-stats').innerHTML = `${head}<br><br>${rows}${pay}`;
    if (m.mode !== 'surv') $('gameover').classList.remove('victory');
    $('gameover').querySelector('h2').textContent = m.mode === 'surv' ? (m.winTeam === 0 ? '¡VICTORIA!' : 'FIN DE LA PARTIDA') : 'GAME OVER';
    this.lastEnd = m; document.body.classList.remove('v2match', 'surv'); clearMatchFx();
    if (this.local) { this.local = null; this.id = null; }
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
  $('online').classList.remove('v2mode'); $('online-title').textContent = 'ONLINE · DEATHMATCH';
  $('menu').classList.add('hidden'); $('online').classList.remove('hidden'); $('gameover').classList.add('hidden'); refreshUserChips();
  onlineMsg(''); $('lobby-players').innerHTML = ''; $('online').classList.remove('in-lobby'); $('lobby-vote').classList.add('hidden');
  refreshOnlineWallet();
  try { await online.connect(); online.send({ t: 'info' }); }
  catch (e) { onlineInfo('No se pudo conectar al servidor online. Inténtalo otra vez en un minuto (el servidor gratis se duerme cuando no hay jugadores).', true); }
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
$('btn-online-back').onclick = () => { online.send({ t: 'leave' }); if ($('online').classList.contains('v2mode')) { $('online').classList.remove('v2mode'); enterHQ(); } else goMenu('online'); };

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

// ---------------------------------------------------------------- v2: progression (XP / levels / unlocks)
const XP_PER_LVL = 600, MAX_LVL = 50;
let xp = LS.get('xp', 0);
function level() { return Math.min(MAX_LVL, 1 + Math.floor(xp / XP_PER_LVL)); }
function lvlProgress() { return level() >= MAX_LVL ? 1 : (xp % XP_PER_LVL) / XP_PER_LVL; }
function isUnlocked(w) { return w.legacy ? (!w.unlock || stats().owned.has(w.unlock)) : (w.lvl || 1) <= level(); }
function addXp(n, why = '', silent = false) {
  if (!n) return; const before = level(); xp += n; LS.set('xp', xp);
  if (!silent) xpToast(`+${n} XP${why ? ' · ' + why : ''}`);
  const after = level();
  if (after > before) {
    banner('¡NIVEL ' + after + '!', 2.5);
    WEAPONS.filter((w) => !w.legacy && w.lvl > before && w.lvl <= after).forEach((w, k) => setTimeout(() => showUnlocked(w), 600 + k * 2600));
  }
}
let xpToastT = null;
function xpToast(t) {
  const el = $('xp-toast'); if (!el) return; el.textContent = t; el.classList.add('on');
  clearTimeout(xpToastT); xpToastT = setTimeout(() => el.classList.remove('on'), 1400);
}
const unlockQueue = []; let unlockBusy = false;
function showUnlocked(w) { unlockQueue.push(w); if (!unlockBusy) nextUnlock(); }
function nextUnlock() {
  const w = unlockQueue.shift(); if (!w) { unlockBusy = false; return; } unlockBusy = true;
  $('up-img').src = weaponIcon(w, 192, 80); $('up-name').textContent = w.name.toUpperCase() + ' · ' + CLASS_NAMES[w.cls];
  const el = $('unlock-pop'); el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  setTimeout(() => { el.classList.add('hidden'); nextUnlock(); }, 2400);
}
function iconFor(w) { return w.style ? weaponIcon(w) : 'data:image/svg+xml,' + encodeURIComponent(WEAPON_ICONS[w.id].replace('currentColor', '#' + w.color.toString(16).padStart(6, '0')).replace(/currentColor/g, '#' + w.color.toString(16).padStart(6, '0')).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')); }

// ---------------------------------------------------------------- v2: loadouts (5 slots, saved in localStorage)
const SKINS = [0x3fe3ff, 0x14f195, 0xff3df2, 0xffb347, 0x9945ff, 0xff4a3d, 0xf4f4f4, 0x6e8f3a];
let loadouts = LS.get('loadouts', null);
if (!Array.isArray(loadouts) || loadouts.length !== 5) loadouts = [1, 2, 3, 4, 5].map((n) => ({ name: 'CLASE ' + n, ...DEFAULT_LOADOUT, perks: [...DEFAULT_LOADOUT.perks] }));
let loSel = Math.max(0, Math.min(4, LS.get('loadoutSel', 0)));
function saveLoadouts() { LS.set('loadouts', loadouts); LS.set('loadoutSel', loSel); }
function curLoadout() {
  const lo = loadouts[loSel];
  const ok = (id, slot) => { const w = WEAPONS.find((x) => x.id === id); return w && w.slot === slot && isUnlocked(w); };
  if (!ok(lo.primary, 'primary')) lo.primary = DEFAULT_LOADOUT.primary;
  if (!ok(lo.secondary, 'secondary')) lo.secondary = DEFAULT_LOADOUT.secondary;
  if (!Array.isArray(lo.perks) || lo.perks.length !== 3) lo.perks = [...DEFAULT_LOADOUT.perks];
  lo.perks = lo.perks.map((id, i) => (PERKS[i + 1].some((p) => p.id === id) ? id : DEFAULT_LOADOUT.perks[i]));
  return lo;
}
const skinColor = () => SKINS[LS.get('skin', 0)] ?? SKINS[0];

// 3D stage for the loadout screen (far away from the arena, like the weapon showcase)
const stage = new THREE.Group(); stage.visible = false; scene.add(stage);
const STAGE_POS = new THREE.Vector3(0, -80, 0); stage.position.copy(STAGE_POS);
{
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.06, 40), new THREE.MeshPhongMaterial({ color: 0x0a1622, emissive: 0x04121c }));
  disc.position.y = -0.03; stage.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.015, 6, 64), new THREE.MeshBasicMaterial({ color: 0x3fe3ff })); ring.rotation.x = Math.PI / 2; stage.add(ring);
  for (let i = 0; i < 14; i++) { // backdrop: neon blocks
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + (i * 7) % 5, 1), new THREE.MeshLambertMaterial({ color: i % 3 ? 0x14232b : 0x203a48 }));
    b.position.set(-7 + i, b.geometry.parameters.height / 2 - 0.5, 4 + (i % 2)); stage.add(b);
  }
  const key = new THREE.PointLight(0x3fe3ff, 8, 8); key.position.set(-1.5, 2.2, -2); stage.add(key);
  const fill = new THREE.PointLight(0xff3df2, 5, 8); fill.position.set(2, 1.5, 1); stage.add(fill);
}
let stageAvatar = null, stageSpin = 0, stageWeapon = null;
function refreshStage(previewId) {
  const wid = previewId || curLoadout().primary;
  if (stageAvatar && stageWeapon === wid && stageAvatar.userData.skin === skinColor()) return;
  if (stageAvatar) stage.remove(stageAvatar);
  stageAvatar = makeAvatar(skinColor(), 0x3fe3ff, wid); stageAvatar.userData.skin = skinColor(); stageWeapon = wid;
  stageAvatar.scale.setScalar(1.15); stage.add(stageAvatar);
}

let loadoutOpen = false, loTab = 'mp', loPick = null, loPickCls = null, loReturn = null;
function openLoadout(ret) {
  loadoutOpen = true; loReturn = ret || (mode === 'hq' ? 'hq' : 'menu'); loPick = null; loTab = 'mp';
  paused = true; document.exitPointerLock?.(); input.mx = input.mz = 0;
  ['menu', 'hq-hud', 'touch', 'hud'].forEach((id) => $(id).classList.add('hidden'));
  $('loadout').classList.remove('hidden'); stage.visible = true; viewGun.visible = false; if (hqAvatar) hqAvatar.visible = false; refreshStage(); renderLoadout();
}
function closeLoadout() {
  loadoutOpen = false; stage.visible = false; saveLoadouts(); $('loadout').classList.add('hidden');
  if (loReturn === 'hq' && mode === 'hq') { hqResume(); }
  else { viewGun.visible = true; $('menu').classList.remove('hidden'); selectSection(menuSec); }
}
function statBars(w) {
  const pct = (v) => Math.round(Math.max(0.05, Math.min(1, v)) * 100);
  const dps = w.damage / w.fireRate;
  return `<span>DAÑO</span><i><b style="width:${pct(w.damage / 140)}%"></b></i><span>CADENCIA</span><i><b style="width:${pct(dps / 260)}%"></b></i>` +
    `<span>ALCANCE</span><i><b style="width:${pct(w.range / 150)}%"></b></i><span>CARGADOR</span><i><b style="width:${pct(w.mag ? w.mag / 100 : 1)}%"></b></i>`;
}
function renderLoadout() {
  const lo = curLoadout(), R = $('lo-right');
  $('lo-name').textContent = lo.name; $('lo-lv').textContent = 'NV ' + level(); $('lo-coins').textContent = '🪙 ' + coins;
  document.querySelectorAll('#lo-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === loTab));
  $('lo-slots').innerHTML = loadouts.map((_, i) => `<button data-i="${i}" class="${i === loSel ? 'sel' : ''}">${i + 1}</button>`).join('');
  $('lo-slots').querySelectorAll('button').forEach((b) => (b.onclick = () => { loSel = +b.dataset.i; loPick = null; saveLoadouts(); refreshStage(); renderLoadout(); }));
  if (loTab === 'custom') {
    R.innerHTML = `<div class="lo-sub">OPERADOR · COLOR</div><div class="lo-skins">${SKINS.map((c, i) => `<button data-i="${i}" class="${LS.get('skin', 0) === i ? 'sel' : ''}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('')}</div>
      <div class="lo-sub">NOMBRE</div><div class="hm-small">${esc(playerName())} (cámbialo en AJUSTES)</div>`;
    R.querySelectorAll('.lo-skins button').forEach((b) => (b.onclick = () => { LS.set('skin', +b.dataset.i); refreshStage(); renderLoadout(); if (hqAvatar) { scene.remove(hqAvatar); hqAvatar = null; } }));
    return;
  }
  if (loTab === 'inv') {
    R.innerHTML = `<div class="lo-sub">NIVEL ${level()} · ${xp} XP</div><div class="lo-xp"><i style="width:${Math.round(lvlProgress() * 100)}%"></i></div>
      <div class="lo-inv">${WEAPONS.map((w) => `<div class="${isUnlocked(w) ? '' : 'locked'}"><img src="${iconFor(w)}"><br>${esc(w.name.toUpperCase())}<br><small>${isUnlocked(w) ? CLASS_NAMES[w.cls] : (w.legacy ? 'TIENDA' : 'NIVEL ' + w.lvl)}</small></div>`).join('')}</div>`;
    return;
  }
  if (loPick === 'primary' || loPick === 'secondary') {
    const slot = loPick, classes = [...new Set(WEAPONS.filter((w) => w.slot === slot).map((w) => w.cls))];
    if (!classes.includes(loPickCls)) loPickCls = WEAPONS.find((w) => w.id === lo[slot]).cls;
    const list = WEAPONS.filter((w) => w.slot === slot && w.cls === loPickCls && (!w.legacy || isUnlocked(w)));
    R.innerHTML = `<div class="lo-pick-head"><button id="lo-pback">‹</button>${classes.map((c) => `<button data-c="${c}" class="${c === loPickCls ? 'sel' : ''}">${CLASS_NAMES[c]}</button>`).join('')}</div>` +
      list.map((w) => `<button class="lo-wrow ${w.id === lo[slot] ? 'sel' : ''} ${isUnlocked(w) ? '' : 'locked'}" data-id="${w.id}"><img src="${iconFor(w)}"><span class="nm">${esc(w.name.toUpperCase())}<small>${isUnlocked(w) ? (w.mag ? w.mag + ' BALAS' : '∞') : 'NIVEL ' + w.lvl}</small></span><span class="sts">${statBars(w)}</span></button>`).join('');
    $('lo-pback').onclick = () => { loPick = null; refreshStage(); renderLoadout(); };
    R.querySelectorAll('.lo-pick-head button[data-c]').forEach((b) => (b.onclick = () => { loPickCls = b.dataset.c; renderLoadout(); }));
    R.querySelectorAll('.lo-wrow').forEach((b) => (b.onclick = () => {
      const w = WEAPONS.find((x) => x.id === b.dataset.id); refreshStage(w.id);
      if (!isUnlocked(w)) { loToast(`Se desbloquea en el nivel ${w.lvl}`); return; }
      lo[slot] = w.id; saveLoadouts(); renderLoadout();
    }));
    return;
  }
  if (loPick && loPick.startsWith('perk')) {
    const k = +loPick.slice(4);
    R.innerHTML = `<div class="lo-pick-head"><button id="lo-pback">‹</button><span class="lo-sub">PERK ${k}</span></div>` +
      PERKS[k].map((p) => `<button class="lo-perk ${lo.perks[k - 1] === p.id ? 'sel' : ''}" data-id="${p.id}"><span class="lo-icon p${k}"><i>${p.icon}</i></span><span><b>${p.name.toUpperCase()}</b><span>${p.desc}</span></span></button>`).join('');
    $('lo-pback').onclick = () => { loPick = null; renderLoadout(); };
    R.querySelectorAll('.lo-perk').forEach((b) => (b.onclick = () => { lo.perks[k - 1] = b.dataset.id; saveLoadouts(); loPick = null; renderLoadout(); }));
    return;
  }
  const P = WEAPONS.find((w) => w.id === lo.primary), S = WEAPONS.find((w) => w.id === lo.secondary);
  const perk = (k) => PERKS[k].find((p) => p.id === lo.perks[k - 1]);
  R.innerHTML = `<div class="lo-grid">
      <button class="lo-card" id="lo-p"><div class="lbl">PRINCIPAL · ${CLASS_NAMES[P.cls]}</div><div class="nm">${esc(P.name.toUpperCase())}</div><img src="${iconFor(P)}"><span class="gs">ARMERO ›</span></button>
      <button class="lo-card" id="lo-s"><div class="lbl">SECUNDARIA · ${CLASS_NAMES[S.cls]}</div><div class="nm">${esc(S.name.toUpperCase())}</div><img src="${iconFor(S)}"><span class="gs">ARMERO ›</span></button>
    </div>
    <div class="lo-sub">LETAL · TÁCTICO</div>
    <div class="lo-row3"><div class="lo-icon eq"><i>●</i>GRANADA${lo.perks[1] === 'bolsillo' ? ' ×2' : ''}</div><div class="lo-icon eq"><i>✺</i>CEGADORA</div><div class="lo-icon eq"><i>⚑</i>${IS_TOUCH ? 'BOTÓN 💣' : 'TECLAS G / F'}</div></div>
    <div class="lo-sub">RACHAS (KILLS SIN MORIR)</div>
    <div class="lo-row3">${STREAKS.map((k) => `<div class="lo-icon st"><i>${{ uav: '◉', air: '✈', heli: '🚁' }[k.id]}</i>${k.name} <b>${k.kills}</b></div>`).join('')}</div>
    <div class="lo-sub">PERKS</div>
    <div class="lo-row3">${[1, 2, 3].map((k) => `<button class="lo-icon p${k}" data-perk="${k}"><i>${perk(k).icon}</i>${perk(k).name.toUpperCase()}</button>`).join('')}</div>`;
  $('lo-p').onclick = () => { loPick = 'primary'; loPickCls = null; renderLoadout(); };
  $('lo-s').onclick = () => { loPick = 'secondary'; loPickCls = null; renderLoadout(); };
  R.querySelectorAll('[data-perk]').forEach((b) => (b.onclick = () => { loPick = 'perk' + b.dataset.perk; renderLoadout(); }));
  refreshStage();
}
function loToast(t) { xpToast(t); }
$('lo-back').onclick = closeLoadout;
document.querySelectorAll('#lo-tabs button').forEach((b) => (b.onclick = () => { loTab = b.dataset.tab; loPick = null; renderLoadout(); }));

// ---------------------------------------------------------------- v2: HQ (third-person hub)
let hqAvatar = null, hqNear = null, hqInRange = false, hqFading = false, hqPortalMeshes = [], netMode = LS.get('net', 'bots');
function makeLabel(text, color = '#3fe3ff', w = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(4,10,18,.75)'; g.fillRect(0, 8, w, 48); g.fillStyle = color; g.fillRect(0, 8, 4, 48);
  g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(text, w / 2, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false })); sp.scale.set(w / 64 * 0.8, 0.8, 1); return sp;
}
function buildHQDeco() {
  hqPortalMeshes = [];
  for (const p of HQ_PORTALS) {
    const M = MODES[p.mode];
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(2, 3.4), new THREE.MeshBasicMaterial({ color: M.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    surf.position.set(p.x0 + 1, 1.7, p.z + 0.55); worldGroup.add(surf);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1), new THREE.MeshBasicMaterial({ color: M.color })); beam.position.set(p.x0 + 1, 3.75, p.z + 0.5); worldGroup.add(beam);
    const lbl = makeLabel(M.short + ' · ' + M.name, '#' + M.color.toString(16).padStart(6, '0'), 420); lbl.position.set(p.x0 + 1, 4.5, p.z + 0.2); worldGroup.add(lbl);
    hqPortalMeshes.push(surf);
  }
  const lb = makeLabel('ARMERÍA · LOADOUT', '#ffb347', 320); lb.position.set(HQ_BENCH.x, 2.6, HQ_BENCH.z + 2); worldGroup.add(lb);
  const lr = makeLabel('CAMPO DE TIRO', '#ff3df2', 300); lr.position.set(21.5, 3.3, 12); worldGroup.add(lr);
  const lh = makeLabel('HELIPUERTO', '#3fe3ff', 260); lh.position.set(16.5, 2.4, 10); worldGroup.add(lh);
  // Coliseo (east wing): golden swirl in the arena centre = gate to Survive the 150
  { const C = HQ_COLISEO, M = MODES.surv;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: M.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    col.position.set(C.x, 1.7, C.z); worldGroup.add(col); hqPortalMeshes.push(col); col.name = 'surv-portal';
    const lbl = makeLabel('🏟 ' + M.name, '#ffb347', 420); lbl.position.set(C.x, 4.4, C.z + C.R + 0.5); worldGroup.add(lbl);
    const l2 = makeLabel('COLISEO', '#ffd27a', 260); l2.position.set(32.5, 4.6, 29.5); worldGroup.add(l2);
    const mono = makeMonoBomba(); mono.scale.setScalar(1.6); mono.position.set(C.x + 3, 0.05, C.z + 1); mono.rotation.y = Math.PI * 0.8; mono.name = 'hq-mono'; worldGroup.add(mono);
    const z1 = makeZombie('walker'); z1.position.set(C.x - 3, 0.05, C.z - 2); z1.rotation.y = 0.6; worldGroup.add(z1);
    const z2 = makeZombie('boss'); z2.position.set(C.x + 1, 0.05, C.z - 4); worldGroup.add(z2); z2.scale.setScalar(1.6); }
  // weapon on the bench (your current primary), slowly turning
  const g = makeWeaponModel(curLoadout().primary); g.scale.setScalar(1.6); g.position.set(7.5, 1.35, 18.5); g.name = 'bench-gun'; worldGroup.add(g);
  // range targets (dummies): stand on the berm
  enemies.forEach((e) => scene.remove(e.mesh)); enemies = [];
  for (const [x, z] of [[23.5, 22.5], [25.5, 22.5], [27.5, 22.5], [29.5, 22.5], [24.5, 19.5], [28.5, 17.5]]) spawnDummy(x, z);
}
function spawnDummy(x, z) {
  const mesh = makeAvatar(0xff8a1a, 0xffffff); mesh.position.set(x, map.groundUnder(x, z, 0.3), z); mesh.rotation.y = Math.PI; scene.add(mesh);
  enemies.push({ name: 'Blanco', mesh, pos: mesh.position, hp: 150, maxHp: 150, dummy: true, home: [x, z], speed: 0, cd: 1e9, walk: 0 });
}
function enterHQ() {
  if (loadoutOpen) { loadoutOpen = false; stage.visible = false; $('loadout').classList.add('hidden'); }
  mode = 'hq'; clearSolo(); online.clearRemotes(); hqFading = false;
  if (online.local) { online.local = null; online.id = null; } online.inMatch = false;
  document.body.classList.remove('v2match'); $('online').classList.remove('v2mode');
  ['menu', 'gameover', 'shop', 'online', 'fade'].forEach((id) => $(id).classList.add('hidden'));
  buildWorld('hq'); buildHQDeco();
  Object.assign(player, { hp: 100, maxHp: 100, armor: 0, alive: true, vy: 0, yaw: Math.PI, pitch: -0.15, cd: 0 });
  player.pos.set(HQ_SPAWN.x, map.groundUnder(HQ_SPAWN.x, HQ_SPAWN.z, 0.3), HQ_SPAWN.z);
  hqResume(); $('killfeed').innerHTML = '';
  $('hq-help').textContent = IS_TOUCH ? 'Joystick: caminar · arrastra: mirar · entra a un portal para jugar' : 'WASD caminar · ratón mirar (clic para capturar) · E interactuar · entra a un portal para jugar';
  $('hq-lv').textContent = 'NV ' + level();
}
function hqResume() {
  if (!hqAvatar || hqAvatar.userData.skin !== skinColor()) {
    if (hqAvatar) scene.remove(hqAvatar);
    hqAvatar = makeAvatar(skinColor(), 0x3fe3ff, curLoadout().primary); hqAvatar.userData.skin = skinColor(); scene.add(hqAvatar);
  } else setAvatarGun(hqAvatar, curLoadout().primary);
  hqAvatar.visible = true;
  const bg = worldGroup.getObjectByName('bench-gun'); if (bg) { const np = makeWeaponModel(curLoadout().primary); np.scale.setScalar(1.6); np.position.copy(bg.position); np.name = 'bench-gun'; worldGroup.remove(bg); worldGroup.add(np); }
  resetAmmo(); player.weapon = availableWeapons()[0]; switchWeapon(0, player.weapon);
  $('hq-hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !IS_TOUCH);
  setNet(netMode); paused = false; hqInRange = false; applyRangeUI();
}
function setNet(n) { netMode = n; LS.set('net', n); document.querySelectorAll('#hq-net button').forEach((b) => b.classList.toggle('sel', b.dataset.net === n)); }
document.querySelectorAll('#hq-net button').forEach((b) => (b.onclick = () => setNet(b.dataset.net)));
$('hq-loadout').onclick = () => openLoadout('hq');
$('hq-exit').onclick = () => { if (hqAvatar) hqAvatar.visible = false; $('hq-hud').classList.add('hidden'); goMenu('hq'); };
function applyRangeUI() {
  $('hud').classList.toggle('hidden', !hqInRange);
  ['btn-fire', 'btn-switch'].forEach((id) => $(id).classList.toggle('hidden', !hqInRange));
  viewGun.visible = hqInRange; if (hqAvatar) hqAvatar.visible = !hqInRange;
  document.querySelector('.hq-title').classList.toggle('hidden', hqInRange); $('hq-help').classList.toggle('hidden', hqInRange);
  if (hqInRange) { $('wave-text').textContent = 'CAMPO DE TIRO'; $('btn-shop').classList.add('hidden'); $('mp-timer').classList.add('hidden'); $('scoreboard').classList.add('hidden'); }
}
function hqInteract() { if (hqNear === 'bench') openLoadout('hq'); }
$('hq-act').addEventListener('pointerdown', (e) => { hqInteract(); e.preventDefault(); });
function showFade(text) { $('fade-text').textContent = text; $('fade').classList.remove('hidden'); }
function hideFade() { $('fade').classList.add('hidden'); }
function launchPortal(m) {
  if (hqFading) return; hqFading = true; input.fire = false;
  showFade('ENTRANDO A ' + MODES[m].name + '…');
  setTimeout(() => { if (hqAvatar) hqAvatar.visible = false; $('hq-hud').classList.add('hidden'); startMode(m, netMode); setTimeout(hideFade, 150); }, 1300);
}
const _tpv = new THREE.Vector3();
function updateHQ(dt) {
  const r = HQ_RANGE, inR = player.pos.x > r.x0 + 0.6 && player.pos.x < r.x1 + 0.4 && player.pos.z > r.z0 + 0.6 && player.pos.z < r.z1 - 0.2;
  if (inR !== hqInRange) { hqInRange = inR; applyRangeUI(); if (inR) banner('CAMPO DE TIRO', 1.2); }
  if (!hqInRange) input.fire = false;
  updatePlayer(dt, hqInRange ? 1 : 0.85);
  if (hqInRange) { tryFire(dt); updateProjectiles(dt); }
  // dummies come back after being knocked down
  for (const e of enemies) if (e.dummy && e.respawnAt && performance.now() > e.respawnAt) { e.respawnAt = 0; e.hp = e.maxHp; e.mesh.visible = true; }
  // third-person camera (over the right shoulder), pulled in when a wall is behind you
  if (!hqInRange && hqAvatar) {
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw), pitch = Math.max(-0.7, Math.min(0.55, player.pitch));
    hqAvatar.position.copy(player.pos); hqAvatar.rotation.y = player.yaw;
    const moving = Math.hypot(input.mx, input.mz) > 0.1 || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => input.keys[k]);
    hqAvatar.userData.walk = (hqAvatar.userData.walk || 0) + (moving ? dt * 11 : 0);
    const sw = moving ? Math.sin(hqAvatar.userData.walk) * 0.6 : 0;
    hqAvatar.getObjectByName('legL').rotation.x = sw; hqAvatar.getObjectByName('legR').rotation.x = -sw;
    const head = new THREE.Vector3(player.pos.x, player.pos.y + 1.65, player.pos.z);
    const right = new THREE.Vector3(cy, 0, -sy);
    const back = new THREE.Vector3(sy * Math.cos(pitch), -Math.sin(pitch), cy * Math.cos(pitch));
    const want = back.clone().multiplyScalar(3.3).addScaledVector(right, 0.65).add(new THREE.Vector3(0, 0.35, 0));
    const len = want.length(), dir = want.clone().normalize();
    const d = Math.max(0.6, Math.min(len, map.rayWallDistance(head, dir, len + 0.3) - 0.25));
    camera.position.copy(head).addScaledVector(dir, d);
    _tpv.set(-sy * Math.cos(pitch), Math.sin(pitch), -cy * Math.cos(pitch)).multiplyScalar(8).add(head).addScaledVector(right, 0.65);
    camera.lookAt(_tpv);
  }
  // interactables
  let near = null, prompt = '';
  if (Math.hypot(player.pos.x - HQ_BENCH.x, player.pos.z - HQ_BENCH.z) < HQ_BENCH.r) { near = 'bench'; prompt = `ARMERÍA · LOADOUT<small>${IS_TOUCH ? 'toca E' : 'pulsa E'} para editar tu clase</small>`; }
  for (const p of HQ_PORTALS) {
    const inX = player.pos.x > p.x0 - 0.2 && player.pos.x < p.x1 + 1.2;
    if (inX && player.pos.z > p.z - 4 && !near) { near = 'portal'; prompt = `${MODES[p.mode].name} · ${netMode === 'online' ? 'ONLINE' : 'VS BOTS'}<small>${MODES[p.mode].desc}</small>`; }
    if (inX && player.pos.z > p.z - 0.15) launchPortal(p.mode);
  }
  { const C = HQ_COLISEO, d = Math.hypot(player.pos.x - C.x, player.pos.z - C.z);
    if (d < C.R + 3 && !near) { near = 'coliseo'; prompt = `🏟 ${MODES.surv.name} · ${netMode === 'online' ? 'CO-OP ONLINE' : 'VS BOTS (con 1 aliado)'}<small>${MODES.surv.desc} Entra al círculo dorado.</small>`; }
    if (d < C.r) launchPortal('surv'); }
  if (!near && hqInRange) prompt = 'Dispara a los blancos<small>prueba tu loadout · ' + (IS_TOUCH ? '⇄ cambia de arma' : 'Q / 1-2 cambia de arma') + '</small>';
  hqNear = near;
  $('hq-prompt').innerHTML = prompt; $('hq-prompt').classList.toggle('hidden', !prompt);
  $('hq-act').classList.toggle('hidden', !(IS_TOUCH && near === 'bench'));
  const t = performance.now() / 1000;
  hqPortalMeshes.forEach((m, i) => (m.material.opacity = 0.4 + Math.sin(t * 3 + i) * 0.15));
  const bg = worldGroup.getObjectByName('bench-gun'); if (bg) bg.rotation.y = t * 0.8;
  const hm = worldGroup.getObjectByName('hq-mono'); if (hm) { const c = Math.abs(Math.sin(t * 5)) * 0.9; hm.getObjectByName('cymL').rotation.y = -c; hm.getObjectByName('cymR').rotation.y = c; }
}

// ================================================================ v2 match client (modes, streaks, grenades, minimap)
// Game modes launched from the HQ portals. VS BOTS runs the same shared simulation as the server (match.js) in the page.
const MODE_MAPS = { tdm: null, ffa: null, dom: null, snd: null, ctf: ['barrio'] };
function modeMapPool(m) { if (m === 'surv') return ['coliseo']; return modeMapPool2(m); }
function modeMapPool2(m) { const all = Object.keys(MAPS); const pref = (MODE_MAPS[m] || []).concat(NEW_MAP_IDS.filter((id) => MAPS[id])); return (m === 'ctf' ? pref : all).filter((id) => MAPS[id]); }
const NEW_MAP_IDS = V2_MAPS;
let lastModeLaunch = null;
function loadoutMsg() { const lo = curLoadout(); return { primary: lo.primary, secondary: lo.secondary, perks: lo.perks, lethal: lo.lethal, tactical: lo.tactical }; }
function startMode(m, net, mapPick) {
  lastModeLaunch = { m, net };
  const pool = modeMapPool(m); const id = mapPick || pool[Math.floor(Math.random() * pool.length)] || 'carriles';
  if (net === 'online') return openOnlineMode(m, id);
  startLocalMatch(m, id);
}
function startLocalMatch(m, id, opts = {}) {
  clearSolo(); online.clearRemotes();
  const deliver = (msg) => online.onMsg(JSON.parse(JSON.stringify(msg)));
  const L = { id: 'local', paid: false, mapId: id, map: createMap(id), size: 8, players: new Map(), votes: new Map(), state: 'waiting' };
  initMatch(L, {
    mode: m, botSkill: 0.5, survStart: opts.survStart || 1,
    bcast: deliver, sendTo: (p, msg) => { if (p.id === 'ME') deliver(msg); },
    onEnd: (L2, res) => {
      const ranked = [...L2.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      deliver({ t: 'end', board: matchBoard(L2), winner: ranked[0] && { id: ranked[0].id, name: ranked[0].name }, payout: { note: 'Partida contra bots · sin SOL en juego.' }, mode: m, winTeam: res.winTeam ?? null, sc: res.sc || null });
    },
  });
  const me = newPlayer(L, { id: 'ME', name: playerName(), conn: { local: true } }); matchLoadout(L, me, loadoutMsg());
  const names = ['Kiwi', 'Turbo', 'Pixel', 'Mango', 'Rayo', 'Coco', 'Nube', 'Chispa'];
  for (let i = 0; i < (m === 'surv' ? 1 : 7); i++) newPlayer(L, { id: 'B' + i, name: 'Bot ' + names[i], bot: true }); // surv: you + 1 ally bot
  online.local = L; online.id = 'ME'; online.localAcc = 0;
  beginMatch(L);
}
async function openOnlineMode(m, id) {
  $('menu').classList.add('hidden'); $('online').classList.remove('hidden'); $('gameover').classList.add('hidden');
  $('online').classList.add('v2mode'); $('online-title').textContent = 'ONLINE · ' + MODES[m].name;
  onlineMsg(''); $('lobby-players').innerHTML = ''; $('online').classList.remove('in-lobby'); $('lobby-vote').classList.add('hidden');
  onlineInfo(MODES[m].desc + ' · Partida gratis, sin SOL en juego. Si no hay más jugadores en 4 s se llena con bots.');
  try { await online.connect(); online.send({ t: 'joinMode', mode: m, map: id, lo: loadoutMsg() }); onlineMsg('Buscando partida…'); }
  catch (e) { onlineInfo('No se pudo conectar al servidor online. Prueba VS BOTS o inténtalo en un minuto.', true); }
}

// ---- kill rewards / medals
let medalQ = [], medalT = 0;
function medal(text, xp = 0) { medalQ.push({ text, xp }); }
function updateMedals(dt) {
  medalT -= dt; const el = $('medal');
  if (medalT <= 0 && medalQ.length) { const m = medalQ.shift(); el.innerHTML = `<b>${m.text}</b>${m.xp ? `<small>+${m.xp} XP</small>` : ''}`; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); medalT = 1.1; if (m.xp) addXp(m.xp, null, true); }
  else if (medalT <= 0) el.classList.remove('on');
}
function killRewards(m) {
  online.streakN = m.streak || (online.streakN || 0) + 1;
  medal(m.head ? 'HEADSHOT' : 'BAJA', m.head ? 150 : 100);
  if (m.first) medal('PRIMERA SANGRE', 100);
  if (m.multi >= 2) medal(['', '', 'DOBLE BAJA', 'TRIPLE BAJA', 'CUÁDRUPLE BAJA'][Math.min(4, m.multi)] || 'MULTIBAJA', 100 * m.multi);
  if (m.streak && m.streak % 5 === 0) medal('RACHA x' + m.streak, 150);
  const r = online.remotes.get(m.victim);
  if (r && WEAPONS[m.w]?.cls === 'sniper' && r.mesh.position.distanceTo(player.pos) > 35) medal('TIRO LARGO', 100);
}

// ---- scorestreaks
const STREAK_ICON = { uav: '📡', air: '✈', heli: '🚁' };
function streakReady(id) {
  online.ready.add(id); renderStreakPrompt();
  const s = STREAKS.find((x) => x.id === id);
  banner(`${s.name} LISTO · ${IS_TOUCH ? 'TOCA ' + STREAK_ICON[id] : 'PULSA ' + s.key.replace('Digit', '')}`, 2.2);
}
function renderStreakPrompt() {
  const el = $('streaks'); if (!el) return;
  el.innerHTML = STREAKS.map((s) => `<button class="stk ${online.ready?.has(s.id) ? 'ready' : ''}" data-id="${s.id}"><i>${STREAK_ICON[s.id]}</i><span>${s.kills}</span><small>${s.key.replace('Digit', '')}</small></button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); useStreakNow(b.dataset.id); }));
}
function useStreakNow(id) {
  if (!online.inMatch || online.legacy || !online.ready?.has(id) || !player.alive) return;
  const msg = { t: 'streak', id };
  if (id === 'air') { // target: where the crosshair meets the ground (or 30 m ahead)
    const eye = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z), d = aimDir(0);
    let dist = 30; if (d.y < -0.02) dist = Math.min(60, (eye.y) / -d.y); dist = Math.min(dist, map.rayWallDistance(eye, d, dist));
    const p = eye.addScaledVector(d, dist); msg.x = +p.x.toFixed(1); msg.z = +p.z.toFixed(1);
  }
  online.send(msg); online.ready.delete(id); renderStreakPrompt();
}
const matchFx = new THREE.Group(); scene.add(matchFx);
let shake = 0;
const heliMeshes = [];
function voxBox(w, h, d, color, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); return m; }
function makeHeli(team) {
  const g = new THREE.Group(), c = team === online.myTeam && online.teamMode ? 0x2f6fd8 : 0x8a2a2a;
  g.add(voxBox(1.6, 1.2, 3.0, c), voxBox(1.4, 0.7, 1.0, 0x9fe8ff, 0, 0.1, -1.6), voxBox(0.4, 0.4, 3.0, c, 0, 0.2, 2.8), voxBox(0.15, 1.0, 0.6, c, 0.2, 0.6, 4.2));
  const skid = voxBox(0.12, 0.12, 2.8, 0x333333, 0.7, -0.85, 0); g.add(skid, skid.clone().translateX(-1.4));
  const rotor = new THREE.Group(); rotor.add(voxBox(6.5, 0.06, 0.3, 0x222222), voxBox(0.3, 0.06, 6.5, 0x222222)); rotor.position.y = 0.85; rotor.name = 'rotor'; g.add(rotor);
  const gun = voxBox(0.2, 0.2, 0.9, 0x222222, 0, -0.6, -1.6); g.add(gun);
  return g;
}
function syncHelis(list) {
  while (heliMeshes.length > list.length) matchFx.remove(heliMeshes.pop());
  list.forEach((h, i) => {
    if (!heliMeshes[i]) { heliMeshes[i] = makeHeli(h[4]); matchFx.add(heliMeshes[i]); heliMeshes[i].position.set(h[0], h[1], h[2]); }
    heliMeshes[i].userData.tgt = new THREE.Vector3(h[0], h[1], h[2]); heliMeshes[i].userData.ang = h[3];
  });
}
const planes = [], nades = [];
function onStreak(m) {
  const mine = m.by === online.id, friendly = mine || (online.teamMode && m.team === online.myTeam);
  const who = mine ? '' : online.name(m.by) + ': ';
  if (m.id === 'uav') banner(friendly ? `📡 ${who}UAV ACTIVO` : '📡 UAV ENEMIGO EN EL AIRE', 2);
  if (m.id === 'heli') banner(friendly ? `🚁 ${who}HELICÓPTERO EN CAMINO` : '🚁 ¡HELICÓPTERO ENEMIGO!', 2);
  if (m.id === 'air') {
    banner(friendly ? `✈ ${who}BOMBARDEO EN CAMINO` : '✈ ¡BOMBARDEO ENEMIGO! ¡A CUBIERTO!', 2.2);
    const a = m.pts[0], b = m.pts[m.pts.length - 1], dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const pl = new THREE.Group(); const c = friendly ? 0x5f8fd0 : 0xb04040;
    pl.add(voxBox(0.9, 0.7, 5, c), voxBox(7, 0.15, 1.4, c, 0, 0, 0.3), voxBox(2.4, 0.12, 0.8, c, 0, 0.1, 2.2), voxBox(0.12, 1.1, 0.9, c, 0, 0.6, 2.2), voxBox(0.7, 0.4, 0.9, 0x9fe8ff, 0, 0.35, -1.6));
    pl.lookAt(dir); pl.rotateY(Math.PI);
    const mid = new THREE.Vector3((a.x + b.x) / 2, 16, (a.z + b.z) / 2);
    pl.userData = { from: mid.clone().addScaledVector(dir, -60), to: mid.clone().addScaledVector(dir, 60), t0: Date.now() + 1200, dur: 2600, pts: m.pts.map((p, k) => ({ ...p, at: m.at + k * 140 })) };
    planes.push(pl); matchFx.add(pl); pl.position.copy(pl.userData.from);
  }
}
function onNade(m) {
  if (m.kind === 'mono') {
    const g = makeMonoBomba(); g.scale.setScalar(1.3); g.position.set(m.o.x, m.o.y, m.o.z); matchFx.add(g);
    const light = new THREE.PointLight(0xff2a2a, 2, 9); light.position.y = 0.9; g.add(light);
    SV.monos.push({ g, light, o: m.o, e: m.e, t0: Date.now(), land: m.land, at: m.at });
    if (m.by === online.id) banner('🐒 ¡MONO BOMBA! los zombis van tras ella', 1.6);
    return;
  }
  const g = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: m.kind === 'frag' ? 0x3a5a2a : 0xdddddd }));
  matchFx.add(g); nades.push({ mesh: g, o: m.o, e: m.e, t0: Date.now(), at: m.at, kind: m.kind });
}
function flashOverlay(dur) { const el = $('flash-ov'); el.style.transition = 'none'; el.style.opacity = 1; void el.offsetWidth; el.style.transition = `opacity ${dur.toFixed(2)}s ease-in`; el.style.opacity = 0; }
function updateMatchFx(dt) {
  const now = Date.now();
  heliMeshes.forEach((h) => { if (h.userData.tgt) h.position.lerp(h.userData.tgt, Math.min(1, dt * 8)); h.rotation.y = -(h.userData.ang || 0); const r = h.getObjectByName('rotor'); if (r) r.rotation.y += dt * 30; });
  for (let i = planes.length - 1; i >= 0; i--) {
    const pl = planes[i], u = pl.userData, k = (now - u.t0) / u.dur;
    pl.position.lerpVectors(u.from, u.to, Math.max(0, Math.min(1, k)));
    for (const p of u.pts) if (!p.done && now >= p.at) { p.done = true; explosion(new THREE.Vector3(p.x, 0.4, p.z), 4.2, 0xffa23d); shake = Math.max(shake, 0.25 * Math.max(0, 1 - player.pos.distanceTo(new THREE.Vector3(p.x, 0, p.z)) / 20)); }
    if (k > 1.2 && u.pts.every((p) => p.done)) { matchFx.remove(pl); planes.splice(i, 1); }
  }
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i], T = Math.max(0.3, (n.at - n.t0) / 1000), k = Math.min(1, (now - n.t0) / 1000 / Math.min(T, 0.9));
    n.mesh.position.set(n.o.x + (n.e.x - n.o.x) * k, n.o.y + (n.e.y - n.o.y) * k + Math.sin(k * Math.PI) * 1.6, n.o.z + (n.e.z - n.o.z) * k);
    if (now >= n.at) {
      matchFx.remove(n.mesh); nades.splice(i, 1);
      const p = new THREE.Vector3(n.e.x, n.e.y + 0.3, n.e.z);
      if (n.kind === 'frag') explosion(p, 4.2, 0xffa23d); else explosion(p, 2.5, 0xffffff);
    }
  }
}
function clearMatchFx() {
  while (matchFx.children.length) matchFx.remove(matchFx.children[0]);
  heliMeshes.length = 0; planes.length = 0; nades.length = 0; objMeshes.clear();
  online.uav = []; online.obj = null; clearSurv();
}
function throwNade(kind) {
  if (!online.inMatch || online.legacy || !player.alive) return;
  const eye = { x: +player.pos.x.toFixed(2), y: +(player.pos.y + 1.5).toFixed(2), z: +player.pos.z.toFixed(2) }, d = aimDir(0);
  online.send({ t: 'nade', kind, o: eye, d: { x: +d.x.toFixed(3), y: +d.y.toFixed(3), z: +d.z.toFixed(3) } });
}

// ---- objectives (Domination flags, CTF flags, S&D sites) rendered in the world
const objMeshes = new Map();
const TEAM_COL = [0x3fe3ff, 0xff3df2];
function objColor(team) { if (team < 0 || team === undefined || team === null) return 0xdddddd; return online.teamMode && team === online.myTeam ? 0x3f8cff : 0xff4a3d; }
function flagMesh(label) {
  const g = new THREE.Group();
  g.add(voxBox(0.12, 3.2, 0.12, 0xcccccc, 0, 1.6, 0));
  const cloth = voxBox(1.1, 0.7, 0.06, 0xffffff, 0.6, 2.8, 0); cloth.name = 'cloth'; g.add(cloth);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.name = 'ring'; g.add(ring);
  if (label) { const s = makeLabel(label, '#ffffff', 128); s.scale.multiplyScalar(0.8); s.position.y = 4; s.name = 'lbl'; g.add(s); }
  return g;
}
function getObj(key, make) { let m = objMeshes.get(key); if (!m) { m = make(); objMeshes.set(key, m); matchFx.add(m); } return m; }
function setCol(g, col) { g.traverse((o) => { if ((o.name === 'cloth' || o.name === 'ring') && o.material) o.material.color.setHex(col); }); }
function syncObjectives(o) {
  if (!o) return;
  const y = (x, z) => { const i = Math.floor(x), j = Math.floor(z); return map.heights[i + j * map.w] || 0; };
  if (o.f) for (const [id, x, z, owner] of o.f) { const g = getObj('f' + id, () => flagMesh(id)); g.position.set(x, y(x, z), z); setCol(g, objColor(owner)); }
  if (o.c) for (const [team, x, z, carrier, hx, hz] of o.c) {
    const g = getObj('c' + team, () => flagMesh(null)); setCol(g, objColor(team));
    if (carrier) { const r = carrier === online.id ? null : online.remotes.get(carrier); g.visible = carrier !== online.id; if (r) g.position.copy(r.mesh.position).add(new THREE.Vector3(0, 0.6, 0)); g.getObjectByName('ring').visible = false; }
    else { g.visible = true; g.position.set(x, y(x, z), z); g.getObjectByName('ring').visible = true; }
    const base = getObj('cb' + team, () => { const m = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.6, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; return m; });
    base.material.color.setHex(objColor(team)); base.position.set(hx, y(hx, hz) + 0.06, hz);
  }
  if (o.s) {
    for (const [id, x, z] of o.s) { const g = getObj('s' + id, () => { const g2 = flagMesh(id); g2.getObjectByName('cloth').visible = false; g2.add(voxBox(1.2, 0.8, 1.2, 0x555555, 0, 0.4, 0)); return g2; }); g.position.set(x, y(x, z), z); setCol(g, 0xffa23d); }
    const bomb = getObj('bomb', () => { const g2 = new THREE.Group(); g2.add(voxBox(0.6, 0.3, 0.4, 0x333333, 0, 0.15, 0), voxBox(0.2, 0.05, 0.2, 0xff2222, 0, 0.32, 0)); return g2; });
    bomb.visible = !!o.b; if (o.b) bomb.position.set(o.b[0], y(o.b[0], o.b[1]), o.b[1]);
  }
}
function onObjEvent(m) {
  if (m.ev === 'wave' || m.ev === 'waveClear') return survEvent(m);
  const mine = (t) => online.teamMode && t === online.myTeam;
  if (m.ev === 'cap') banner(`BANDERA ${m.flag} ${mine(m.team) ? 'CAPTURADA' : 'PERDIDA'}`, 1.4);
  if (m.ev === 'take') banner(mine(m.team) ? '¡TIENEN NUESTRA BANDERA!' : (m.by === online.id ? '¡TIENES LA BANDERA! VUELVE A TU BASE' : '¡TOMAMOS SU BANDERA!'), 1.8);
  if (m.ev === 'drop') banner(mine(m.team) ? 'NUESTRA BANDERA CAYÓ' : 'BANDERA ENEMIGA CAÍDA', 1.4);
  if (m.ev === 'return') banner(mine(m.team) ? 'BANDERA RECUPERADA' : 'BANDERA ENEMIGA DEVUELTA', 1.4);
  if (m.ev === 'capture') banner(mine(m.team) ? '¡CAPTURA!' : 'EL ENEMIGO CAPTURÓ', 2);
  if (m.ev === 'plant') banner(online.myTeam === 0 ? '💣 BOMBA PLANTADA EN ' + m.site : '💣 ¡BOMBA PLANTADA EN ' + m.site + '! DESACTÍVALA', 2.2);
  if (m.ev === 'defuse') banner('BOMBA DESACTIVADA', 2);
  if (m.ev === 'boom') { explosion(new THREE.Vector3(m.x, 0.5, m.z), 9, 0xffa23d); shake = 0.6; }
  if (m.ev === 'round') banner(`RONDA ${m.round}: ${m.winner === online.myTeam ? 'GANADA' : 'PERDIDA'} · ${m.wins.join(' - ')}`, 3);
  if (m.ev === 'newround') { banner('RONDA ' + m.round + (online.myTeam === 0 ? ' · ATACA: PLANTA EN A o B' : ' · DEFIENDE A y B'), 2.5); player.alive = true; player.hp = 100; resetAmmo(); }
}

// ---- minimap (top-left) with UAV pings
let mmBase = null;
function buildMinimap() {
  const c = document.createElement('canvas'), W = map.w, Lh = map.l; c.width = W * 4; c.height = Lh * 4; const g = c.getContext('2d');
  for (let i = 0; i < W; i++) for (let j = 0; j < Lh; j++) {
    const k = map.kind[i + j * W], h = map.heights[i + j * W];
    g.fillStyle = h >= 3.5 ? '#c9d6e6' : h > 0.3 ? `rgba(160,180,205,${0.35 + h / 8})` : k === 5 ? '#2a6fa8' : '#25313f';
    g.fillRect(i * 4, j * 4, 4, 4);
  }
  mmBase = c;
}
function drawMinimap() {
  const cv = $('minimap'); if (!cv || !mmBase) return;
  const g = cv.getContext('2d'), S = cv.width, R = 22, sc = S / (R * 2); // ~22 m radius around the player, rotated with view
  g.save(); g.clearRect(0, 0, S, S); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 7); g.clip();
  g.fillStyle = '#111a24'; g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2); g.rotate(player.yaw); g.scale(sc, sc); g.translate(-player.pos.x, -player.pos.z);
  g.globalAlpha = 0.9; g.drawImage(mmBase, 0, 0, map.w, map.l); g.globalAlpha = 1;
  const dot = (x, z, col, r = 0.9) => { g.fillStyle = col; g.beginPath(); g.arc(x, z, r, 0, 7); g.fill(); };
  const o = online.obj;
  if (o?.f) for (const [id, x, z, owner] of o.f) { dot(x, z, '#' + objColor(owner).toString(16).padStart(6, '0'), 1.5); }
  if (o?.c) for (const [team, x, z] of o.c) dot(x, z, '#' + objColor(team).toString(16).padStart(6, '0'), 1.4);
  if (o?.s) for (const [, x, z] of o.s) dot(x, z, '#ffa23d', 1.4);
  const myUav = (online.uav || []).some((u) => online.teamMode ? u[0] === online.myTeam : u[1] === online.id);
  const now = performance.now();
  online.remotes.forEach((r) => {
    if (!r.alive) return;
    const mate = online.teamMode && r.tm === online.myTeam;
    if (mate) return dot(r.mesh.position.x, r.mesh.position.z, '#3f8cff', 0.9);
    if (r.zombie) return dot(r.mesh.position.x, r.mesh.position.z, r.zombie === 'boss' ? '#ff00ff' : '#ff3b3b', r.zombie === 'boss' ? 1.6 : 0.8);
    if ((myUav && !r.ghost) || r.pingUntil > now) dot(r.mesh.position.x, r.mesh.position.z, '#ff3b3b', 0.9);
  });
  heliMeshes.forEach((h) => dot(h.position.x, h.position.z, '#ffd84d', 1.3));
  g.restore();
  // me: arrow in the center
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(S / 2, S / 2 - 7); g.lineTo(S / 2 + 5, S / 2 + 5); g.lineTo(S / 2, S / 2 + 2); g.lineTo(S / 2 - 5, S / 2 + 5); g.fill();
}

// ---- v2 match HUD (score, timer, objective strip)
function updateV2Hud(dt) {
  updateMedals(dt); updateMatchFx(dt); updateSurv(dt);
  if (!online.inMatch || online.legacy) return;
  drawMinimap();
  const left = Math.max(0, online.endsAt - Date.now()) / 1000;
  let tLeft = left; const o = online.obj;
  if (online.mode === 'snd' && o?.t !== undefined) tLeft = o.b ? o.b[2] : o.t;
  $('mh-time').textContent = `${Math.floor(tLeft / 60)}:${String(Math.floor(tLeft % 60)).padStart(2, '0')}`;
  const lim = online.scoreLimit, sc = online.sc || [0, 0];
  if (online.teamMode) {
    const mine = sc[online.myTeam] || 0, theirs = sc[1 - online.myTeam] || 0;
    $('mh-us').textContent = mine; $('mh-them').textContent = theirs;
    $('mh-us-bar').style.width = Math.min(100, (mine / lim) * 100) + '%'; $('mh-them-bar').style.width = Math.min(100, (theirs / lim) * 100) + '%';
  } else {
    const b = [...(online.board || [])].sort((a, c) => c.kills - a.kills), me = b.find((x) => x.id === online.id), top = b.find((x) => x.id !== online.id);
    $('mh-us').textContent = me?.kills || 0; $('mh-them').textContent = top?.kills || 0;
    $('mh-us-bar').style.width = Math.min(100, ((me?.kills || 0) / lim) * 100) + '%'; $('mh-them-bar').style.width = Math.min(100, ((top?.kills || 0) / lim) * 100) + '%';
  }
  let strip = '';
  if (o?.f) strip = o.f.map(([id, , , owner, prog]) => `<span class="of" style="--c:#${objColor(owner).toString(16).padStart(6, '0')}">${id}</span>`).join('');
  if (o?.c) strip = o.c.map(([team, , , carrier]) => `<span class="of" style="--c:#${objColor(team).toString(16).padStart(6, '0')}">⚑${carrier ? '!' : ''}</span>`).join('');
  if (o?.s) strip = `<span class="of" style="--c:#ffa23d">R${o.r} · ${o.w.join('-')}</span>` + (o.b ? `<span class="of bomb">💣 ${o.b[2]}s</span>` : '') + (o.pl > 0 ? `<span class="of">PLANTANDO ${Math.round(o.pl * 100)}%</span>` : '') + (o.df > 0 ? `<span class="of">DESACTIVANDO ${Math.round(o.df * 100)}%</span>` : '');
  $('mh-obj').innerHTML = strip;
  drawObjMarks(o);
  // local host: advance the shared simulation at 20 Hz
}
// on-screen objective markers (letter + distance), clamped to the screen edge
const _om = new THREE.Vector3();
function drawObjMarks(o) {
  const el = $('objmarks'); const items = [];
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  if (o?.f) for (const [id, x, z, owner, prog] of o.f) items.push({ x, z, t: id, c: hex(objColor(owner)), p: prog });
  if (o?.c) for (const [team, x, z, carrier] of o.c) { if (carrier === online.id) continue; const r = carrier && online.remotes.get(carrier); items.push({ x: r ? r.mesh.position.x : x, z: r ? r.mesh.position.z : z, t: '⚑', c: hex(objColor(team)) }); }
  if (o?.bx) items.push({ x: o.bx[0], z: o.bx[1], t: '?', c: '#ffd84d' });
  if (o?.s) { if (o.b) items.push({ x: o.b[0], z: o.b[1], t: '💣', c: '#ff3b3b' }); else for (const [id, x, z] of o.s) items.push({ x, z, t: id, c: '#ffa23d' }); }
  let h = '';
  const W = innerWidth, H = innerHeight;
  for (const it of items) {
    _om.set(it.x, (map.heights[Math.floor(it.x) + Math.floor(it.z) * map.w] || 0) + 2.6, it.z).project(camera);
    let sx = (_om.x + 1) / 2 * W, sy = (1 - _om.y) / 2 * H; const behind = _om.z > 1;
    if (behind) { sx = W - sx; sy = H - 40; }
    sx = Math.max(24, Math.min(W - 24, sx)); sy = Math.max(30, Math.min(H - 40, sy));
    const d = Math.round(Math.hypot(it.x - player.pos.x, it.z - player.pos.z));
    h += `<div class="om" style="left:${sx}px;top:${sy}px;--c:${it.c}"><b>${it.t}</b><small>${d}m</small></div>`;
  }
  el.innerHTML = h;
}
function tickLocal(dt) {
  if (!online.local) return;
  online.localAcc += dt;
  let n = 0; while (online.localAcc >= 0.05 && n++ < 4) { online.localAcc -= 0.05; tickMatch(online.local, 0.05); }
  if (online.localAcc > 0.2) online.localAcc = 0;
}

// ================================================================ Survive the 150 (client): zombies, box, pickups, Mono Bomba
const SV = { box: null, boxSpin: null, pickups: new Map(), corpses: [], monos: [], myPts: 0, prompt: null, bossId: null };
function vb(g, w, h, d, color, x, y, z, name, basic) { // voxel box helper
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); if (name) m.name = name; g.add(m); return m;
}
// Original voxel zombies: hunched, arms forward, glowing eyes; look depends on the type.
const ZLOOK = {
  walker: { skin: 0x7fb04f, shirt: 0x6b4a2e, pants: 0x2f4a6b, eyes: 0xffe14d },
  runner: { skin: 0x9ccc5a, shirt: 0xa83a2a, pants: 0x3a3a3a, eyes: 0xff6a2a },
  brute: { skin: 0x5f8a3e, shirt: 0x55585e, pants: 0x2a2a2e, eyes: 0xffe14d },
  boss: { skin: 0x6a9a40, shirt: 0x8a5a24, pants: 0x4a2a14, eyes: 0xff2a2a },
};
function makeZombie(type) {
  const L2 = ZLOOK[type] || ZLOOK.walker, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const legL = vb(g, 0.24, 0.62, 0.24, L2.pants, -0.14, 0.31, 0, 'legL'), legR = vb(g, 0.24, 0.62, 0.24, L2.pants, 0.14, 0.31, 0, 'legR');
  body.position.y = 0.62; body.rotation.x = 0.18;                                    // hunched
  vb(body, 0.58, 0.7, 0.34, L2.shirt, 0, 0.36, 0);
  vb(body, 0.2, 0.14, 0.36, L2.skin, 0.12, 0.12, 0.0);                               // torn shirt (skin showing)
  vb(body, 0.46, 0.46, 0.46, L2.skin, 0, 0.95, -0.04, 'zhead');
  vb(body, 0.1, 0.07, 0.04, L2.eyes, -0.11, 1.0, -0.28, null, true); vb(body, 0.1, 0.07, 0.04, L2.eyes, 0.11, 1.0, -0.28, null, true);
  vb(body, 0.2, 0.06, 0.04, 0x2a1a10, 0, 0.82, -0.28);                               // mouth
  const armL = vb(body, 0.18, 0.18, 0.62, L2.skin, -0.39, 0.58, -0.3, 'armL'), armR = vb(body, 0.18, 0.18, 0.62, L2.skin, 0.39, 0.58, -0.3, 'armR');
  if (type === 'brute') { vb(body, 0.8, 0.2, 0.4, 0x3a3d42, 0, 0.72, 0); }            // shoulder pads
  if (type === 'boss') { // original "gladiator" zombie: bronze helmet with a crest, shoulder plate, belt
    vb(body, 0.52, 0.2, 0.52, 0xb08a3a, 0, 1.2, -0.04); vb(body, 0.08, 0.26, 0.5, 0xc0392b, 0, 1.4, -0.04);
    vb(body, 0.3, 0.16, 0.4, 0xb08a3a, -0.36, 0.72, 0); vb(body, 0.62, 0.1, 0.36, 0x6a4a1e, 0, 0.06, 0);
  }
  g.scale.setScalar(ZTYPES[type]?.scale || 1);
  g.userData.zombie = type; armL.userData.base = armL.rotation.x; armR.userData.base = armR.rotation.x;
  return g;
}
// Mono Bomba: an original wind-up toy monkey with brass cymbals, red eyes, a little hat and a striped vest.
function makeMonoBomba() {
  const g = new THREE.Group(), fur = 0x7a4a26, face = 0xe0b48a;
  vb(g, 0.34, 0.3, 0.26, fur, 0, 0.15, 0);                                            // legs/seat
  for (let i = 0; i < 4; i++) vb(g, 0.36, 0.08, 0.28, i % 2 ? 0xf2efe6 : 0x3f6fb5, 0, 0.36 + i * 0.08, 0); // striped vest
  vb(g, 0.36, 0.32, 0.3, fur, 0, 0.82, 0);                                            // head
  vb(g, 0.26, 0.18, 0.06, face, 0, 0.78, -0.16);                                      // muzzle
  vb(g, 0.16, 0.04, 0.02, 0xffffff, 0, 0.73, -0.2, null, true);                       // big toothy grin
  vb(g, 0.07, 0.07, 0.03, 0xff2020, -0.08, 0.9, -0.16, 'eyeL', true); vb(g, 0.07, 0.07, 0.03, 0xff2020, 0.08, 0.9, -0.16, 'eyeR', true);
  vb(g, 0.08, 0.12, 0.06, face, -0.22, 0.86, 0); vb(g, 0.08, 0.12, 0.06, face, 0.22, 0.86, 0); // ears
  vb(g, 0.2, 0.12, 0.2, 0x2e5a3a, 0, 1.04, 0); vb(g, 0.04, 0.08, 0.04, 0xffd84d, 0.08, 1.12, 0); // little hat + tassel
  vb(g, 0.06, 0.1, 0.06, 0xc0c0c0, 0, 0.5, 0.17);                                     // wind-up key
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.22, 0.56, -0.04); arm.name = s < 0 ? 'cymL' : 'cymR'; g.add(arm);
    vb(arm, 0.08, 0.08, 0.2, fur, 0, 0, -0.08);
    const cym = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 12), new THREE.MeshLambertMaterial({ color: 0xd8a83a, emissive: 0x3a2a08 }));
    cym.rotation.z = Math.PI / 2; cym.position.set(-s * 0.06, 0, -0.18); arm.add(cym);
  }
  return g;
}
let audioCtx = null;
function clang(vol = 0.25) { // metallic cymbal clash, synthesized (no audio files)
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime, out = audioCtx.createGain(); out.gain.setValueAtTime(vol, t); out.gain.exponentialRampToValueAtTime(0.001, t + 0.35); out.connect(audioCtx.destination);
    for (const f of [523, 787, 1131, 1593]) { const o = audioCtx.createOscillator(); o.type = 'square'; o.frequency.value = f * (0.98 + Math.random() * 0.04); o.connect(out); o.start(t); o.stop(t + 0.36); }
  } catch (_) {}
}
function survActive() { return mode === 'online' && online.mode === 'surv' && online.inMatch; }
function syncSurvObj(o) {
  if (!o?.sv) return;
  online.sv = o.sv;
  // mystery box (chest with a glowing ? and its price)
  if (!SV.box && o.bx) {
    const g = new THREE.Group(), y = map.heightAt(o.bx[0], o.bx[1]);
    vb(g, 1.7, 0.55, 0.8, 0x6a4422, 0, 0.27, 0); vb(g, 1.74, 0.12, 0.84, 0xd8a83a, 0, 0.56, 0); vb(g, 1.7, 0.22, 0.8, 0x7a5028, 0, 0.73, 0, 'lid');
    vb(g, 0.2, 0.2, 0.06, 0xffd84d, 0, 0.4, -0.42, null, true);
    const q = makeLabel('?', '#ffd84d', 128); q.scale.multiplyScalar(0.9); q.position.y = 1.6; q.name = 'q'; g.add(q);
    const lbl = makeLabel('CAJA MISTERIOSA · ' + o.bx[2], '#ffd84d', 380); lbl.scale.multiplyScalar(0.7); lbl.position.y = 2.3; g.add(lbl);
    const light = new THREE.PointLight(0xffd84d, 1.2, 6); light.position.y = 1.2; g.add(light);
    g.position.set(o.bx[0], y, o.bx[1]); matchFx.add(g); SV.box = g;
  }
  // weapon pickups lying around the arena
  const seen = new Set();
  for (const [id, x, z, w] of o.pk || []) {
    seen.add(id); let k = SV.pickups.get(id);
    if (k && k.w !== w) { matchFx.remove(k.g); k = null; }
    if (!k) {
      const g = new THREE.Group(), m = makeWeaponModel(WEAPONS[w].id); const s = 1.4; m.scale.setScalar(s); m.position.y = 0.7; m.name = 'gun'; g.add(m);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 20), new THREE.MeshBasicMaterial({ color: WEAPONS[w].color || 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
      g.position.set(x, map.heightAt(x, z), z); matchFx.add(g); k = { g, w, x, z }; SV.pickups.set(id, k);
    }
  }
  for (const [id, k] of SV.pickups) if (!seen.has(id)) { matchFx.remove(k.g); SV.pickups.delete(id); }
}
function onBoxOpen(m) {
  if (!SV.box) return;
  const mine = m.by === online.id;
  SV.boxSpin = { until: m.at, w: m.w, mine, t: 0, model: null };
  const lid = SV.box.getObjectByName('lid'); if (lid) { lid.position.set(0, 0.95, 0.3); lid.rotation.x = -1.0; }
  if (!mine) banner(online.name(m.by) + ' abre la caja', 1.2);
}
function boxModel(w) { if (w < 0) { const g = makeMonoBomba(); g.scale.setScalar(0.9); return g; } const g = makeWeaponModel(WEAPONS[w].id); g.scale.setScalar(1.5); return g; }
function updateSurv(dt) {
  if (!survActive()) return;
  const now = Date.now(), t = performance.now() / 1000;
  if (SV.box) { const q = SV.box.getObjectByName('q'); if (q) q.position.y = 1.6 + Math.sin(t * 3) * 0.1; }
  SV.pickups.forEach((k) => { const g = k.g.getObjectByName('gun'); if (g) { g.rotation.y = t * 1.5; g.position.y = 0.7 + Math.sin(t * 2.5 + k.x) * 0.08; } });
  // box roulette: cycle random models above the chest, then show the prize
  if (SV.boxSpin && SV.box) {
    const b = SV.boxSpin; b.t += dt;
    const done = now >= b.until, pick = done ? b.w : (Math.floor(b.t * 8) % 7 === 6 ? -1 : (Math.floor(b.t * 8) * 7) % WEAPONS.length);
    if (b.shown !== pick) { if (b.model) SV.box.remove(b.model); b.model = boxModel(pick); b.model.position.y = 1.3 + Math.min(1, b.t) * 0.5; SV.box.add(b.model); b.shown = pick; }
    b.model.rotation.y = t * 2;
    if (now > b.until + 1500) { SV.box.remove(b.model); const lid = SV.box.getObjectByName('lid'); if (lid) { lid.position.set(0, 0.73, 0); lid.rotation.x = 0; } SV.boxSpin = null; }
  }
  // zombie arms sway + corpses fall over
  online.remotes.forEach((r) => { if (!r.zombie) return; const a = Math.sin(t * 6 + r.phase) * 0.15; const al = r.mesh.getObjectByName('armL'), ar = r.mesh.getObjectByName('armR'); if (al) al.rotation.x = a; if (ar) ar.rotation.x = -a; });
  for (let i = SV.corpses.length - 1; i >= 0; i--) {
    const c = SV.corpses[i]; c.t += dt; c.mesh.rotation.x = Math.min(Math.PI / 2, c.t * 4); c.mesh.position.y -= c.t > 0.6 ? dt * 0.8 : 0;
    if (c.t > 1.6) { scene.remove(c.mesh); SV.corpses.splice(i, 1); }
  }
  // Mono Bomba: clap the cymbals, flash the eyes + light, clang
  for (let i = SV.monos.length - 1; i >= 0; i--) {
    const mo = SV.monos[i], g = mo.g;
    if (now < mo.land) { const k = 1 - (mo.land - now) / (mo.land - mo.t0); g.position.set(mo.o.x + (mo.e.x - mo.o.x) * k, mo.o.y + (mo.e.y - mo.o.y) * k + Math.sin(k * Math.PI) * 1.5, mo.o.z + (mo.e.z - mo.o.z) * k); g.rotation.x += dt * 10; continue; }
    g.position.set(mo.e.x, mo.e.y - 0.08, mo.e.z); g.rotation.x = 0; g.rotation.y = Math.atan2(-(mo.o.x - mo.e.x), -(mo.o.z - mo.e.z)) + Math.sin(t * 11) * 0.12; // faces the thrower, wobbles
    const clap = Math.abs(Math.sin(t * 11)); const cl = g.getObjectByName('cymL'), cr = g.getObjectByName('cymR');
    if (cl) cl.rotation.y = -clap * 0.9; if (cr) cr.rotation.y = clap * 0.9;
    const on = Math.sin(t * 22) > 0; mo.light.intensity = on ? 3 : 0.6; mo.light.color.setHex(on ? 0xff2a2a : 0xffd84d);
    if (t - (mo.lastClang || 0) > 0.28) { mo.lastClang = t; const d = player.pos.distanceTo(g.position); clang(0.3 * Math.max(0.08, 1 - d / 40)); }
    if (now >= mo.at) { explosion(new THREE.Vector3(mo.e.x, mo.e.y + 0.4, mo.e.z), MONO.radius, 0xffa23d); shake = Math.max(shake, 0.4); matchFx.remove(g); SV.monos.splice(i, 1); }
  }
  // interact prompt: mystery box / pickups
  let pr = null;
  if (player.alive && online.sv) {
    const bx = SV.box?.position;
    if (bx && Math.hypot(player.pos.x - bx.x, player.pos.z - bx.z) < 2.4) pr = { kind: 'box', text: `CAJA MISTERIOSA · ${SURV.boxCost} pts<small>${SV.myPts >= SURV.boxCost ? 'arma al azar (¡o la Mono Bomba!)' : 'te faltan ' + (SURV.boxCost - SV.myPts) + ' pts'}</small>` };
    else for (const [id, k] of SV.pickups) if (Math.hypot(player.pos.x - k.x, player.pos.z - k.z) < 1.8) { pr = { kind: 'pick', id, text: `TOMAR ${WEAPONS[k.w].name.toUpperCase()}<small>${CLASS_NAMES[WEAPONS[k.w].cls] || ''}</small>` }; break; }
  }
  SV.prompt = pr;
  $('use-prompt').innerHTML = pr ? pr.text + `<small>${IS_TOUCH ? 'toca ✋' : 'pulsa E'}</small>` : ''; $('use-prompt').classList.toggle('hidden', !pr);
  $('btn-use').classList.toggle('hidden', !(pr && IS_TOUCH));
  // HUD: wave / zombies / points / boss
  const sv = online.sv;
  if (sv) {
    $('sv-wave').textContent = `OLEADA ${sv[0]} / ${SURV.waves}`;
    $('sv-sub').textContent = sv[1] === 'break' ? (sv[0] ? `¡SUPERADA! SIGUIENTE EN ${sv[3]}s` : `EMPIEZA EN ${sv[3]}s`) : `ZOMBIS: ${sv[2]}`;
  }
  $('sv-pts').textContent = '💰 ' + SV.myPts;
  const mono = online.survLo?.mono || 0; $('btn-mono').classList.toggle('hidden', !mono); $('btn-mono').dataset.n = mono;
  let boss = null; online.remotes.forEach((r) => { if (r.zombie === 'boss' && r.alive) boss = r; });
  $('boss-bar').classList.toggle('hidden', !boss); if (boss) $('boss-fill').style.width = Math.max(0, (boss.hp / boss.mh) * 100) + '%';
}
function survInteract() {
  const pr = SV.prompt; if (!pr || !survActive()) return;
  if (pr.kind === 'box') online.send({ t: 'box' }); else online.send({ t: 'pick', id: pr.id });
}
function throwMono() { if (survActive() && (online.survLo?.mono || 0) > 0) { throwNade('mono'); online.survLo.mono--; } }
function onSurvLo(m) {
  const had = online.survLo; online.survLo = { primary: m.primary, secondary: m.secondary, mono: m.mono, frag: m.frag };
  const list = availableWeapons();
  if (!list.includes(player.weapon)) { player.weapon = list[0]; switchWeapon(0, player.weapon); }
  else if (had && had.primary !== m.primary && m.primary === list[0]) switchWeapon(0, m.primary);
  else if (had && had.secondary !== m.secondary) switchWeapon(0, m.secondary);
}
function onBoxGot(m) {
  if (m.w < 0) { banner('🐒 ¡MONO BOMBA! (' + (online.survLo?.mono || 2) + ') · ' + (IS_TOUCH ? 'toca 🐒' : 'pulsa T'), 2.4); return; }
  const w = WEAPONS[m.w]; if (!w) return;
  banner((m.pick ? 'TOMASTE: ' : '¡LA CAJA TE DA: ') + w.name.toUpperCase() + (m.pick ? '' : '!'), 2);
  resetAmmo?.(); switchWeapon(0, m.w);
}
function onSurvKill(m) {
  const r = online.remotes.get(m.victim);
  if (r) { online.remotes.delete(m.victim); SV.corpses.push({ mesh: r.mesh, t: 0 }); }
  if (m.killer === online.id) {
    online.streakN = m.streak || (online.streakN || 0) + 1;
    medal(m.zt === 'boss' ? '¡GLADIADOR ZOMBI ABATIDO!' : (m.head ? 'HEADSHOT' : 'ZOMBI') + ` +${m.pts || 0}`, m.zt === 'boss' ? 300 : 10);
    if (m.multi >= 3) medal('MULTI ZOMBI x' + m.multi, 20);
  }
}
function survEvent(m) {
  if (m.ev === 'wave') { banner(`OLEADA ${m.wave}` + (m.boss ? ' · ¡JEFE: GLADIADOR ZOMBI!' : ''), 2.5); if (m.boss) shake = 0.3; }
  if (m.ev === 'waveClear') { banner(`¡OLEADA ${m.wave} SUPERADA! +${m.bonus} pts`, 2.5); if (m.wave % 10 === 0) addXp(250, 'OLEADA ' + m.wave); }
}
function clearSurv() {
  SV.box = null; SV.boxSpin = null; SV.pickups.clear(); SV.corpses.forEach((c) => scene.remove(c.mesh)); SV.corpses = []; SV.monos = []; SV.myPts = 0; SV.prompt = null;
  online.sv = null; online.survLo = null; $('use-prompt')?.classList.add('hidden'); $('btn-use')?.classList.add('hidden'); $('boss-bar')?.classList.add('hidden');
}

// ---------------------------------------------------------------- menus / flow
function showGame() {
  ['menu', 'gameover', 'shop', 'online', 'hq-hud'].forEach((id) => $(id).classList.add('hidden'));
  if (hqAvatar) hqAvatar.visible = false; viewGun.visible = true; ['btn-fire', 'btn-switch'].forEach((id) => $(id).classList.remove('hidden'));
  $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !IS_TOUCH);
  paused = false; $('respawn-text').textContent = '';
  showcase.visible = false;
  if (IS_TOUCH) document.documentElement.requestFullscreen?.().catch(() => {});
}
function goMenu(sec) {
  mode = 'menu'; paused = true; document.exitPointerLock?.();
  clearSolo(); online.clearRemotes(); $('killfeed').innerHTML = '';
  if (online.local) { online.local = null; online.id = null; online.inMatch = false; }
  document.body.classList.remove('v2match'); $('online').classList.remove('v2mode');
  ['gameover', 'shop', 'online', 'hud', 'touch', 'hq-hud', 'fade'].forEach((id) => $(id).classList.add('hidden'));
  if (hqAvatar) hqAvatar.visible = false; viewGun.visible = true; ['btn-fire', 'btn-switch'].forEach((id) => $(id).classList.remove('hidden'));
  buildWorld(mapId); $('menu').classList.remove('hidden');
  selectSection(sec || menuSec);
}

function mapPreview(id) {
  const m = createMap(id), c = document.createElement('canvas'); c.width = m.l; c.height = m.w; const g = c.getContext('2d');
  const pal = m.theme.preview;
  for (let i = 0; i < m.w; i++) for (let j = 0; j < m.l; j++) {
    const k = m.kind[i + j * m.w], h = m.heights[i + j * m.w];
    g.fillStyle = pal[k] || pal[0]; g.globalAlpha = k === 0 ? 1 : Math.min(1, 0.45 + h / 4); g.fillRect(j, i, 1, 1);
  }
  g.globalAlpha = 1;
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
    b.innerHTML = `<b>${(MAPS[id] || HUBS[id]).name.toUpperCase()}</b><span class="cnt">${n} ${n === 1 ? 'voto' : 'votos'}</span>`;
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
const showModels = {};
function showModel(i) {
  if (!showModels[i]) {
    const w = WEAPONS[i], m = makeWeaponModel(w.id);
    let sc = SHOW_SCALE[w.id];
    if (!sc) { const bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3()); sc = 1.9 / Math.max(sz.z, 0.2); }
    m.scale.setScalar(sc); m.visible = false; showcase.add(m); showModels[i] = m;
  }
  return showModels[i];
}
const showKey = new THREE.PointLight(0x3fe3ff, 6, 6); showKey.position.set(SHOW_POS.x - 1, SHOW_POS.y + 0.8, SHOW_POS.z + 1.2); scene.add(showKey);
const showRim = new THREE.PointLight(0xffffff, 4, 6); showRim.position.set(SHOW_POS.x + 1.5, SHOW_POS.y + 0.5, SHOW_POS.z - 1); scene.add(showRim);
const showFloor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.03, 40), new THREE.MeshPhongMaterial({ color: 0x0a1622, emissive: 0x04121c, shininess: 80 }));
showFloor.position.set(0, -0.62, 0); showcase.add(showFloor);
const showRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: 0x3fe3ff }));
showRing.rotation.x = Math.PI / 2; showRing.position.set(0, -0.6, 0); showcase.add(showRing);
let showWeapon = 0;
function setShowWeapon(i) { showWeapon = i; Object.entries(showModels).forEach(([k, m]) => (m.visible = +k === i)); showModel(i).visible = true; }
setShowWeapon(0);

let menuSec = 'hq';
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
  if (sec === 'hq') $('hm-hq-level').innerHTML = `NIVEL <b>${level()}</b> · ${xp} XP · clase: <b>${esc(curLoadout().name)}</b> (${esc(WEAPONS.find((w) => w.id === curLoadout().primary).name)} + ${esc(WEAPONS.find((w) => w.id === curLoadout().secondary).name)})`;
  if (sec === 'settings') { $('set-name').value = cleanName(LS.get('name', '')); $('set-name').placeholder = defaultName(); }
}
document.querySelectorAll('#hm-nav button').forEach((b) => (b.onclick = () => selectSection(b.dataset.sec)));
addEventListener('keydown', (e) => {
  if ($('menu').classList.contains('hidden') || e.target.tagName === 'INPUT') return;
  const order = ['hq', 'solo', 'online', 'shop', 'arms', 'settings']; const i = order.indexOf(menuSec);
  if (e.code === 'ArrowDown') selectSection(order[(i + 1) % order.length]);
  if (e.code === 'ArrowUp') selectSection(order[(i + order.length - 1) % order.length]);
  if (e.code === 'Enter') ({ hq: enterHQ, solo: startSolo, online: openOnline, shop: openShop })[menuSec]?.();
});
function renderArms() {
  const o = stats().owned, maxDps = Math.max(...WEAPONS.map((w) => w.damage / w.fireRate));
  $('hm-arms').innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const owned = isUnlocked(w);
    const b = document.createElement('button'); b.className = 'arm-row' + (i === showWeapon ? ' sel' : '');
    const pct = (v) => Math.round(Math.min(1, v) * 100);
    b.innerHTML = `<span class="nm">${w.name.toUpperCase()}</span>
      <span class="st">DAÑO<div class="bar2"><i style="width:${pct(w.damage / 140)}%"></i></div>CADENCIA<div class="bar2"><i style="width:${pct((w.damage / w.fireRate) / maxDps)}%"></i></div></span>
      <span class="own" style="color:${owned ? '#3fe3ff' : '#ffb347'}">${owned ? 'DISPONIBLE' : (w.legacy ? 'TIENDA' : 'NIVEL ' + w.lvl)}</span>`;
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
$('btn-hq').onclick = enterHQ;
$('btn-loadout').onclick = () => openLoadout('menu');
$('btn-online').onclick = openOnline;
$('btn-restart').onclick = () => {
  if (online.lastEnd?.mode && lastModeLaunch) { online.lastEnd = null; online.board = null; return startMode(lastModeLaunch.m, lastModeLaunch.net); }
  if (online.board && mode === 'menu' && online.id) { online.board = null; openOnline(); } else startSolo();
};
$('btn-go-hq').onclick = () => { online.lastEnd = null; if (online.ws && !online.local) online.send({ t: 'leave' }); enterHQ(); };
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
  if (loadoutOpen) { // loadout screen: character on the stage, slightly left of centre
    stageSpin += dt;
    if (stageAvatar) stageAvatar.rotation.y = 0.55 + Math.sin(stageSpin * 0.6) * 0.3;
    const off = -0.75 * Math.min(2.2, camera.aspect) / 2.16;
    camera.position.set(STAGE_POS.x + off, STAGE_POS.y + 1.3, STAGE_POS.z - 3.4);
    camera.lookAt(STAGE_POS.x + off, STAGE_POS.y + 1.05, STAGE_POS.z);
  } else if (!paused && mode === 'hq') {
    updateHQ(dt); hud();
  } else if (!paused && (mode === 'solo' || mode === 'online')) {
    updatePlayer(dt); tryFire(dt);
    if (mode === 'solo') { updateBots(dt); updateProjectiles(dt); }
    else { tickLocal(dt); updateOnline(dt); }
    hud();
  } else if (mode === 'menu' && !$('menu').classList.contains('hidden')) {
    menuSpin += dt * 0.12;
    camera.rotation.set(0, 0, 0);
    if (showcase.visible) { // slowly rotating weapon on a lit pedestal
      showModel(showWeapon).rotation.y = Math.PI / 2 + Math.sin(menuSpin * 2.5) * 0.3; // side profile, gentle sway
      showModel(showWeapon).position.y = Math.sin(menuSpin * 6) * 0.03;
      // weapon sits in the right part of the screen, clear of the left menu + stats panel
      const off = 2.55 * camera.aspect / 2.16;
      camera.position.set(SHOW_POS.x - off, SHOW_POS.y + 0.3, SHOW_POS.z + 2.4);
      camera.lookAt(SHOW_POS.x - off, SHOW_POS.y - 0.05, SHOW_POS.z);
    } else { // low cinematic orbit over the selected map
      camera.position.set(map.w / 2 + Math.sin(menuSpin) * map.w * 0.9, 5.5, map.l / 2 + Math.cos(menuSpin) * map.l * 0.55);
      camera.lookAt(map.w / 2, 1, map.l / 2);
    }
  }
  updateV2Hud(dt);
  if (shake > 0) { shake = Math.max(0, shake - dt); if (mode === 'online') camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0)); }
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
window.__zstrike = { camera, WEAPONS, input, SV, throwMono, survInteract, useStreakNow, streakReady, throwNade, startLocalMatch, enterHQ, openLoadout, closeLoadout, startMode, addXp, showUnlocked, get loadouts() { return loadouts; }, get hqNear() { return hqNear; }, setMap: (id) => { mapId = id; buildWorld(id); }, setTimeScale: (v) => (timeScale = v), startSolo, openShop, openOnline, goMenu, selectSection, setShowWeapon, switchWeapon, addKill, damageEnemy, player, get enemies() { return enemies; }, get mode() { return mode; }, online, look };
