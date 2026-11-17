import { createContext, useContext, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// All geometries and materials are created once per scene and shared by every mesh (few draw calls,
// no per-frame allocation). They are disposed when the scene unmounts.

const m4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const eul = new THREE.Euler();
const vec = new THREE.Vector3();
const scl = new THREE.Vector3();

/** Clone `geometry`, apply a transform, return the transformed copy. */
function part(geometry, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const g = geometry.clone();
  m4.compose(vec.set(...pos), quat.setFromEuler(eul.set(...rot)), scl.set(...scale));
  g.applyMatrix4(m4);
  return g;
}

const merged = (list) => {
  const geos = list.map((p) => (Array.isArray(p) ? part(...p) : p));
  const out = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return out;
};

const PLANTS = [[-0.45, -0.3], [0.42, -0.22], [0, 0.45]];

function createAssets() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  const lowSphere = new THREE.SphereGeometry(1, 6, 4);
  const cone6 = new THREE.ConeGeometry(1, 1, 6);
  const cone8 = new THREE.ConeGeometry(1, 1, 8);
  const cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6);
  const cyl10 = new THREE.CylinderGeometry(1, 1, 1, 10);
  const taper8 = new THREE.CylinderGeometry(0.55, 1, 1, 8);
  const taper10 = new THREE.CylinderGeometry(1, 0.62, 1, 10);

  // Gable roof: triangle (apex up) extruded along z, centred on the origin.
  const tri = new THREE.Shape();
  tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1); tri.closePath();
  const roof = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
  roof.translate(0, 0, -0.5);

  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const disc = new THREE.CircleGeometry(1, 24);
  disc.rotateX(-Math.PI / 2);

  const leafCone = new THREE.ConeGeometry(0.075, 0.6, 5);
  const carrotLeaves = merged(
    PLANTS.flatMap(([px, pz], pi) =>
      [0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + pi * 1.3;
        return [leafCone, [px + Math.sin(a) * 0.08, 0.3, pz + Math.cos(a) * 0.08], [0.5 * Math.cos(a), 0, -0.5 * Math.sin(a)]];
      }),
    ),
  );
  const rootCone = new THREE.ConeGeometry(0.17, 0.55, 6);
  const carrotRoots = merged(PLANTS.map(([px, pz]) => [rootCone, [px, -0.05, pz], [Math.PI, 0, 0]]));

  const stem = new THREE.CylinderGeometry(0.045, 0.05, 1, 5);
  const tomatoFoliage = merged([
    [stem, [0, 0.5, 0], [0, 0, 0], [1, 1, 1]],
    [lowSphere, [0, 0.22, 0], [0, 0, 0], [0.5, 0.2, 0.44]],
    [lowSphere, [0.2, 0.4, 0.02], [0, 0.5, 0.3], [0.34, 0.14, 0.26]],
    [lowSphere, [-0.22, 0.58, 0.05], [0, -0.4, -0.3], [0.34, 0.14, 0.26]],
    [lowSphere, [0.06, 0.78, -0.2], [0.3, 0.8, 0.2], [0.32, 0.13, 0.25]],
    [lowSphere, [-0.1, 0.96, 0.14], [0, 0.2, 0.1], [0.3, 0.13, 0.24]],
  ]);
  const tomatoFruits = merged(
    [[0.3, 0.46, 0.14], [-0.3, 0.62, 0.12], [0.14, 0.42, -0.3], [-0.06, 0.82, 0.26]].map((p) => [sphere, p, [0, 0, 0], [0.17, 0.17, 0.17]]),
  );

  const pumpkinBody = merged([
    [sphere, [0, 0.38, 0], [0, 0, 0], [0.5, 0.46, 0.6]],
    [sphere, [0, 0.38, 0], [0, Math.PI / 3, 0], [0.5, 0.46, 0.6]],
    [sphere, [0, 0.38, 0], [0, -Math.PI / 3, 0], [0.5, 0.46, 0.6]],
  ]);
  const pumpkinStem = merged([[new THREE.CylinderGeometry(0.07, 0.1, 0.3, 5), [0.02, 0.86, 0], [0.15, 0, 0.1], [1, 1, 1]]]);
  const pumpkinLeaves = merged([
    [lowSphere, [0.78, 0.1, 0.2], [0, 0.4, 0.15], [0.4, 0.06, 0.3]],
    [lowSphere, [-0.7, 0.1, 0.4], [0, -0.5, -0.15], [0.38, 0.06, 0.28]],
    [lowSphere, [-0.1, 0.1, -0.8], [0, 1.6, 0.1], [0.4, 0.06, 0.3]],
    [new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), [0.4, 0.05, 0.1], [0, 0, Math.PI / 2], [1, 1, 1]],
  ]);

  const blades = merged([
    [box, [0, 0, 0], [0, 0, 0], [0.16, 3.7, 0.06]],
    [box, [0, 0, 0], [0, 0, Math.PI / 2], [0.16, 3.7, 0.06]],
    [box, [0.3, 1.1, 0.02], [0, 0, 0], [0.5, 1.2, 0.03]],
    [box, [-0.3, -1.1, 0.02], [0, 0, 0], [0.5, 1.2, 0.03]],
    [box, [1.1, -0.3, 0.02], [0, 0, 0], [1.2, 0.5, 0.03]],
    [box, [-1.1, 0.3, 0.02], [0, 0, 0], [1.2, 0.5, 0.03]],
  ]);

  const ridge = merged([-0.5, 0, 0.5].map((z) => [box, [0, 0, z], [0, 0, 0], [1.4, 0.04, 0.12]]));

  const geo = {
    box, sphere, lowSphere, cone6, cone8, cyl6, cyl10, taper8, taper10, roof, plane, disc,
    oct: new THREE.OctahedronGeometry(1, 0), ico: new THREE.IcosahedronGeometry(1, 0),
    carrotLeaves, carrotRoots, tomatoFoliage, tomatoFruits, pumpkinBody, pumpkinStem, pumpkinLeaves, blades, ridge,
    basketHandle: new THREE.TorusGeometry(0.4, 0.045, 5, 10, Math.PI),
  };

  const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0, ...extra });
  const mat = {
    grass: lit('#8fcf6a'), dirt: lit('#b98a5a'), dirtDark: lit('#9a6f43'),
    frame: lit('#b57d44'), soil: lit('#7a4b26'), furrow: lit('#5f381b'),
    wall: lit('#f6e6c4'), roofRed: lit('#c8573f'), roofBrown: lit('#7d5a46'), barn: lit('#b9473c'), trim: lit('#fff4dc'),
    door: lit('#8a5a33'), window: lit('#9fd3e8', { roughness: 0.4 }), stone: lit('#a9a49a'),
    wood: lit('#a8723b'), woodDark: lit('#7e5128'),
    leaf: lit('#5faa43'), leafDark: lit('#4a9136'), leafLight: lit('#7cc157'), trunk: lit('#8a5a33'),
    cloud: lit('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.28, transparent: true, opacity: 0.95 }),
    carrot: lit('#f28c28'), tomatoRed: lit('#e5493a', { roughness: 0.55 }), tomatoGreen: lit('#8cc152'),
    pumpkin: lit('#f58a20'), pumpkinGreen: lit('#9bbd4a'), stem: lit('#4f8f3a'),
    path: lit('#d9c08e'), skin: lit('#f2c9a0'), shirt: lit('#4f86c6'), pants: lit('#7a5a3a'), hat: lit('#e8c46b'), hatBand: lit('#b9473c'),
    blades: lit('#f6e7c8'), basket: lit('#c8924f'), hay: lit('#e9c66a'),
    highlight: new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    glow: new THREE.MeshBasicMaterial({ color: '#ffd95a', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }),
    sparkle: new THREE.MeshBasicMaterial({ color: '#fff2a0', transparent: true, opacity: 0.95, depthWrite: false }),
    puff: new THREE.MeshBasicMaterial({ color: '#f1deb8', transparent: true, opacity: 0.4, depthWrite: false }),
  };

  return {
    geo,
    mat,
    dispose() {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mat).forEach((m) => m.dispose());
    },
  };
}

const AssetsContext = createContext(null);

export function AssetsProvider({ children }) {
  const assets = useMemo(createAssets, []);
  useEffect(() => () => assets.dispose(), [assets]);
  return <AssetsContext.Provider value={assets}>{children}</AssetsContext.Provider>;
}

export const useAssets = () => useContext(AssetsContext);

/** A mesh that uses a shared geometry and material by name. `dispose={null}`: the provider owns disposal. */
export function Part({ geo, mat, cast = false, receive = false, ...props }) {
  const a = useAssets();
  return <mesh geometry={a.geo[geo]} material={a.mat[mat]} castShadow={cast} receiveShadow={receive} dispose={null} {...props} />;
}
