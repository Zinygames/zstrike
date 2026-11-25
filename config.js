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
export const WEAPONS = [
  { id: 'pistol', name: 'Pistola de Plasma', short: 'PISTOLA', damage: 26, fireRate: 0.32, spread: 0.004, pellets: 1, range: 60, kind: 'hitscan', color: 0xff4a3d, unlock: null },
  { id: 'smg',    name: 'SMG de Plasma', short: 'SMG', damage: 13, fireRate: 0.075, spread: 0.03,  pellets: 1, range: 45, kind: 'hitscan', color: 0x46c8ff, unlock: 'smg' },
  { id: 'rocket', name: 'Lanzacohetes SOL', short: 'COHETE', damage: 140, fireRate: 0.95, spread: 0, pellets: 1, range: 80, kind: 'rocket', splash: 3.2, speed: 26, color: 0xff3df2, unlock: 'rocket' },
];

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
