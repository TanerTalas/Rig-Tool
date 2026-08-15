import * as THREE from 'three';

/**
 * Naif skin weight hesabı (Aşama 2).
 *
 * Her vertex için en yakın kemiğe olan DÜZ (Öklid) mesafe ölçülüyor ve
 * ağırlık w = 1 / (d^p + eps) formülüyle veriliyor. En büyük 4 ağırlık
 * tutulup toplamları 1.0'a normalize ediliyor.
 *
 * Bu yöntemin çalışmayacağını baştan biliyoruz: chibi modellerde kol gövdeye
 * fiziksel olarak yakın, havada 2 cm olan iki nokta mesh yüzeyinde 15 cm
 * uzakta. Kol kemiği gövde vertex'lerine de ağırlık verecek ve kolu
 * kaldırınca göğüs de kalkacak.
 *
 * Buradaki amaç bozukluğu ÖLÇMEK: Aşama 4'teki geodezik yöntemin ne kadar
 * iyileştirdiğini kıyaslayacak bir referans noktası lazım.
 */

const MAX_INFLUENCES = 4;

// Ağırlığın "var sayıldığı" alt sınır; istatistiklerde kullanılıyor.
const INFLUENCE_EPSILON = 0.01;

export const DEFAULT_WEIGHT_OPTIONS = {
  power: 4,
  epsilon: 1e-8,
};

/**
 * @param {THREE.BufferGeometry} geometry normalize edilmiş geometry
 * @param {THREE.Skeleton} skeleton bind pose'daki iskelet
 * @param {{ power?: number, epsilon?: number }} [options]
 */
export function computeNaiveWeights(geometry, skeleton, options = {}) {
  const power = options.power ?? DEFAULT_WEIGHT_OPTIONS.power;
  const epsilon = options.epsilon ?? DEFAULT_WEIGHT_OPTIONS.epsilon;

  const started = performance.now();
  const bones = skeleton.bones;
  const boneSegments = buildBoneSegments(skeleton);

  const position = geometry.getAttribute('position');
  const vertexCount = position.count;

  const skinIndices = new Uint16Array(vertexCount * MAX_INFLUENCES);
  const skinWeights = new Float32Array(vertexCount * MAX_INFLUENCES);

  const distances = new Float64Array(bones.length);
  const vertex = new THREE.Vector3();

  // İstatistik: hangi kemik kaç vertex'e hükmediyor, kaç kemik etkiliyor
  const dominantCount = new Uint32Array(bones.length);
  const influencedCount = new Uint32Array(bones.length);
  let influenceSum = 0;

  for (let v = 0; v < vertexCount; v += 1) {
    vertex.fromBufferAttribute(position, v);

    for (let b = 0; b < bones.length; b += 1) {
      distances[b] = distanceToBone(vertex, boneSegments[b]);
    }

    const picked = pickTopBones(distances, power, epsilon);

    let total = 0;
    for (let i = 0; i < picked.count; i += 1) total += picked.weights[i];

    for (let i = 0; i < MAX_INFLUENCES; i += 1) {
      const slot = v * MAX_INFLUENCES + i;
      if (i < picked.count && total > 0) {
        const weight = picked.weights[i] / total;
        skinIndices[slot] = picked.indices[i];
        skinWeights[slot] = weight;

        if (weight >= INFLUENCE_EPSILON) {
          influencedCount[picked.indices[i]] += 1;
          influenceSum += 1;
        }
      } else {
        skinIndices[slot] = 0;
        skinWeights[slot] = 0;
      }
    }

    if (picked.count > 0) dominantCount[picked.indices[0]] += 1;
  }

  return {
    skinIndices,
    skinWeights,
    stats: {
      vertexCount,
      boneCount: bones.length,
      power,
      elapsedMs: performance.now() - started,
      avgInfluences: vertexCount ? influenceSum / vertexCount : 0,
      perBone: bones.map((bone, index) => ({
        name: bone.name,
        dominant: dominantCount[index],
        influenced: influencedCount[index],
      })),
    },
  };
}

/**
 * Hesaplanan ağırlıkları geometry'ye yazar ve SkinnedMesh üretir.
 *
 * Sıra önemli: kemik hiyerarşisi mesh'e eklendikten sonra bind çağrılıyor.
 * Skeleton'un inverse bind matrix'leri iskelet kurulurken (bind pose'da)
 * hesaplandığı için burada tekrar hesaplanmıyor — poz verilmiş bir iskelette
 * calculateInverses çağırmak modeli kalıcı olarak bükerdi.
 */
export function applySkinning({ geometry, material, skeleton, root, weights, name }) {
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(weights.skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights.skinWeights, 4));

  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = name ?? 'skinned-model';
  skinnedMesh.add(root);
  skinnedMesh.bind(skeleton);

  return skinnedMesh;
}

/**
 * Her kemik için "gövde" segmentleri.
 *
 * Bir kemiğin etki alanı, kendi konumundan çocuklarına uzanan doğru
 * parçalarıdır: LeftArm omuzda durur ama üst kolu temsil eder, yani omuz ile
 * dirsek arasını. Çocuğu olmayan kemikler (el, ayak, kafa ucu) için segment
 * yerine tek nokta kullanılıyor.
 *
 * Konumlar bind pose'dan alınıyor: inverse bind matrix'in tersi kemiğin bind
 * pose dünya matrisidir. Böylece model o an poz verilmiş olsa bile weight
 * hesabı doğru uzayda yapılır.
 */
function buildBoneSegments(skeleton) {
  const bones = skeleton.bones;
  const indexOf = new Map(bones.map((bone, index) => [bone, index]));

  const bindPositions = bones.map((bone, index) => {
    const matrix = new THREE.Matrix4().copy(skeleton.boneInverses[index]).invert();
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });

  return bones.map((bone, index) => {
    const start = bindPositions[index];
    const segments = [];

    for (const child of bone.children) {
      const childIndex = indexOf.get(child);
      if (childIndex === undefined) continue;
      segments.push({ start, end: bindPositions[childIndex] });
    }

    if (!segments.length) segments.push({ start, end: start });
    return segments;
  });
}

// Sızıntı ölçümünde kullanılan kemik grupları.
const TORSO_BONES = /(Hips|Spine|Spine1|Neck)$/;
const ARM_BONES = /(LeftArm|LeftForeArm|LeftHand|RightArm|RightForeArm|RightHand)$/;

/**
 * Weight sızıntısı ölçümü.
 *
 * "Kolu kaldırınca göğüs de kalkıyor" şikâyetinin sayısal karşılığı: gövde
 * kemiklerinin hükmettiği kaç vertex, kol kemiklerinden de kayda değer
 * ağırlık alıyor. Aşama 2 ile Aşama 4'ü karşılaştırmak için bu tek sayı
 * "sanırım daha iyi oldu"dan çok daha kullanışlı.
 *
 * @param {{skinIndices: Uint16Array, skinWeights: Float32Array}} weights
 * @param {THREE.Bone[]} bones
 * @param {number} [threshold] bu ağırlığın üstü "kayda değer" sayılıyor
 */
export function measureLeakage(weights, bones, threshold = 0.05) {
  const isTorso = bones.map((bone) => TORSO_BONES.test(bone.name));
  const isArm = bones.map((bone) => ARM_BONES.test(bone.name));

  const vertexCount = weights.skinWeights.length / MAX_INFLUENCES;
  let torsoVertices = 0;
  let leaking = 0;
  let leakedWeightSum = 0;

  for (let v = 0; v < vertexCount; v += 1) {
    const base = v * MAX_INFLUENCES;
    const dominant = weights.skinIndices[base];
    if (!isTorso[dominant]) continue;

    torsoVertices += 1;

    let armWeight = 0;
    for (let i = 0; i < MAX_INFLUENCES; i += 1) {
      if (isArm[weights.skinIndices[base + i]]) armWeight += weights.skinWeights[base + i];
    }

    if (armWeight >= threshold) {
      leaking += 1;
      leakedWeightSum += armWeight;
    }
  }

  return {
    threshold,
    torsoVertices,
    leakingVertices: leaking,
    leakingRatio: torsoVertices ? leaking / torsoVertices : 0,
    avgLeakedWeight: leaking ? leakedWeightSum / leaking : 0,
  };
}

/** Noktadan kemiğe mesafe: kemiğin tüm segmentlerine olan en küçük mesafe. */
function distanceToBone(point, segments) {
  let best = Infinity;

  for (const segment of segments) {
    const distance = distanceToSegment(point, segment.start, segment.end);
    if (distance < best) best = distance;
  }

  return best;
}

function distanceToSegment(point, start, end) {
  const ex = end.x - start.x;
  const ey = end.y - start.y;
  const ez = end.z - start.z;

  const lengthSquared = ex * ex + ey * ey + ez * ez;

  let t = 0;
  if (lengthSquared > 0) {
    t = ((point.x - start.x) * ex + (point.y - start.y) * ey + (point.z - start.z) * ez) /
      lengthSquared;
    // Segment dışına taşan izdüşümler uçlara kırpılıyor.
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  const dx = point.x - (start.x + ex * t);
  const dy = point.y - (start.y + ey * t);
  const dz = point.z - (start.z + ez * t);

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** En küçük mesafeli 4 kemiği ağırlığa çevirir, büyükten küçüğe sıralı. */
function pickTopBones(distances, power, epsilon) {
  const indices = new Uint16Array(MAX_INFLUENCES);
  const weights = new Float64Array(MAX_INFLUENCES);
  let count = 0;

  for (let b = 0; b < distances.length; b += 1) {
    const weight = 1 / (Math.pow(distances[b], power) + epsilon);

    // Sıralı ekleme: liste 4 elemanlı, sıralamak için ayrı bir geçiş gereksiz.
    let slot = count < MAX_INFLUENCES ? count : MAX_INFLUENCES - 1;
    if (count === MAX_INFLUENCES && weight <= weights[slot]) continue;

    while (slot > 0 && weights[slot - 1] < weight) {
      weights[slot] = weights[slot - 1];
      indices[slot] = indices[slot - 1];
      slot -= 1;
    }

    weights[slot] = weight;
    indices[slot] = b;
    if (count < MAX_INFLUENCES) count += 1;
  }

  return { indices, weights, count };
}
