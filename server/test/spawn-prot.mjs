// Spawn protection: just after a match starts, incoming shots must not damage the player.
import { createMap } from '../../map.js';
import { SPAWN_PROT_MS } from '../../config.js';
import { initMatch, newPlayer, beginMatch, handleMsg } from '../../match.js';

const L = { id: 't', paid: false, mapId: 'coliseo', map: createMap('coliseo'), size: 2, players: new Map(), state: 'waiting' };
const hits = [];
initMatch(L, { mode: 'tdm', bcast: (m) => { if (m.t === 'hit' || m.t === 'kill') hits.push(m); }, sendTo: () => {}, onEnd: () => {} });
const a = newPlayer(L, { id: 'A', name: 'A', conn: { fake: 1 } });
const b = newPlayer(L, { id: 'B', name: 'B', conn: { fake: 1 } });
beginMatch(L);
const place = () => { a.x = 23; a.y = 0; a.z = 26; b.x = 23; b.y = 0; b.z = 18; };
place();
const hp0 = b.hp, w = a.loadout.primary;
const shot = () => handleMsg(L, a, { t: 'shot', w, o: { x: a.x, y: a.y + 1.55, z: a.z }, d: { x: 0, y: (1.05 - 1.55) / 8, z: -1 }, c: 1 });
shot();
const blocked = b.hp === hp0 && hits.length === 0;
b.spawnProtUntil = Date.now() - 1;
a.cdUntil = 0;
place();
shot();
const after = b.hp < hp0 || hits.some((h) => h.t === 'hit' || h.t === 'kill');
const ok = blocked && after;
console.log(JSON.stringify({ protMs: SPAWN_PROT_MS, blocked, after, hp0, hp1: b.hp, w, hits: hits.map((h) => h.t), ok }));
process.exit(ok ? 0 : 1);
