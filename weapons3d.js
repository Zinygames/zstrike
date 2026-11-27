// Procedural low-poly weapon models (original geometry, no external assets).
// Every model points its barrel along -Z, ~real-world meters, and exposes
// userData.muzzle (local Vector3) for bolts / muzzle flash.
import * as THREE from 'three';

const M = {
  gunmetal: new THREE.MeshPhongMaterial({ color: 0x2b3038, shininess: 50, specular: 0x555c66 }),
  dark: new THREE.MeshPhongMaterial({ color: 0x15171b, shininess: 30, specular: 0x333333 }),
  steel: new THREE.MeshPhongMaterial({ color: 0xb9bec6, shininess: 90, specular: 0xaaaaaa }),
  steelDark: new THREE.MeshPhongMaterial({ color: 0x5d636b, shininess: 70, specular: 0x777777 }),
  red: new THREE.MeshPhongMaterial({ color: 0xd8262b, shininess: 60, emissive: 0x300000 }),
  blueGlow: new THREE.MeshBasicMaterial({ color: 0x46c8ff }),
  blueCore: new THREE.MeshBasicMaterial({ color: 0x9fe6ff }),
  blueFin: new THREE.MeshLambertMaterial({ color: 0x1565c0, emissive: 0x0d47a1 }),
  magenta: new THREE.MeshBasicMaterial({ color: 0xff3df2 }),
};
// Wrapped-leather texture (diagonal bands), drawn on a canvas.
M.leather = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
  g.fillStyle = '#6e4b33'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#4a3020'; for (let i = -16; i < 16; i += 4) for (let y = 0; y < 16; y++) g.fillRect(i + y, y, 1, 1);
  g.fillStyle = '#8a6346'; for (let i = -14; i < 16; i += 4) for (let y = 0; y < 16; y++) g.fillRect(i + y, y, 1, 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3);
  return new THREE.MeshLambertMaterial({ map: t });
})();

function box(g, w, h, l, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
}
function cylZ(g, r, l, x, y, z, mat, seg = 12) { // cylinder along Z
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
}
function cylY(g, r, h, x, y, z, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.position.set(x, y, z); g.add(m); return m;
}
// Box spanning two points in the Y-Z plane (for curved grips).
function seg(g, a, b, w, t, mat) {
  const dy = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dy, dz);
  return box(g, w, t, L + t * 0.6, 0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, mat, Math.atan2(-dy, dz));
}

// ---------------------------------------------------------------- SMG de Plasma
function smg() {
  const g = new THREE.Group();
  // receiver: top + bottom plates joined by pillars -> side openings show the core
  box(g, 0.09, 0.03, 0.42, 0, 0.05, -0.02, M.gunmetal);
  box(g, 0.09, 0.045, 0.42, 0, -0.035, -0.02, M.gunmetal);
  for (const z of [0.13, -0.2]) box(g, 0.092, 0.06, 0.04, 0, 0.007, z, M.dark);
  box(g, 0.094, 0.006, 0.3, 0, 0.033, -0.03, M.blueFin);      // blue trim lines
  box(g, 0.094, 0.006, 0.3, 0, -0.016, -0.03, M.blueFin);
  // glowing energy core + coil rings
  cylZ(g, 0.026, 0.3, 0, 0.008, -0.035, M.blueCore);
  for (const z of [-0.14, -0.06, 0.02, 0.09]) cylZ(g, 0.032, 0.008, 0, 0.008, z, M.blueGlow);
  // front housing + 6-barrel cluster with glowing tips
  box(g, 0.11, 0.11, 0.08, 0, 0.008, -0.26, M.dark);
  cylZ(g, 0.016, 0.1, 0, 0.008, -0.33, M.dark);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 0.036, y = 0.008 + Math.sin(a) * 0.036;
    cylZ(g, 0.015, 0.1, x, y, -0.33, M.gunmetal, 10);
    cylZ(g, 0.011, 0.012, x, y, -0.384, M.blueGlow, 10);
  }
  // rear block with ribbed blue fins
  box(g, 0.1, 0.1, 0.11, 0, 0.0, 0.2, M.dark);
  for (let k = 0; k < 6; k++) box(g, 0.108, 0.075, 0.008, 0, 0.0, 0.16 + k * 0.016, M.blueFin);
  // stock with blue energy cells
  box(g, 0.08, 0.1, 0.13, 0, -0.01, 0.32, M.gunmetal);
  box(g, 0.084, 0.11, 0.02, 0, -0.01, 0.39, M.dark);
  for (const x of [-0.043, 0.043]) for (const z of [0.29, 0.315, 0.34]) cylY(g, 0.009, 0.075, x, -0.01, z, M.blueGlow, 8);
  // top rail with notches, front sight
  box(g, 0.04, 0.012, 0.42, 0, 0.071, -0.02, M.dark);
  for (let z = -0.21; z <= 0.18; z += 0.03) box(g, 0.046, 0.007, 0.01, 0, 0.08, z, M.gunmetal);
  box(g, 0.012, 0.03, 0.012, 0, 0.09, -0.24, M.dark);
  // scope with glowing lens
  for (const z of [-0.03, 0.05]) box(g, 0.02, 0.03, 0.02, 0, 0.095, z, M.dark);
  cylZ(g, 0.024, 0.13, 0, 0.122, 0.01, M.gunmetal);
  cylZ(g, 0.027, 0.03, 0, 0.122, -0.055, M.dark);
  cylZ(g, 0.021, 0.004, 0, 0.122, -0.071, M.blueGlow);
  cylZ(g, 0.016, 0.004, 0, 0.122, 0.077, M.blueFin);
  box(g, 0.02, 0.016, 0.02, 0, 0.152, 0.01, M.dark);
  // grip, trigger guard, under-barrel light
  box(g, 0.04, 0.11, 0.05, 0, -0.1, 0.13, M.dark, -0.28);
  box(g, 0.01, 0.006, 0.07, 0, -0.085, 0.07, M.dark);
  cylZ(g, 0.014, 0.06, 0, -0.075, -0.18, M.gunmetal);
  cylZ(g, 0.011, 0.004, 0, -0.075, -0.212, M.blueGlow);
  g.userData.muzzle = new THREE.Vector3(0, 0.008, -0.4);
  return g;
}

// ---------------------------------------------------------------- Pistola de Plasma
function pistol() {
  const g = new THREE.Group();
  // flat-top slide: brushed steel with a dark top plate
  box(g, 0.05, 0.036, 0.3, 0, 0.04, -0.02, M.steel);
  box(g, 0.052, 0.01, 0.29, 0, 0.063, -0.025, M.dark);
  box(g, 0.054, 0.004, 0.12, 0, 0.045, 0.03, M.steelDark);   // groove line
  box(g, 0.056, 0.022, 0.016, 0, 0.055, 0.135, M.red);       // red rear tips
  box(g, 0.02, 0.014, 0.014, 0, 0.074, 0.12, M.red);
  // lower frame + front rail
  box(g, 0.046, 0.032, 0.2, 0, 0.005, 0.0, M.steelDark);
  box(g, 0.05, 0.014, 0.16, 0, -0.012, -0.12, M.dark);
  // slotted ring
  cylZ(g, 0.031, 0.034, 0, 0.022, -0.075, M.dark, 14);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, s = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.026), M.steel);
    s.position.set(Math.cos(a) * 0.031, 0.022 + Math.sin(a) * 0.031, -0.075); s.rotation.z = a; g.add(s);
  }
  // exposed energy core with red ring + two rods with red collars
  cylZ(g, 0.021, 0.1, 0, 0.022, -0.14, M.steel, 14);
  cylZ(g, 0.013, 0.104, 0, 0.022, -0.14, M.steelDark, 10);
  cylZ(g, 0.025, 0.012, 0, 0.022, -0.17, M.red, 14);
  for (const y of [0.052, -0.006]) {
    cylZ(g, 0.0055, 0.15, 0.0, y, -0.15, M.steel, 8);
    cylZ(g, 0.0095, 0.022, 0.0, y, -0.13, M.red, 8);
    cylZ(g, 0.004, 0.012, 0.0, y, -0.228, M.dark, 6);
  }
  // small blue indicator light (both sides)
  for (const x of [-0.027, 0.027]) box(g, 0.002, 0.004, 0.016, x, 0.03, 0.02, M.blueGlow);
  // curved leather grip looping into the trigger guard, steel pommel
  const grip = [[-0.005, 0.075], [-0.05, 0.088], [-0.095, 0.105], [-0.135, 0.118]];
  for (let i = 0; i < grip.length - 1; i++) seg(g, grip[i], grip[i + 1], 0.036, 0.034, M.leather);
  const pommel = [[-0.135, 0.118], [-0.162, 0.11], [-0.172, 0.08], [-0.162, 0.05]];
  for (let i = 0; i < pommel.length - 1; i++) seg(g, pommel[i], pommel[i + 1], 0.04, 0.02, M.steel);
  seg(g, [-0.158, 0.048], [-0.02, -0.06], 0.022, 0.016, M.leather); // guard bar to the frame
  box(g, 0.008, 0.03, 0.008, 0, -0.025, 0.02, M.dark, 0.3);        // trigger
  g.userData.muzzle = new THREE.Vector3(0, 0.022, -0.2);
  return g;
}

// ---------------------------------------------------------------- Lanzacohetes SOL
function rocket() {
  const g = new THREE.Group();
  cylZ(g, 0.055, 0.62, 0, 0.0, -0.02, M.gunmetal, 12);
  cylZ(g, 0.062, 0.05, 0, 0.0, -0.32, M.dark, 12);
  cylZ(g, 0.05, 0.006, 0, 0.0, -0.346, M.magenta, 12);
  for (const z of [-0.15, 0.05, 0.2]) cylZ(g, 0.058, 0.012, 0, 0, z, M.magenta, 12);
  box(g, 0.04, 0.1, 0.05, 0, -0.09, 0.08, M.dark, -0.25);
  box(g, 0.03, 0.04, 0.12, 0, 0.07, -0.05, M.dark);
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.36);
  return g;
}

const BUILDERS = { pistol, smg, rocket };
import { makeVoxelWeapon } from './voxguns.js';
import { WEAPONS } from './config.js';
export function makeWeaponModel(id) {
  if (BUILDERS[id]) return BUILDERS[id]();
  const def = WEAPONS.find((w) => w.id === id);
  return def ? makeVoxelWeapon(def) : pistol();
}
