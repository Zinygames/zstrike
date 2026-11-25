// Paid join must be refused without a real, matching on-chain entry payment.
import WebSocket from 'ws';
const ws = new WebSocket(process.argv[2] || 'ws://localhost:8080/ws');
const out = [];
ws.on('message', (r) => out.push(JSON.parse(r)));
await new Promise((r) => ws.on('open', r));
const send = (m) => ws.send(JSON.stringify(m)); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
send({ t: 'info' }); await wait(1500);
send({ t: 'join', sig: 'abc', pubkey: 'EiitkVBCV75BgSxrGMjr49if3Ug4n3orgvvE7E5vU6iH' }); await wait(500); // no quote yet
send({ t: 'quote' }); await wait(800);
send({ t: 'join', sig: '5'.repeat(88), pubkey: 'EiitkVBCV75BgSxrGMjr49if3Ug4n3orgvvE7E5vU6iH' }); await wait(16000); // fake signature
console.log(JSON.stringify(out.map((m) => m.t === 'info' ? { t: 'info', entrySol: m.entrySol, solUsd: m.solUsd, src: m.priceSource, winnerUsd: m.winnerUsd } : m.t === 'quote' ? { t: 'quote', lamports: m.lamports, nonce: m.nonce } : m), null, 1));
process.exit(0);
