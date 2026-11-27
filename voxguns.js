// ZStrike v2 voxel weapons: original blocky models built from boxes (no external assets).
// One merged mesh for the lit voxels + one for the glowing (unlit) voxels per weapon.
// Barrel points along -Z, sizes ~meters, userData.muzzle = local barrel tip.
import * as THREE from 'three';

// tiny pixel-noise texture multiplied with vertex colours -> pixel-art shading
const noiseTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d');
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { const v = 205 + Math.floor(r() * 50); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, 8, 1); g.fillRect(0, 0, 1, 8);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const litMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: noiseTex });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

class Vox {
  constructor() { this.lit = []; this.glow = []; }
  // box w,h,l centred at x,y,z; optional rotation about X (rx) and Z (rz)
  b(w, h, l, x, y, z, color, glow = false, rx = 0, rz = 0, ry = 0) {
    (glow ? this.glow : this.lit).push({ w, h, l, x, y, z, color, rx, rz, ry }); return this;
  }
  build() {
    const g = new THREE.Group();
    for (const [list, mat] of [[this.lit, litMat], [this.glow, glowMat]]) {
      if (!list.length) continue;
      const n = unitBox.attributes.position.count;
      const pos = new Float32Array(list.length * n * 3), nor = new Float32Array(list.length * n * 3), uv = new Float32Array(list.length * n * 2), col = new Float32Array(list.length * n * 3);
      const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), c = new THREE.Color();
      list.forEach((bx, k) => {
        m4.compose(new THREE.Vector3(bx.x, bx.y, bx.z), q.setFromEuler(e.set(bx.rx, bx.ry, bx.rz)), new THREE.Vector3(bx.w, bx.h, bx.l));
        nm.getNormalMatrix(m4); c.set(bx.color);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(unitBox.attributes.position, i).applyMatrix4(m4); pos.set([v.x, v.y, v.z], (k * n + i) * 3);
          v.fromBufferAttribute(unitBox.attributes.normal, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (k * n + i) * 3);
          uv.set([unitBox.attributes.uv.getX(i), unitBox.attributes.uv.getY(i)], (k * n + i) * 2);
          col.set([c.r, c.g, c.b], (k * n + i) * 3);
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      g.add(new THREE.Mesh(geo, mat));
    }
    return g;
  }
}
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex(); };
const RAINBOW = [0xff3b3b, 0xff9a1f, 0xffe14a, 0x3aff8a, 0x3fa9ff, 0xb04dff];
const DARK = 0x18191c;

// ---------------------------------------------------------------- class builders
function grip(v, z, col, ang = -0.3, len = 0.13) { v.b(0.045, len, 0.06, 0, -0.06 - len / 2 + 0.02, z, col, false, ang); }
function scope(v, z, len, s, y = 0.085) {
  v.b(0.05, 0.05, len, 0, y, z, shade(s.accent, 0.8)); v.b(0.062, 0.062, 0.05, 0, y, z - len / 2, shade(s.accent, 0.6));
  v.b(0.062, 0.062, 0.05, 0, y, z + len / 2, shade(s.accent, 0.6));
  v.b(0.04, 0.04, 0.01, 0, y, z - len / 2 - 0.028, s.glow, true); // lens
  v.b(0.02, 0.03, 0.03, 0, y - 0.035, z - len / 4, DARK); v.b(0.02, 0.03, 0.03, 0, y - 0.035, z + len / 4, DARK);
}
function bipod(v, z, y = -0.02) {
  v.b(0.014, 0.2, 0.014, 0.04, y - 0.1, z, DARK, false, 0, 0.35); v.b(0.014, 0.2, 0.014, -0.04, y - 0.1, z, DARK, false, 0, -0.35);
}
function laser(v, x, y, z, s) { v.b(0.025, 0.025, 0.06, x, y, z, DARK); v.b(0.006, 0.006, 0.9, x, y, z - 0.48, s.glow, true); }
function suppressor(v, z, s, r = 0.045) { v.b(r, r, 0.2, 0, 0.0, z - 0.1, shade(s.accent, 1)); v.b(r * 0.7, r * 0.7, 0.01, 0, 0, z - 0.205, DARK); }

function sniper(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  v.b(0.07, 0.09, 0.46, 0, 0, -0.02, B);                     // receiver
  v.b(0.075, 0.035, 0.46, 0, -0.055, -0.02, shade(B, 0.75));   // lower
  v.b(0.07, 0.11, 0.3, 0, -0.03, 0.34, B); v.b(0.07, 0.04, 0.12, 0, -0.1, 0.42, A); // stock + butt
  v.b(0.06, 0.03, 0.05, 0, 0.04, 0.2, A);                      // cheek rest
  v.b(0.05, 0.07, 0.06, 0, -0.1, -0.05, A);                    // mag
  grip(v, 0.12, A); v.b(0.02, 0.03, 0.03, 0.045, 0.01, 0.06, A); // bolt handle
  if (f.includes('wavy')) for (let i = 0; i < 7; i++) v.b(0.034, 0.034, 0.1, 0, Math.sin(i * 1.3) * 0.022, -0.3 - i * 0.09, i % 2 ? s.glow : B, i % 2 === 1);
  else { v.b(0.032, 0.032, 0.62, 0, 0.005, -0.55, shade(B, 0.6)); v.b(0.07, 0.06, 0.25, 0, -0.01, -0.33, B); }
  if (f.includes('coils')) for (let i = 0; i < 4; i++) v.b(0.05, 0.05, 0.025, 0, 0.005, -0.5 - i * 0.07, s.glow, true);
  if (f.includes('brake')) v.b(0.05, 0.045, 0.07, 0, 0.005, -0.88, DARK);
  if (f.includes('orb')) { v.b(0.09, 0.09, 0.09, 0, 0.0, -0.36, s.glow, true); v.b(0.11, 0.02, 0.02, 0, 0, -0.36, A); v.b(0.02, 0.11, 0.02, 0, 0, -0.36, A); }
  if (f.includes('bipod')) bipod(v, -0.42, -0.03);
  scope(v, 0.0, 0.28, s);
  v.b(0.008, 0.008, 0.18, 0.036, 0.035, -0.15, s.glow, true); // glow trim
  return new THREE.Vector3(0, 0.005, f.includes('wavy') ? -0.93 : -0.88);
}
function smg(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  if (f.includes('bullpup')) {
    v.b(0.075, 0.12, 0.5, 0, 0.0, 0.0, B); v.b(0.077, 0.05, 0.28, 0, -0.07, 0.08, shade(B, 0.7)); // body + hollow look
    v.b(0.04, 0.05, 0.08, 0, -0.09, -0.15, A); v.b(0.05, 0.02, 0.32, 0, 0.068, 0.02, A); // fore grip + top mag
    v.b(0.03, 0.03, 0.12, 0, 0.0, -0.3, DARK); v.b(0.03, 0.03, 0.02, 0, 0.09, -0.15, s.glow, true);
    return new THREE.Vector3(0, 0, -0.37);
  }
  v.b(0.06, 0.08, 0.3, 0, 0, 0, B); v.b(0.062, 0.03, 0.3, 0, 0.045, 0, shade(B, 0.8));
  v.b(0.026, 0.026, 0.16, 0, 0.01, -0.22, DARK);
  grip(v, 0.08, A);
  const magL = f.includes('longmag') ? 0.24 : 0.17;
  v.b(0.035, magL, 0.045, 0, -0.04 - magL / 2, -0.07, f.includes('rainbow') ? RAINBOW[2] : A, false, 0.1);
  if (f.includes('rainbow')) RAINBOW.forEach((c, i) => v.b(0.064, 0.012, 0.04, 0, 0.0 + (i - 2.5) * 0.012, -0.08 + (i % 2) * 0.1, c, true));
  if (f.includes('foldstock')) { v.b(0.012, 0.012, 0.22, 0.025, -0.01, 0.25, DARK); v.b(0.012, 0.012, 0.22, -0.025, -0.01, 0.25, DARK); v.b(0.06, 0.06, 0.015, 0, -0.03, 0.36, DARK); }
  else if (f.includes('stock') || f.includes('rainbow')) v.b(0.05, 0.07, 0.18, 0, -0.01, 0.23, A);
  if (f.includes('crystal')) for (let i = 0; i < 6; i++) v.b(0.03, 0.09, 0.03, (i % 2 ? 1 : -1) * 0.035, 0.05 + (i % 3) * 0.015, -0.1 + i * 0.045, s.glow, true, 0.4, (i % 2 ? -1 : 1) * 0.5);
  if (f.includes('tank')) { v.b(0.05, 0.05, 0.12, 0, 0.08, 0.0, s.glow, true); v.b(0.06, 0.02, 0.14, 0, 0.11, 0.0, A); }
  if (f.includes('suppressor')) suppressor(v, -0.29, s, 0.042); else v.b(0.034, 0.034, 0.03, 0, 0.01, -0.3, A);
  v.b(0.008, 0.008, 0.2, 0.031, 0.02, 0.0, s.glow, true);
  return new THREE.Vector3(0, 0.01, f.includes('suppressor') ? -0.5 : -0.31);
}
function rifle(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  const pal = f.includes('camo') ? [B, shade(B, 0.7), A, 0x8a7a4a] : null;
  const C = (i) => (pal ? pal[i % pal.length] : B);
  v.b(0.065, 0.09, 0.36, 0, 0, 0, C(0)); v.b(0.066, 0.03, 0.2, 0, 0.055, 0.05, C(1));
  v.b(0.07, 0.075, 0.24, 0, -0.005, -0.3, f.includes('wood') ? 0x8a5a2a : C(2)); // handguard
  v.b(0.03, 0.03, 0.22, 0, 0.01, -0.52, f.includes('redbarrel') ? s.accent : DARK); v.b(0.04, 0.04, 0.05, 0, 0.01, -0.63, DARK);
  grip(v, 0.1, A);
  if (f.includes('curvedmag')) { v.b(0.04, 0.1, 0.06, 0, -0.09, -0.07, A, false, 0.15); v.b(0.04, 0.1, 0.06, 0, -0.18, -0.04, A, false, 0.45); }
  else v.b(0.04, 0.16, 0.06, 0, -0.11, -0.06, A, false, 0.15);
  v.b(0.055, 0.08, 0.22, 0, -0.01, 0.28, f.includes('wood') ? 0x8a5a2a : A); v.b(0.06, 0.11, 0.04, 0, -0.03, 0.4, C(3));
  if (f.includes('sight')) { v.b(0.04, 0.05, 0.08, 0, 0.09, -0.02, DARK); v.b(0.03, 0.03, 0.01, 0, 0.1, -0.065, s.glow, true); }
  if (f.includes('laser')) laser(v, 0.045, -0.01, -0.33, s);
  if (f.includes('ugl')) { v.b(0.05, 0.05, 0.2, 0, -0.075, -0.32, DARK); v.b(0.035, 0.035, 0.01, 0, -0.075, -0.425, s.glow, true); }
  if (f.includes('redbarrel')) v.b(0.072, 0.02, 0.24, 0, 0.03, -0.3, s.accent);
  v.b(0.008, 0.008, 0.3, 0.035, 0.02, -0.05, s.glow, true);
  return new THREE.Vector3(0, 0.01, -0.66);
}
function lmg(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  v.b(0.09, 0.12, 0.42, 0, 0, 0, B); v.b(0.092, 0.04, 0.3, 0, 0.075, -0.02, shade(B, 0.75)); // receiver + top cover
  v.b(0.085, 0.09, 0.3, 0, -0.005, -0.36, f.includes('energy') ? A : shade(B, 0.85));
  v.b(0.045, 0.045, 0.3, 0, 0.01, -0.62, DARK); v.b(0.06, 0.06, 0.08, 0, 0.01, -0.8, DARK);
  grip(v, 0.12, A); v.b(0.065, 0.1, 0.24, 0, -0.02, 0.32, A);
  if (f.includes('handle')) { v.b(0.02, 0.06, 0.02, 0, 0.12, -0.1, DARK); v.b(0.02, 0.02, 0.14, 0, 0.15, -0.17, DARK); v.b(0.02, 0.06, 0.02, 0, 0.12, -0.24, DARK); }
  if (f.includes('belt')) { v.b(0.12, 0.13, 0.15, -0.01, -0.13, -0.05, shade(A, 0.7)); for (let i = 0; i < 5; i++) v.b(0.02, 0.035, 0.02, 0.05 + i * 0.012, -0.03 - i * 0.03, -0.04, 0xffc46b); }
  if (f.includes('boxmag')) v.b(0.1, 0.14, 0.14, 0, -0.13, -0.05, A);
  if (f.includes('drum')) { v.b(0.11, 0.16, 0.16, 0, -0.14, -0.05, A); v.b(0.112, 0.06, 0.06, 0, -0.14, -0.05, s.glow, true); }
  if (f.includes('energy')) { for (let i = 0; i < 4; i++) v.b(0.095, 0.02, 0.04, 0, 0.03, -0.25 - i * 0.07, s.glow, true); v.b(0.07, 0.07, 0.1, 0, -0.1, -0.05, s.glow, true); }
  if (f.includes('scope')) scope(v, 0.0, 0.2, s, 0.12);
  if (f.includes('bipod')) bipod(v, -0.55, -0.02);
  v.b(0.008, 0.008, 0.3, 0.047, 0.02, -0.05, s.glow, true);
  return new THREE.Vector3(0, 0.01, -0.85);
}
function pistolM(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  v.b(0.04, 0.045, 0.22, 0, 0.02, -0.03, B); v.b(0.042, 0.035, 0.18, 0, -0.018, -0.02, f.includes('skull') ? A : shade(B, 0.7));
  v.b(0.04, 0.12, 0.055, 0, -0.08, 0.05, A, false, -0.25);
  if (f.includes('skull')) { v.b(0.044, 0.03, 0.03, 0, 0.025, -0.06, 0xffffff); v.b(0.045, 0.008, 0.008, 0, 0.03, -0.068, DARK); v.b(0.042, 0.03, 0.05, 0, -0.08, 0.05, 0x2a4ad8, false, -0.25); }
  if (f.includes('suppressor')) suppressor(v, -0.14, s, 0.035);
  if (f.includes('laser')) laser(v, 0, -0.045, -0.08, s);
  if (f.includes('extmag')) v.b(0.032, 0.12, 0.04, 0, -0.19, 0.08, A, false, -0.25);
  if (f.includes('foldstock')) { v.b(0.012, 0.012, 0.2, 0, -0.06, 0.18, DARK); v.b(0.012, 0.07, 0.012, 0, -0.09, 0.28, DARK); }
  v.b(0.006, 0.006, 0.12, 0.022, 0.03, -0.03, s.glow, true);
  return new THREE.Vector3(0, 0.02, f.includes('suppressor') ? -0.35 : -0.15);
}
function launcher(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  if (f.includes('double')) {
    for (const x of [-0.06, 0.06]) { v.b(0.11, 0.11, 0.9, x, 0, -0.1, B); v.b(0.115, 0.03, 0.1, x, 0, -0.45, A); v.b(0.115, 0.03, 0.1, x, 0, 0.2, A); v.b(0.08, 0.08, 0.01, x, 0, -0.556, DARK); }
    v.b(0.04, 0.12, 0.05, 0, -0.12, 0.05, 0x2a4ad8, false, -0.2); v.b(0.04, 0.1, 0.05, 0, -0.11, -0.22, DARK);
    v.b(0.03, 0.06, 0.06, 0, 0.09, -0.15, s.glow, true);
    return new THREE.Vector3(0.06, 0, -0.58);
  }
  const r = f.includes('mouth') ? 0.16 : 0.1;
  v.b(r, r, 0.85, 0, 0, -0.05, B); v.b(r + 0.01, r + 0.01, 0.06, 0, 0, 0.35, A); v.b(r + 0.01, r + 0.01, 0.12, 0, 0, -0.18, f.includes('pixel') ? A : shade(B, 0.7));
  v.b(0.04, 0.11, 0.05, 0, -r / 2 - 0.05, 0.05, DARK, false, -0.2); v.b(0.04, 0.1, 0.05, 0, -r / 2 - 0.05, -0.2, DARK);
  v.b(0.03, 0.05, 0.08, 0.0, r / 2 + 0.03, -0.12, DARK); v.b(0.02, 0.02, 0.01, 0, r / 2 + 0.05, -0.165, s.glow, true);
  if (f.includes('warhead')) { v.b(0.07, 0.07, 0.08, 0, 0, -0.52, 0x8fbf3a); v.b(0.05, 0.05, 0.06, 0, 0, -0.59, 0xb4ff3a); v.b(0.025, 0.025, 0.04, 0, 0, -0.64, 0xd8ff8a); }
  if (f.includes('mouth')) {
    v.b(r + 0.02, 0.03, 0.08, 0, r / 2, -0.47, A); v.b(r + 0.02, 0.03, 0.08, 0, -r / 2, -0.47, A);
    for (let i = 0; i < 4; i++) { v.b(0.022, 0.035, 0.02, -0.06 + i * 0.04, r / 2 - 0.03, -0.5, 0xffffff); v.b(0.022, 0.035, 0.02, -0.04 + i * 0.04, -r / 2 + 0.03, -0.5, 0xffffff); }
    v.b(0.03, 0.03, 0.01, 0.05, 0.05, -0.2, s.glow, true); v.b(0.03, 0.03, 0.01, -0.05, 0.05, -0.2, s.glow, true);
    v.b(0.165, 0.06, 0.06, 0, 0.02, 0.1, 0xf4f4f4); // skull plate
  }
  if (f.includes('pixel')) for (let i = 0; i < 5; i++) v.b(r + 0.012, 0.02, 0.04, 0, (i % 2 ? 1 : -1) * 0.02, -0.4 + i * 0.15, s.glow, true);
  return new THREE.Vector3(0, 0, f.includes('warhead') ? -0.68 : -0.5);
}
function bow(v, s) {
  const B = s.body, A = s.accent, f = s.f;
  v.b(0.04, 0.2, 0.05, 0, 0, 0, B); v.b(0.045, 0.08, 0.055, 0, 0, 0.0, A); // riser + grip
  for (const sg of [1, -1]) {
    v.b(0.03, 0.22, 0.04, 0, sg * 0.19, -0.05, B, false, sg * 0.45); v.b(0.028, 0.16, 0.035, 0, sg * 0.35, -0.03, s.glow, true, sg * -0.25);
    v.b(0.035, 0.04, 0.04, 0, sg * 0.43, 0.0, A);
    if (f.includes('hearts')) { v.b(0.05, 0.04, 0.05, 0, sg * 0.26, -0.1, 0xff3d8a); v.b(0.03, 0.03, 0.03, 0, sg * 0.23, -0.13, 0xff3d8a); }
  }
  v.b(0.005, 0.86, 0.005, 0, 0, 0.06, 0xffffff, true); // string
  v.b(0.012, 0.012, 0.62, 0, 0, -0.22, 0xdddddd); v.b(0.024, 0.024, 0.05, 0, 0, -0.55, s.glow, true); // arrow
  v.b(0.003, 0.03, 0.05, 0, 0.012, 0.06, A); v.b(0.003, 0.03, 0.05, 0, -0.012, 0.06, A);
  return new THREE.Vector3(0, 0, -0.56);
}
const BUILD = { sniper, smg, rifle, lmg, pistol: pistolM, launcher, bow };

const modelCache = new Map();
export function makeVoxelWeapon(def) {
  if (!modelCache.has(def.id)) modelCache.set(def.id, buildVoxelWeapon(def));
  const src = modelCache.get(def.id), g = src.clone(true);
  g.userData = { muzzle: src.userData.muzzle.clone(), muzzle2: src.userData.muzzle2?.clone() };
  return g;
}
function buildVoxelWeapon(def) {
  const v = new Vox();
  const muzzle = BUILD[def.cls](v, def.style);
  const g = v.build(); g.userData.muzzle = muzzle;
  if (def.dual) { // second gun for dual pistols (left hand), alternates muzzle
    const v2 = new Vox(); BUILD[def.cls](v2, def.style); const g2 = v2.build(); g2.position.set(-0.32, 0, 0.02); g2.name = 'left'; g.add(g2);
    g.userData.muzzle2 = muzzle.clone().add(new THREE.Vector3(-0.32, 0, 0.02));
  }
  return g;
}

// Side-view pixel icon (data URL) drawn straight from the voxel boxes: used in the
// loadout cards, weapon picker, kill feed and the UNLOCKED popup.
const iconCache = new Map();
export function weaponIcon(def, W = 96, H = 40) {
  const key = def.id + W + 'x' + H; if (iconCache.has(key)) return iconCache.get(key);
  const v = new Vox(); BUILD[def.cls](v, def.style);
  const all = [...v.lit.map((b) => ({ ...b, glow: false })), ...v.glow.map((b) => ({ ...b, glow: true }))].sort((a, b) => a.x - b.x);
  let z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const b of all) { const r = Math.max(b.l, b.h) / 2; z0 = Math.min(z0, b.z - r); z1 = Math.max(z1, b.z + r); y0 = Math.min(y0, b.y - r); y1 = Math.max(y1, b.y + r); }
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const s = Math.min((W - 6) / (z1 - z0), (H - 6) / (y1 - y0)), cx = W / 2, cy = H / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
  g.imageSmoothingEnabled = false;
  for (const b of all) {
    g.save(); g.translate(cx + (mz - b.z) * s, cy - (b.y - my) * s); g.rotate(b.rx);
    const col = new THREE.Color(b.color); const lx = b.x > 0 ? 1.12 : 0.92;
    g.fillStyle = '#' + (b.glow ? col : col.multiplyScalar(lx)).getHexString();
    g.fillRect(-b.l * s / 2, -b.h * s / 2, Math.max(1, b.l * s), Math.max(1, b.h * s));
    if (!b.glow && b.l * s > 3 && b.h * s > 3) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-b.l * s / 2, b.h * s / 2 - 1, b.l * s, 1); }
    g.restore();
  }
  const url = c.toDataURL(); iconCache.set(key, url); return url;
}
