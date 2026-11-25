// Phantom wallet + Solana payments (devnet in v1).
// Uses Phantom's injected provider and @solana/web3.js (vendored IIFE -> window.solanaWeb3).
// This module NEVER asks for, reads or stores seed phrases / private keys:
// signing happens inside Phantom; we only see the public key and signatures.
import { TREASURY, CLUSTER, ALLOW_MAINNET, RPC_URL } from './config.js';

const web3 = window.solanaWeb3;
let connection = null;
let provider = null;
let publicKey = null;
const listeners = new Set();

export function onWalletChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach((fn) => fn(getPublicKey())); }

export function getConnection() {
  if (!connection) connection = new web3.Connection(RPC_URL, 'confirmed');
  return connection;
}

export function getProvider() {
  const p = window.phantom?.solana || window.solana;
  return p && p.isPhantom ? p : null;
}

export function getPublicKey() { return publicKey ? publicKey.toBase58() : null; }

export function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

// Phantom universal link that reopens this page inside Phantom's in-app browser,
// where the provider is injected.
export function phantomBrowseLink(url = location.href) {
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`;
}

export async function connect() {
  provider = getProvider();
  if (!provider) throw new Error('NO_PROVIDER');
  const res = await provider.connect();
  publicKey = res.publicKey;
  provider.on?.('accountChanged', (pk) => { publicKey = pk || null; emit(); });
  provider.on?.('disconnect', () => { publicKey = null; emit(); });
  emit();
  return getPublicKey();
}

// Reconnect silently if the user already trusted this site.
export async function tryEagerConnect() {
  provider = getProvider();
  if (!provider) return null;
  try {
    const res = await provider.connect({ onlyIfTrusted: true });
    publicKey = res.publicKey; emit();
  } catch (_) { /* not trusted yet */ }
  return getPublicKey();
}

export async function disconnect() {
  try { await provider?.disconnect(); } catch (_) {}
  publicKey = null; emit();
}

export async function getBalanceSol() {
  if (!publicKey) return null;
  const lamports = await getConnection().getBalance(publicKey);
  return lamports / web3.LAMPORTS_PER_SOL;
}

export async function requestDevnetAirdrop() {
  if (CLUSTER !== 'devnet') throw new Error('Airdrop solo existe en devnet');
  const conn = getConnection();
  const sig = await conn.requestAirdrop(publicKey, 1 * web3.LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
  return sig;
}

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// Pays `sol` to TREASURY (or opts.to, e.g. the lobby escrow) and resolves with the
// signature ONLY after the tx is confirmed on-chain and verified (payer, receiver, amount).
// opts.memo adds an on-chain memo (used by the multiplayer server to bind the
// payment to one connection so a signature can't be reused by someone else).
export async function paySol(sol, onStatus = () => {}, opts = {}) {
  if (CLUSTER !== 'devnet' && !ALLOW_MAINNET) throw new Error('Mainnet bloqueado en config (ALLOW_MAINNET=false)');
  if (!provider || !publicKey) throw new Error('Conecta tu wallet primero');
  const conn = getConnection();
  const treasury = new web3.PublicKey(opts.to || TREASURY);
  const lamports = opts.lamports || Math.round(sol * web3.LAMPORTS_PER_SOL);

  onStatus('Preparando transacción…');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight })
    .add(web3.SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: treasury, lamports }));
  if (opts.memo) {
    tx.add(new web3.TransactionInstruction({ keys: [], programId: new web3.PublicKey(MEMO_PROGRAM), data: new TextEncoder().encode(opts.memo) }));
  }

  onStatus('Aprueba la transacción en Phantom…');
  let signature;
  if (typeof provider.signTransaction === 'function') {
    // Sign in Phantom, but WE broadcast to our configured cluster (devnet),
    // so the payment can't accidentally land on whatever network Phantom is set to.
    const signed = await provider.signTransaction(tx);
    onStatus('Enviando a ' + CLUSTER + '…');
    signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  } else {
    // Fallback. The blockhash comes from CLUSTER, so other networks reject it.
    const res = await provider.signAndSendTransaction(tx);
    signature = res.signature;
  }

  onStatus('Confirmando en la blockchain…');
  const conf = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (conf.value.err) throw new Error('La transacción falló: ' + JSON.stringify(conf.value.err));

  onStatus('Verificando pago…');
  await verifyTransfer(signature, publicKey, treasury, lamports);
  return signature;
}

async function verifyTransfer(signature, from, to, lamports) {
  const conn = getConnection();
  let parsed = null;
  for (let i = 0; i < 10 && !parsed; i++) {
    parsed = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!parsed) await new Promise((r) => setTimeout(r, 800));
  }
  if (!parsed) throw new Error('No se pudo leer la transacción para verificarla');
  const ok = parsed.transaction.message.instructions.some((ix) =>
    ix.program === 'system' && ix.parsed?.type === 'transfer' &&
    ix.parsed.info.source === from.toBase58() &&
    ix.parsed.info.destination === to.toBase58() &&
    Number(ix.parsed.info.lamports) >= lamports);
  if (!ok) throw new Error('La transacción no coincide con el pago esperado');
}

export function explorerTxUrl(sig) {
  const c = CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${sig}${c}`;
}
