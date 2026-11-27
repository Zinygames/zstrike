// =====================================================================
// ZStrike - game configuration
// =====================================================================

// Wallet that RECEIVES every SOL purchase made in the shop.
// Placeholder: Ziny's PUBLIC Phantom address. A public address is safe to
// share; NEVER put a seed phrase or private key anywhere in this project.
// Change it to any wallet you control before publishing.
export const TREASURY = 'EiitkVBCV75BgSxrGMjr49if3Ug4n3orgvvE7E5vU6iH';

// Network. v1 is DEVNET ONLY (test SOL, no real money).
// Switching to 'mainnet-beta' means REAL money - read README.md first.
export const CLUSTER = 'devnet';
// Safety latch: purchases are refused on any cluster other than devnet
// unless this is explicitly set to true.
export const ALLOW_MAINNET = false;
// RPC endpoint. The public devnet endpoint is free but rate limited.
export const RPC_URL = 'https://api.devnet.solana.com';

export const GAME_NAME = 'ZStrike';

// Weapons. `unlock` = shop item id needed (null = free).
// Indices are part of the online protocol: 0-2 are the original (v1) shop weapons and
// must stay first; v2 weapons are appended after them.
// v2 fields: cls (class), slot (primary|secondary), mag (0 = infinite), reload (s),
// ads (zoom FOV while aiming), adsTime (s), move (speed mult), lvl (level needed),
// dual (two guns), bolt (bolt-action), draw (bow full-draw time), style (voxel model).
const LEGACY = [
  { id: 'pistol', name: 'Pistola de Plasma', short: 'PISTOLA', damage: 26, fireRate: 0.32, spread: 0.004, pellets: 1, range: 60, kind: 'hitscan', color: 0xff4a3d, unlock: null, cls: 'pistol', slot: 'secondary', mag: 0, reload: 1.2, ads: 60, adsTime: 0.15, move: 1, legacy: true },
  { id: 'smg',    name: 'SMG de Plasma', short: 'SMG', damage: 13, fireRate: 0.075, spread: 0.03,  pellets: 1, range: 45, kind: 'hitscan', color: 0x46c8ff, unlock: 'smg', cls: 'smg', slot: 'primary', mag: 0, reload: 1.8, ads: 60, adsTime: 0.2, move: 1, legacy: true },
  { id: 'rocket', name: 'Lanzacohetes SOL', short: 'COHETE', damage: 140, fireRate: 0.95, spread: 0, pellets: 1, range: 80, kind: 'rocket', splash: 3.2, speed: 26, color: 0xff3df2, unlock: 'rocket', cls: 'launcher', slot: 'secondary', mag: 0, reload: 2, ads: 60, adsTime: 0.3, move: 0.95, legacy: true },
];
// [id, name, short, cls, damage, fireRate, mag, reload, range, spread, ads, lvl, tracer, style, extra]
const V2 = [
  // ---- snipers (bolt-action, scope)
  ['vibora', 'Víbora Lima', 'VÍBORA', 'sniper', 98, 1.25, 5, 2.6, 140, 0.05, 22, 1, 0x9dff3a, { body: 0xf2f4f0, accent: 0x7cff2e, glow: 0x3fa9ff, f: ['scope'] }],
  ['tigre', 'Tigre Solar', 'TIGRE', 'sniper', 110, 1.45, 4, 2.9, 150, 0.06, 20, 4, 0xff9a1f, { body: 0xff8a1a, accent: 0x1a1a1a, glow: 0x3ff6ff, f: ['scope', 'coils'] }],
  ['centinela', 'Centinela', 'CENTINELA', 'sniper', 105, 1.35, 5, 3.0, 150, 0.05, 18, 7, 0xd8d08a, { body: 0x6b6b3a, accent: 0x3b3b22, glow: 0xff3b3b, f: ['scope', 'bipod', 'brake'] }],
  ['atomo', 'Átomo Azul', 'ÁTOMO', 'sniper', 90, 1.0, 6, 2.4, 130, 0.05, 24, 10, 0x5ad7ff, { body: 0x1f5fbf, accent: 0xe8eef8, glow: 0x9fe8ff, f: ['scope', 'orb'] }],
  ['onda', 'Onda Púrpura', 'ONDA', 'sniper', 100, 1.15, 5, 2.7, 140, 0.05, 22, 13, 0xd04dff, { body: 0x5a1fa8, accent: 0x1b1030, glow: 0xff5df2, f: ['scope', 'wavy'] }],
  // ---- SMGs
  ['glaciar', 'Cristal Glaciar', 'GLACIAR', 'smg', 14, 0.07, 32, 1.8, 40, 0.032, 55, 1, 0x7fe0ff, { body: 0x5fc8ff, accent: 0xff8a1a, glow: 0xbff4ff, f: ['crystal'] }],
  ['guardia', 'Vieja Guardia', 'GUARDIA', 'smg', 18, 0.105, 32, 2.0, 42, 0.028, 55, 2, 0xffd27a, { body: 0x2a2a2a, accent: 0x6e4b33, glow: 0xffc04a, f: ['longmag', 'foldstock'] }],
  ['bala', 'Bala Negra', 'BALA', 'smg', 13, 0.06, 50, 2.4, 38, 0.035, 55, 5, 0xc9c9c9, { body: 0x1c1d20, accent: 0x55585e, glow: 0x3fe3ff, f: ['bullpup'] }],
  ['toxica', 'Tóxica', 'TÓXICA', 'smg', 15, 0.075, 30, 1.9, 40, 0.03, 55, 8, 0x5dff3a, { body: 0x35d42a, accent: 0x14301a, glow: 0xb4ff3a, f: ['tank'] }],
  ['arcoiris', 'Arcoíris', 'ARCOÍRIS', 'smg', 16, 0.085, 25, 1.8, 42, 0.028, 55, 11, 0xff66d8, { body: 0xf4f4f4, accent: 0x222222, glow: 0xff3df2, f: ['rainbow'] }],
  ['silencio', 'Rosa Silenciosa', 'SILENCIO', 'smg', 14, 0.08, 30, 1.9, 40, 0.03, 55, 14, 0xff8fd0, { body: 0xff6fb5, accent: 0x2a1020, glow: 0xffc1e3, f: ['suppressor'] }, { quiet: true }],
  ['sombra', 'Sombra', 'SOMBRA', 'smg', 19, 0.11, 25, 2.0, 45, 0.026, 55, 16, 0xaaaaaa, { body: 0x121316, accent: 0x2c2e33, glow: 0xff3b3b, f: ['stock'] }],
  // ---- assault rifles
  ['carmesi', 'Carmesí', 'CARMESÍ', 'rifle', 24, 0.11, 30, 2.1, 70, 0.018, 50, 1, 0xff4040, { body: 0xf0f0f0, accent: 0xd8262b, glow: 0xff4a3d, f: ['redbarrel'] }],
  ['dorado', 'Dorado Láser', 'DORADO', 'rifle', 26, 0.12, 30, 2.2, 75, 0.013, 48, 3, 0xffd84d, { body: 0xe0b52a, accent: 0x3a2a0a, glow: 0xff2020, f: ['laser', 'sight'] }],
  ['martillo', 'Martillo Rojo', 'MARTILLO', 'rifle', 31, 0.135, 30, 2.4, 70, 0.024, 52, 6, 0xff6a4a, { body: 0xb3221c, accent: 0x161616, glow: 0x3fe3ff, f: ['curvedmag', 'wood'] }],
  ['marea', 'Marea', 'MAREA', 'rifle', 22, 0.095, 35, 2.0, 68, 0.019, 50, 9, 0x3fe3ff, { body: 0x1c8fa0, accent: 0xff8a1a, glow: 0x7df9ff, f: ['sight'] }],
  ['selva', 'Selva', 'SELVA', 'rifle', 25, 0.115, 30, 2.2, 72, 0.017, 50, 12, 0x9fd36a, { body: 0x6e8f3a, accent: 0x2a3a18, glow: 0xffe14a, f: ['camo', 'ugl'] }],
  // ---- LMGs
  ['cinturon', 'Cinturón', 'CINTURÓN', 'lmg', 27, 0.1, 100, 5.0, 70, 0.03, 50, 2, 0xffc46b, { body: 0x2e3238, accent: 0xb08a3a, glow: 0xffb347, f: ['belt', 'bipod', 'handle'] }],
  ['canon', 'Cañón Azul', 'CAÑÓN', 'lmg', 32, 0.14, 60, 4.2, 70, 0.028, 50, 5, 0x46c8ff, { body: 0x24306a, accent: 0x9fb4c4, glow: 0x46c8ff, f: ['energy'] }],
  ['volcan', 'Volcán', 'VOLCÁN', 'lmg', 30, 0.12, 75, 4.6, 70, 0.03, 50, 9, 0xff5a1f, { body: 0xc8501a, accent: 0x4a1a0a, glow: 0xffd23a, f: ['boxmag', 'handle'] }],
  ['tambor', 'Tambor Verde', 'TAMBOR', 'lmg', 25, 0.09, 90, 4.8, 65, 0.032, 50, 12, 0x3aff8a, { body: 0x16181b, accent: 0x2fbf5a, glow: 0x3aff8a, f: ['drum'] }],
  ['rey', 'Rey Dorado', 'REY', 'lmg', 28, 0.11, 80, 4.6, 80, 0.026, 38, 15, 0xffe08a, { body: 0xc9a34a, accent: 0x4a3a1a, glow: 0xff2a2a, f: ['scope', 'bipod'] }],
  // ---- pistols (secondary)
  ['gemelas', 'Gemelas Patria', 'GEMELAS', 'pistol', 20, 0.15, 24, 1.8, 45, 0.03, 60, 1, 0xff4a4a, { body: 0xd8262b, accent: 0xf4f4f4, glow: 0x3f6bff, f: ['skull'] }, { dual: true }],
  ['lava', 'Lava', 'LAVA', 'pistol', 30, 0.28, 12, 1.4, 55, 0.008, 58, 3, 0xff3a1a, { body: 0x1a1a1a, accent: 0xd8262b, glow: 0xff2020, f: ['suppressor', 'laser'] }],
  ['turquesa', 'Culata Turquesa', 'TURQUESA', 'pistol', 16, 0.1, 20, 1.6, 45, 0.02, 58, 6, 0x3fe3ff, { body: 0x2bb5b0, accent: 0x1a3a3a, glow: 0x7df9ff, f: ['foldstock', 'extmag'] }],
  ['relampago', 'Gemelas Relámpago', 'RELÁMPAGO', 'pistol', 18, 0.13, 30, 2.0, 45, 0.03, 60, 9, 0xffe14a, { body: 0xf4f4f4, accent: 0xffd23a, glow: 0xff2020, f: ['laser'] }, { dual: true }],
  ['clasica', 'Clásica', 'CLÁSICA', 'pistol', 28, 0.3, 15, 1.3, 50, 0.01, 60, 1, 0xdddddd, { body: 0x8d939b, accent: 0x3a3d42, glow: 0xffffff, f: [] }],
  // ---- launchers (secondary): splash rockets
  ['mandibula', 'Mandíbula', 'MANDÍBULA', 'launcher', 130, 1.2, 1, 2.4, 90, 0, 55, 4, 0xff3df2, { body: 0x1e1e22, accent: 0xf4f4f4, glow: 0xff3b3b, f: ['mouth'] }, { splash: 3.5, speed: 24 }],
  ['trueno', 'Doble Trueno', 'TRUENO', 'launcher', 105, 0.55, 2, 3.2, 90, 0, 55, 8, 0x5a8cff, { body: 0xf0f0f0, accent: 0xd8262b, glow: 0x3f6bff, f: ['double'] }, { splash: 3, speed: 26 }],
  ['verde', 'Verde Clásico', 'VERDE', 'launcher', 140, 1.3, 1, 2.2, 95, 0, 55, 2, 0xb4ff3a, { body: 0x5a8a2a, accent: 0x8a5a2a, glow: 0xb4ff3a, f: ['warhead'] }, { splash: 3.2, speed: 28 }],
  ['pixelazo', 'Pixelazo', 'PIXELAZO', 'launcher', 120, 1.1, 1, 2.0, 85, 0, 55, 12, 0x3aff8a, { body: 0x2f8f3a, accent: 0xffb347, glow: 0x3aff8a, f: ['warhead', 'pixel'] }, { splash: 4, speed: 20 }],
  // ---- bows (secondary): hold to draw, arrows drop
  ['voltio', 'Arco Voltio', 'VOLTIO', 'bow', 120, 0.45, 1, 0.35, 120, 0.002, 50, 3, 0x46c8ff, { body: 0x1a1a1a, accent: 0xd8262b, glow: 0x46c8ff, f: [] }, { draw: 0.8, speed: 55 }],
  ['corazon', 'Corazón', 'CORAZÓN', 'bow', 100, 0.4, 1, 0.3, 110, 0.002, 50, 7, 0xff6fb5, { body: 0xf4f4f4, accent: 0xff3d8a, glow: 0xffc1e3, f: ['hearts'] }, { draw: 0.6, speed: 50 }],
  ['cuantico', 'Arco Cuántico', 'CUÁNTICO', 'bow', 135, 0.5, 1, 0.4, 130, 0.002, 50, 11, 0x3ff6ff, { body: 0x2a4a8a, accent: 0xe0b52a, glow: 0x3ff6ff, f: [] }, { draw: 1.0, speed: 60 }],
];
const CLS = {
  sniper: { slot: 'primary', kind: 'hitscan', adsTime: 0.32, move: 0.9, bolt: true },
  smg: { slot: 'primary', kind: 'hitscan', adsTime: 0.15, move: 1.05 },
  rifle: { slot: 'primary', kind: 'hitscan', adsTime: 0.22, move: 1 },
  lmg: { slot: 'primary', kind: 'hitscan', adsTime: 0.3, move: 0.88 },
  pistol: { slot: 'secondary', kind: 'hitscan', adsTime: 0.12, move: 1.05 },
  launcher: { slot: 'secondary', kind: 'rocket', adsTime: 0.3, move: 0.92 },
  bow: { slot: 'secondary', kind: 'arrow', adsTime: 0.2, move: 1 },
};
export const WEAPONS = [
  ...LEGACY,
  ...V2.map(([id, name, short, cls, damage, fireRate, mag, reload, range, spread, ads, lvl, color, style, extra]) => ({
    id, name, short, cls, damage, fireRate, mag, reload, range, spread, ads, lvl, color, style, pellets: 1, unlock: null, ...CLS[cls], ...(extra || {}),
  })),
];
export const weaponIndex = (id) => WEAPONS.findIndex((w) => w.id === id);
export const CLASS_NAMES = { sniper: 'FRANCOTIRADOR', smg: 'SUBFUSIL', rifle: 'RIFLE DE ASALTO', lmg: 'AMETRALLADORA', pistol: 'PISTOLA', launcher: 'LANZACOHETES', bow: 'ARCO' };
export const DEFAULT_LOADOUT = { primary: 'carmesi', secondary: 'clasica', lethal: 'frag', tactical: 'flash', perks: ['agil', 'manos', 'suave'] };

// Perks: 3 slots (1 blue, 2 orange, 3 green). Original names/icons (icons drawn in CSS/SVG).
export const PERKS = {
  1: [
    { id: 'agil', name: 'Pies Ligeros', desc: 'Te mueves 10% más rápido.', icon: '»' },
    { id: 'pluma', name: 'Pluma', desc: 'Sin daño por caída.', icon: '⇣' },
    { id: 'blindaje', name: 'Blindaje Térmico', desc: 'Recibes 50% menos daño de explosiones.', icon: '✸' },
    { id: 'fantasma', name: 'Fantasma', desc: 'Invisible para el UAV enemigo.', icon: '◌' },
  ],
  2: [
    { id: 'manos', name: 'Manos Rápidas', desc: 'Recargas 35% más rápido.', icon: '↻' },
    { id: 'halcon', name: 'Ojo de Halcón', desc: 'Apuntas (ADS) 40% más rápido.', icon: '◎' },
    { id: 'pulso', name: 'Pulso Firme', desc: '40% menos dispersión sin apuntar.', icon: '✛' },
    { id: 'bolsillo', name: 'Bolsillo Extra', desc: '+1 granada letal.', icon: '+' },
  ],
  3: [
    { id: 'suave', name: 'Pisada Suave', desc: 'Pasos silenciosos: los bots te detectan más tarde.', icon: '∿' },
    { id: 'maraton', name: 'Maratón', desc: 'Sprint el doble de largo.', icon: '∞' },
    { id: 'segunda', name: 'Segunda Oportunidad', desc: 'Una vez por vida sobrevives un golpe mortal con 1 HP.', icon: '♥' },
    { id: 'antiflash', name: 'Antiflash', desc: 'Las granadas cegadoras te afectan 70% menos.', icon: '☀' },
  ],
};
export const PERK_IDS = Object.fromEntries(Object.entries(PERKS).map(([s, l]) => [s, l.map((p) => p.id)]));
export const LETHALS = [{ id: 'frag', name: 'Granada', desc: 'Explota a los 1.6 s.' }];
export const TACTICALS = [{ id: 'flash', name: 'Cegadora', desc: 'Ciega a los enemigos cercanos.' }];

// Scorestreaks: ONLY these three, earned by kills without dying.
export const STREAKS = [
  { id: 'uav', name: 'UAV', kills: 3, key: 'Digit4', label: '4', desc: 'Muestra a los enemigos en el minimapa 25 s.' },
  { id: 'air', name: 'BOMBARDEO', kills: 5, key: 'Digit5', label: '5', desc: 'Bombardeo en la zona a la que apuntas.' },
  { id: 'heli', name: 'HELICÓPTERO', kills: 10, key: 'Digit6', label: '6', desc: 'Helicóptero de ataque durante 25 s.' },
];

// Game modes (v2). The paid SOL lobby stays the v1 free-for-all ("legacy").
export const MODES = {
  tdm: { name: 'DUELO POR EQUIPOS', short: 'TDM', team: true, desc: 'Equipo contra equipo. Primer equipo en 40 kills.', scoreLimit: 40, seconds: 360, respawn: true, color: 0x3fe3ff },
  ffa: { name: 'TODOS CONTRA TODOS', short: 'FFA', team: false, desc: 'Cada uno por su cuenta. Primero en 20 kills.', scoreLimit: 20, seconds: 360, respawn: true, color: 0xff3df2 },
  dom: { name: 'DOMINACIÓN', short: 'DOM', team: true, desc: 'Captura y defiende las banderas A, B y C. 150 puntos.', scoreLimit: 150, seconds: 480, respawn: true, color: 0xffd84d },
  snd: { name: 'BUSCAR Y DESTRUIR', short: 'BYD', team: true, desc: 'Planta o desactiva la bomba. Sin reaparecer. 4 rondas.', scoreLimit: 4, seconds: 900, respawn: false, round: 90, color: 0xff5a1f },
  ctf: { name: 'CAPTURA LA BANDERA', short: 'CTF', team: true, desc: 'Roba la bandera enemiga y tráela a tu base. 3 capturas.', scoreLimit: 3, seconds: 480, respawn: true, color: 0x3aff8a },
  // Co-op zombie survival in the Coliseo (not on the HQ portal wall: it has its own gate). Never wagered.
  surv: { name: 'SURVIVE THE 150', short: '150', team: true, coop: true, desc: 'Sobrevive 150 oleadas de zombis en el Coliseo. Solo o en co-op.', scoreLimit: 0, seconds: 36000, respawn: false, color: 0xffb347 },
};

// Survive the 150: zombie types (base stats, scaled per wave in match.js) and the mystery box.
export const ZTYPES = {
  walker: { name: 'Zombi', hp: 70, sp: 2.1, dmg: 12, pts: 60, scale: 1 },
  runner: { name: 'Corredor', hp: 50, sp: 4.0, dmg: 9, pts: 80, scale: 0.9 },
  brute: { name: 'Bruto', hp: 380, sp: 1.7, dmg: 30, pts: 200, scale: 1.35 },
  boss: { name: 'Gladiador Zombi', hp: 2500, sp: 2.4, dmg: 45, pts: 1500, scale: 2.0 },
};
export const SURV = { waves: 150, boxCost: 950, breakMs: 9000, firstBreakMs: 6000, maxAlive: 22, monoLureMs: 5000, monoMax: 3, pickups: 8 };
// Mono Bomba: original wind-up cymbal-monkey toy. Throw it, zombies chase the clanging for 5 s, then it explodes.
export const MONO = { id: 'mono', name: 'Mono Bomba', desc: 'Juguete de platillos: atrae a los zombis 5 s y explota.', radius: 6, damage: 650 };

// Shop. Every item is a fixed, known reward (no loot boxes / no random paid rewards).
// priceCoins: buyable with in-game coins (null = not available for coins).
// priceSol:   buyable with SOL on CLUSTER (null = not available for SOL).
export const SHOP_ITEMS = [
  { id: 'smg',    name: 'SMG de Plasma',        desc: 'Arma automática, dispara muy rápido.',   priceCoins: 200,  priceSol: 0.01 },
  { id: 'dmg1',   name: 'Daño +25% (Nv 1)',  desc: 'Todas las armas hacen 25% más daño.',    priceCoins: 150,  priceSol: 0.005 },
  { id: 'hp1',    name: 'Vida +50 (Nv 1)',   desc: 'Vida máxima 150.',                        priceCoins: 250,  priceSol: 0.01 },
  { id: 'rocket', name: 'Lanzacohetes SOL',  desc: 'Cohetes con daño en área. Solo SOL.',     priceCoins: null, priceSol: 0.05 },
  { id: 'armor',  name: 'Armadura Neon',     desc: 'Reduce el daño recibido un 40%.',         priceCoins: null, priceSol: 0.03 },
  { id: 'dmg2',   name: 'Daño +25% (Nv 2)',  desc: 'Otro +25% de daño.', requires: 'dmg1',    priceCoins: null, priceSol: 0.02 },
  { id: 'hp2',    name: 'Vida +50 (Nv 2)',   desc: 'Vida máxima 200.',   requires: 'hp1',     priceCoins: null, priceSol: 0.02 },
  { id: 'dmg3',   name: 'Daño +25% (Nv 3)',  desc: 'Daño máximo.',       requires: 'dmg2',    priceCoins: null, priceSol: 0.04 },
];

// Multiplayer server URL.
// SERVER_URL: force one server ('' = auto).
// Auto mode: first try the same host that serves this page (works on Render, where
// server/server.js serves the game), then fall back to PUBLIC_SERVER_URL (used when the
// page is hosted elsewhere, e.g. itch.io or GitHub Pages).
export const SERVER_URL = '';
export const PUBLIC_SERVER_URL = 'wss://zstrike.onrender.com/ws';
