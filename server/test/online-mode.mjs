import WebSocket from 'ws';
const URL = process.argv[2] || 'ws://localhost:8787/ws', MODE = process.argv[3] || 'dom';
const ws = new WebSocket(URL); const seen = {}; let start = null, lastObj = null, sc = null;
ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name: 'ModeTest' })); ws.send(JSON.stringify({ t: 'joinMode', mode: MODE, map: 'fortaleza', lo: { primary: 'vibora', secondary: 'gemelas', perks: ['blindaje', 'halcon', 'segunda'] } })); });
ws.on('message', (d) => { const m = JSON.parse(d); seen[m.t] = (seen[m.t] || 0) + 1; if (m.t === 'start') start = { mode: m.mode, team: m.team, teamMode: m.teamMode, legacy: m.legacy, map: m.map, obj: !!m.obj }; if (m.t === 'snap') { if (m.o) lastObj = m.o; sc = m.sc; } });
setTimeout(() => { console.log(JSON.stringify({ start, seen, sc, obj: lastObj && Object.keys(lastObj) })); ws.close(); process.exit(0); }, +(process.argv[4] || 30000));
