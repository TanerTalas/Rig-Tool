import * as THREE from 'three';

import { estimateMidline, humanoidTemplate, SPINE_LANDMARKS } from './landmarks.js';

/**
 * Landmark denetimi.
 *
 * Neden gerekiyor: yanlış yerleştirilmiş bir landmark seti gözle bakınca
 * doğru görünebiliyor. Sol kol ile sağ kol yer değiştirmişse iskelet yine
 * makul bir insansı iskelet gibi çizilir, hata ancak Aşama 6'da Mixamo
 * animasyonu yanlış kolu oynatınca fark edilir. Bu modül o tür hataları
 * sayısal olarak yakalıyor.
 *
 * Seviyeler:
 * - error: iskelet bu haliyle kullanılamaz
 * - warn : çalışır ama sonucu bozabilir, gözle kontrol edilmeli
 */

// Uzuv oranı bu aralığın dışındaysa uyarı. Chibi orantılar geniş bir bant
// gerektiriyor, o yüzden eşik gevşek tutuldu.
const RATIO_MIN = 0.65;
const RATIO_MAX = 1.55;

// Sol/sağ kemik uzunluk farkı bu oranı geçerse uyarı.
const SYMMETRY_TOLERANCE = 0.15;

// Yön tespiti bu eşiğin altında güvenilmez sayılıyor.
const FACING_CONFIDENCE = 0.01;

const SPINE_ORDER = SPINE_LANDMARKS;

const MIRROR_PAIRS = [
  { left: 'leftClavicle', right: 'rightClavicle', group: 'arms' },
  { left: 'leftShoulder', right: 'rightShoulder', group: 'arms' },
  { left: 'leftElbow', right: 'rightElbow', group: 'arms' },
  { left: 'leftWrist', right: 'rightWrist', group: 'arms' },
  { left: 'leftHip', right: 'rightHip', group: 'legs' },
  { left: 'leftKnee', right: 'rightKnee', group: 'legs' },
  { left: 'leftAnkle', right: 'rightAnkle', group: 'legs' },
];

const PROPORTIONS = [
  { name: 'sol kol', a: ['leftShoulder', 'leftElbow'], b: ['leftElbow', 'leftWrist'] },
  { name: 'sağ kol', a: ['rightShoulder', 'rightElbow'], b: ['rightElbow', 'rightWrist'] },
  { name: 'sol bacak', a: ['leftHip', 'leftKnee'], b: ['leftKnee', 'leftAnkle'] },
  { name: 'sağ bacak', a: ['rightHip', 'rightKnee'], b: ['rightKnee', 'rightAnkle'] },
];

const SYMMETRY_BONES = [
  { name: 'köprücük', left: ['leftClavicle', 'leftShoulder'], right: ['rightClavicle', 'rightShoulder'] },
  { name: 'üst kol', left: ['leftShoulder', 'leftElbow'], right: ['rightShoulder', 'rightElbow'] },
  { name: 'ön kol', left: ['leftElbow', 'leftWrist'], right: ['rightElbow', 'rightWrist'] },
  { name: 'uyluk', left: ['leftHip', 'leftKnee'], right: ['rightHip', 'rightKnee'] },
  { name: 'baldır', left: ['leftKnee', 'leftAnkle'], right: ['rightKnee', 'rightAnkle'] },
];

/**
 * @param {Map<string, THREE.Vector3>} positions
 * @param {THREE.Mesh} mesh
 * @returns {{ issues: Array, info: object }}
 */
export function validateLandmarks(positions, mesh) {
  const issues = [];
  const info = {};

  if (positions.size === 0) return { issues, info };

  info.midline = estimateMidline(positions);
  info.facing = mesh ? detectFacing(positions, mesh.geometry) : null;

  checkSides(positions, info, issues);
  checkSpineOrder(positions, issues);
  checkBoneLengths(positions, info, issues);
  checkProportions(positions, issues);
  checkSymmetry(positions, issues);
  if (mesh) checkInsideMesh(positions, mesh, issues);

  return { issues, info };
}

/**
 * Modelin baktığı yön. Ayak, bilekten ileri doğru uzar; parmak ucu topuktan
 * uzaktır. Bilek hizasının altındaki vertex'lerin Z ortalaması bilekten
 * hangi yöne kaymışsa model o yöne bakıyordur.
 *
 * Bu bilgi olmadan "sol kol gerçekten solda mı" sorusu cevaplanamaz: sadece
 * sol ve sağın farklı taraflarda olduğunu görebiliriz, hangisinin sol
 * olduğunu göremeyiz.
 */
export function detectFacing(positions, geometry) {
  const leftAnkle = positions.get('leftAnkle');
  const rightAnkle = positions.get('rightAnkle');
  if (!leftAnkle || !rightAnkle) return null;

  const ankleY = Math.min(leftAnkle.y, rightAnkle.y);
  const ankleZ = (leftAnkle.z + rightAnkle.z) / 2;

  const position = geometry.getAttribute('position');
  let sum = 0;
  let count = 0;

  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) > ankleY) continue;
    sum += position.getZ(i);
    count += 1;
  }

  if (count < 20) return null;

  const footZ = sum / count;
  const offset = footZ - ankleZ;

  return {
    direction: offset >= 0 ? 1 : -1,
    offset,
    reliable: Math.abs(offset) >= FACING_CONFIDENCE,
    footVertexCount: count,
  };
}

/** Sol/sağ tutarlılığı: en kritik kontrol. */
function checkSides(positions, info, issues) {
  const midline = info.midline;
  const crossedGroups = new Set();
  const swappedGroups = new Set();

  // Modelin anatomik solu: +Z'ye bakan bir karakterin solu +X'tir.
  const leftSign = info.facing?.reliable ? info.facing.direction : null;

  for (const pair of MIRROR_PAIRS) {
    const left = positions.get(pair.left);
    const right = positions.get(pair.right);
    if (!left || !right) continue;

    const leftOffset = left.x - midline;
    const rightOffset = right.x - midline;

    if (Math.sign(leftOffset) === Math.sign(rightOffset)) {
      crossedGroups.add(pair.group);
      continue;
    }

    if (leftSign !== null && Math.sign(leftOffset) !== leftSign) {
      swappedGroups.add(pair.group);
    }
  }

  for (const group of crossedGroups) {
    issues.push({
      level: 'error',
      code: `same-side-${group}`,
      group,
      message:
        `${groupLabel(group)}: sol ve sağ landmark'lar gövdenin aynı tarafında. ` +
        'İkisinden biri yanlış uzva konmuş.',
    });
  }

  for (const group of swappedGroups) {
    issues.push({
      level: 'error',
      code: `swapped-${group}`,
      group,
      swappable: true,
      message:
        `${groupLabel(group)}: sol ve sağ yer değiştirmiş. Model ` +
        `${info.facing.direction > 0 ? '+Z' : '-Z'} yönüne bakıyor, ` +
        `bu durumda modelin solu ${info.facing.direction > 0 ? '+X' : '-X'} tarafı. ` +
        'Mixamo animasyonu bu haliyle ters uzvu oynatır.',
    });
  }
}

/** Omurga zinciri yukarı doğru sıralı olmalı. */
function checkSpineOrder(positions, issues) {
  for (let i = 0; i < SPINE_ORDER.length - 1; i += 1) {
    const lower = positions.get(SPINE_ORDER[i]);
    const upper = positions.get(SPINE_ORDER[i + 1]);
    if (!lower || !upper) continue;

    if (upper.y <= lower.y) {
      issues.push({
        level: 'error',
        code: `spine-order-${SPINE_ORDER[i + 1]}`,
        message: `${SPINE_ORDER[i + 1]}, ${SPINE_ORDER[i]} landmark'ından yukarıda değil.`,
      });
    }
  }
}

/** Sıfır uzunluklu kemik iskeleti bozar, weight hesabı da patlar. */
function checkBoneLengths(positions, info, issues) {
  const lengths = {};

  for (const bone of humanoidTemplate.bones) {
    if (!bone.parent) continue;

    const parentBone = humanoidTemplate.bones.find((entry) => entry.name === bone.parent);
    const start = positions.get(parentBone?.landmark);
    const end = positions.get(bone.landmark);
    if (!start || !end) continue;

    const length = start.distanceTo(end);
    lengths[bone.name] = length;

    if (length < 1e-3) {
      issues.push({
        level: 'error',
        code: `zero-length-${bone.name}`,
        message: `${bone.name.replace('mixamorig:', '')} kemiği neredeyse sıfır uzunlukta.`,
      });
    }
  }

  info.boneLengths = lengths;
}

/** Uzuv oranları: dirsek ve diz uzvun ortasına yakın olmalı. */
function checkProportions(positions, issues) {
  for (const entry of PROPORTIONS) {
    const upper = segmentLength(positions, entry.a);
    const lower = segmentLength(positions, entry.b);
    if (upper === null || lower === null || lower === 0) continue;

    const ratio = upper / lower;
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
      issues.push({
        level: 'warn',
        code: `proportion-${entry.name}`,
        message:
          `${entry.name}: üst/alt uzuv oranı ${ratio.toFixed(2)}. ` +
          `${ratio < 1 ? 'Orta eklem çok yukarıda' : 'Orta eklem çok aşağıda'} olabilir.`,
      });
    }
  }
}

/** Sol ve sağ kemikler benzer uzunlukta olmalı. */
function checkSymmetry(positions, issues) {
  for (const entry of SYMMETRY_BONES) {
    const left = segmentLength(positions, entry.left);
    const right = segmentLength(positions, entry.right);
    if (left === null || right === null) continue;

    const largest = Math.max(left, right);
    if (largest === 0) continue;

    const difference = Math.abs(left - right) / largest;
    if (difference > SYMMETRY_TOLERANCE) {
      issues.push({
        level: 'warn',
        code: `symmetry-${entry.name}`,
        message:
          `${entry.name}: sol ${left.toFixed(3)}, sağ ${right.toFixed(3)} ` +
          `(%${(difference * 100).toFixed(0)} fark).`,
      });
    }
  }
}

/**
 * Landmark mesh'in içinde mi?
 *
 * Noktadan tek yöne ışın atıp kesişim sayısına bakıyoruz: tek sayı içeride,
 * çift sayı dışarıda demek. Mesh su geçirmez değilse (Meshy çıktılarında
 * garanti yok) bu test yanılabilir, o yüzden sonuç uyarı seviyesinde.
 */
function checkInsideMesh(positions, mesh, issues) {
  const raycaster = new THREE.Raycaster();
  const direction = new THREE.Vector3(0.577, 0.577, 0.577).normalize();
  const outside = [];

  for (const [id, point] of positions) {
    raycaster.set(point, direction);
    const hits = raycaster.intersectObject(mesh, false);
    if (hits.length % 2 === 0) outside.push(id);
  }

  if (outside.length) {
    issues.push({
      level: 'warn',
      code: 'outside-mesh',
      message:
        `Mesh'in dışında görünen landmark: ${outside.join(', ')}. ` +
        'Mesh su geçirmez değilse bu test yanılabilir, gözle kontrol et.',
    });
  }
}

function segmentLength(positions, [a, b]) {
  const start = positions.get(a);
  const end = positions.get(b);
  if (!start || !end) return null;
  return start.distanceTo(end);
}

function groupLabel(group) {
  return group === 'arms' ? 'Kollar' : 'Bacaklar';
}

export const MIRROR_GROUPS = {
  arms: MIRROR_PAIRS.filter((pair) => pair.group === 'arms'),
  legs: MIRROR_PAIRS.filter((pair) => pair.group === 'legs'),
};
