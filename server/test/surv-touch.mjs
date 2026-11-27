// Needs playwright-core + Chrome (run from /workspace/sol-shooter-tools or `npm i -D playwright-core`). Usage: node test/surv-touch.mjs [url]
// Survive ✋ touch check on several phone viewports: visible, on top (elementFromPoint), no overlap with
// other touch controls, and works with multitouch (joystick finger held down while tapping ✋).
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://localhost:8787/', OUT = '/workspace/sol-shooter-shots/v2';
const VPS = [[667, 375, 'iphone-se'], [740, 360, 'android-small'], [844, 390, 'iphone-14'], [932, 430, 'iphone-pro-max'], [915, 412, 'pixel']];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; let fail = 0;
for (const [w, h, name] of VPS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('zstrike:name', JSON.stringify('Ziny')));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const Z = (fn, a) => page.evaluate(fn, a), cdp = await ctx.newCDPSession(page);
  await Z(() => window.__zstrike.startLocalMatch('surv', 'coliseo', { survStart: 1 })); await page.waitForTimeout(3500);
  const goto = (kind) => Z((kind) => { const z = window.__zstrike, p = z.player, me = z.online.local.players.get(z.online.id);
    let x, zz; if (kind === 'box') { const b = z.SV.box.position; x = b.x; zz = b.z - 1.6; } else { const [, k] = [...z.SV.pickups][0]; x = k.x + 1.2; zz = k.z; }
    p.pos.set(x, p.pos.y, zz); me.x = x; me.z = zz; }, kind);
  const layout = () => Z(() => { const b = document.getElementById('btn-use'), r = b.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy); const ov = [];
    for (const el of document.querySelectorAll('.tbtn, #joy-zone, #streak-bar button, #btn-fire, #look-zone')) { if (el === b || el.offsetParent === null || el.classList.contains('hidden')) continue;
      const q = el.getBoundingClientRect(); if (!q.width) continue; const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left), iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (ix > 2 && iy > 2 && el.id !== 'look-zone') ov.push(el.id || el.className); }
    return { visible: !b.classList.contains('hidden') && r.width > 0, rect: [r.x, r.y, r.width, r.height].map(Math.round), onTop: top === b || b.contains(top), overlaps: ov, inView: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  // pickup with multitouch: finger 1 holds the joystick, finger 2 taps ✋
  await goto('pick'); await page.waitForTimeout(600);
  const L1 = await layout(); const joy = await page.locator('#joy-zone').boundingBox();
  const j = { x: joy.x + joy.width * 0.4, y: joy.y + joy.height * 0.6, id: 1 }, u = { x: L1.rect[0] + L1.rect[2] / 2, y: L1.rect[1] + L1.rect[3] / 2, id: 2 };
  const w0 = await Z(() => window.__zstrike.online.survLo);
  await touch('touchStart', [j]); await page.waitForTimeout(120);
  await touch('touchStart', [j, u]); await page.waitForTimeout(80); await touch('touchEnd', [j]); await page.waitForTimeout(80); await touch('touchEnd', []);
  await page.waitForTimeout(900); const w1 = await Z(() => window.__zstrike.online.survLo);
  const pickOk = !!w1 && JSON.stringify(w1) !== JSON.stringify(w0);
  await page.screenshot({ path: `${OUT}/survive-touch-${name}-pickup.png` });
  // box: tap ✋ with enough points (single tap)
  await goto('box'); await Z(() => { const z = window.__zstrike; z.online.local.players.get(z.online.id).score = 2000; }); await page.waitForTimeout(600);
  const L2 = await layout(); await page.screenshot({ path: `${OUT}/survive-touch-${name}-box.png` });
  await touch('touchStart', [{ x: L2.rect[0] + L2.rect[2] / 2, y: L2.rect[1] + L2.rect[3] / 2, id: 3 }]); await page.waitForTimeout(60); await touch('touchEnd', []);
  await page.waitForTimeout(700); const pts = await Z(() => window.__zstrike.SV.myPts); const boxOk = pts < 2000;
  const r = { name, vp: `${w}x${h}`, pick: L1, box: L2, pickOk, boxOk, errors };
  if (!(L1.visible && L1.onTop && L1.inView && !L1.overlaps.length && L2.visible && L2.onTop && !L2.overlaps.length && pickOk && boxOk && !errors.length)) fail++;
  results.push(r); await ctx.close();
}
console.log(JSON.stringify(results, null, 0).replace(/\},\{"name/g, '},\n{"name')); console.log(fail ? `FAIL ${fail}` : 'ALL OK');
await browser.close(); process.exit(fail ? 1 : 0);
