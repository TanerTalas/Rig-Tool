import * as THREE from 'three';

import { createGeodesicSolver } from './geodesic.js';

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
  smoothIterations: 1,
  smoothStrength: 0.5,
  // Mesafeyi kemik ekseninden değil, kemiğin uzuv yüzeyinden itibaren ölç.
  radiusNormalization: true,
  // Uzvun içinde kalan mesafeler için taban değer, yarıçapın katı olarak.
  // İki uzuv da bir vertex'i içine alıyorsa ince olan kazansın diye yarıçapla
  // orantılı. Küçültmek sızıntıyı azaltır ama eklemleri sertleştirir:
  // 0.05'te ortalama etkileyen kemik 1.74'e, 0.35'te 2.46'ya çıkıyor.
  radiusFloor: 0.2,
  // Kemiğin "çekirdeği": bölgesindeki en yakın vertex'lerin oranı.
  coreRatio: 0.3,
  // Bir vertex'in seed olabilmesi için çekirdeğe yüzeyden uzaklığı,
  // kemik yarıçapının kaç katına kadar olabilir.
  seedReach: 4,
  // Çocuğu olmayan kemiklere verilen sanal kuyruğun, ebeveyn kemik uzunluğuna
  // oranı. Bu olmadan el/ayak/kafa ucu kemikleri hiçbir vertex'e hükmedemez.
  tailFactor: 0.6,
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
 * Geodezik weight hesabı (Aşama 4).
 *
 * Fark tek bir yerde: mesafe artık havadan değil, mesh yüzeyinde yürüyerek
 * ölçülüyor. Bunun için her kemiğe bir seed kümesi veriliyor ve o seed'lerden
 * yüzey boyunca yayılıyoruz.
 *
 * Seed seçimi: bir vertex, Öklid olarak en yakın olduğu kemiğin seed'i olur.
 * Sabit bir mesafe eşiği kullanmıyoruz çünkü uzuv kalınlığı modelden modele
 * ve uzuvdan uzva değişiyor — kalın bir uyluğun ekseni yüzeyden 5 cm içeride
 * kalıyor ve sabit eşik hiç seed bulamıyor. Bu haliyle her kemik kendi
 * bölgesini seed olarak alıyor, kapsama garanti.
 *
 * Bağlantısız adalar ayrı bir çözüm gerektirmiyor: her vertex kendi en yakın
 * kemiğinin seed'i olduğu için ada içindeki vertex'ler o kemikten ağırlık
 * alıyor, diğer kemiklere ise yüzeyden ulaşılamadığı için ağırlık sızmıyor.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Skeleton} skeleton bind pose'daki iskelet
 * @param {object} graph adjacency.js'ten gelen komşuluk grafiği
 * @param {object} [options]
 */
export function computeGeodesicWeights(geometry, skeleton, graph, options = {}) {
  const power = options.power ?? DEFAULT_WEIGHT_OPTIONS.power;
  const epsilon = options.epsilon ?? DEFAULT_WEIGHT_OPTIONS.epsilon;
  const smoothIterations = options.smoothIterations ?? DEFAULT_WEIGHT_OPTIONS.smoothIterations;
  const smoothStrength = options.smoothStrength ?? DEFAULT_WEIGHT_OPTIONS.smoothStrength;

  const started = performance.now();
  const bones = skeleton.bones;
  const boneCount = bones.length;
  const weldedCount = graph.weldedCount;

  const boneSegments = buildBoneSegments(skeleton, {
    tailFactor: options.tailFactor ?? DEFAULT_WEIGHT_OPTIONS.tailFactor,
    facing: options.facing ?? 1,
  });

  // 1) Her welded vertex için her kemiğe Öklid mesafesi + en yakın kemik
  const euclid = new Float32Array(weldedCount * boneCount);
  const nearestBone = new Uint16Array(weldedCount);
  const vertex = new THREE.Vector3();

  for (let v = 0; v < weldedCount; v += 1) {
    vertex.set(graph.positions[v * 3], graph.positions[v * 3 + 1], graph.positions[v * 3 + 2]);

    let best = Infinity;
    let bestBone = 0;

    for (let b = 0; b < boneCount; b += 1) {
      const distance = distanceToBone(vertex, boneSegments[b]);
      euclid[v * boneCount + b] = distance;
      if (distance < best) {
        best = distance;
        bestBone = b;
      }
    }

    nearestBone[v] = bestBone;
  }

  // 2) Kemik yarıçapları ve seed listeleri
  //
  // Ham mesafe chibi modellerde yanlış cevap veriyor: gövdenin yan duvarı
  // omurga ekseninden 9 cm uzakta ama yanına yapışmış kolun ekseninden
  // 5 cm uzakta. İki ölçüye de göre "orası kol" çıkıyor, oysa orası gövde.
  //
  // Çözüm, mesafeyi kemik ekseninden değil o kemiğin uzuv YÜZEYİNDEN itibaren
  // ölçmek: her kemiğin bir yarıçapı var (kol ~3 cm, gövde ~9 cm) ve gerçek
  // soru "bu vertex hangi uzvun kabuğunun üstünde" sorusu.
  //
  //   d_etkin = max(d - yarıçap, 0) + FLOOR * yarıçap
  //
  // Gövde duvarı: gövde için d-r = 0, kol için 0.05-0.03 = 0.02 -> gövde kazanır.
  // Kol yüzeyi:   kol için 0 -> kol kazanır.
  // El:           el için 0, kalça için de d<r ama taban terimi kalçada daha
  //               büyük (kalın kemik) olduğu için ince olan el kazanır.
  //
  // Mesafeyi yarıçapa BÖLMEK denendi ve işe yaramadı: kalın kemikler (kalça)
  // uzaktaki vertex'leri de kendi yarıçapı içinde sayıp elin ağırlığını
  // çalıyor, el %75 geriliyordu.
  const radii = estimateBoneRadii(euclid, nearestBone, weldedCount, boneCount);
  const normalize = options.radiusNormalization ?? DEFAULT_WEIGHT_OPTIONS.radiusNormalization;
  const radiusFloor = options.radiusFloor ?? DEFAULT_WEIGHT_OPTIONS.radiusFloor;
  const effective = (distance, bone) =>
    normalize ? Math.max(distance - radii[bone], 0) + radiusFloor * radii[bone] : distance;

  if (normalize) {
    // Etkin mesafeye göre en yakın kemiği yeniden seç.
    for (let v = 0; v < weldedCount; v += 1) {
      let best = Infinity;
      let bestBone = nearestBone[v];

      for (let b = 0; b < boneCount; b += 1) {
        const scaled = effective(euclid[v * boneCount + b], b);
        if (scaled < best) {
          best = scaled;
          bestBone = b;
        }
      }

      nearestBone[v] = bestBone;
    }
  }

  // 3) Seed kümeleri
  //
  // Seed'i sadece "Öklid olarak en yakın kemik" diye seçmek yetmiyor: kolun
  // yanında sarkan bir pelerin havada ele yakın olduğu için el kemiğinin
  // seed'i oluyor ve elle birlikte savruluyor — oysa o pelerin yüzeyde
  // elden 0.9 birim uzakta, kalçaya 0.4.
  //
  // Bu yüzden iki aşamalı seçim yapılıyor:
  //   1. Çekirdek: kemiğin bölgesindeki, kemiğe en yakın %30'luk vertex'ler.
  //      Bunlar kesinlikle o uzvun kendi yüzeyi.
  //   2. Seed: bölgedeki vertex'lerden çekirdeğe YÜZEYDEN yakın olanlar.
  //      Uzvun arka yüzü çevreyi dolaşarak da olsa çekirdeğe yakındır ve
  //      seed olur; komşu duran ama bağlı olmayan kumaş elenir.
  const solver = createGeodesicSolver(graph);
  const distances = new Float64Array(weldedCount);
  const coreDistances = new Float64Array(weldedCount);

  const regions = Array.from({ length: boneCount }, () => []);
  for (let v = 0; v < weldedCount; v += 1) regions[nearestBone[v]].push(v);

  const seedNodes = Array.from({ length: boneCount }, () => []);
  const seedDistances = Array.from({ length: boneCount }, () => []);
  const coreRatio = options.coreRatio ?? DEFAULT_WEIGHT_OPTIONS.coreRatio;
  const seedReach = options.seedReach ?? DEFAULT_WEIGHT_OPTIONS.seedReach;

  for (let b = 0; b < boneCount; b += 1) {
    const region = regions[b];
    if (!region.length) continue;

    const sorted = [...region].sort(
      (a, c) => euclid[a * boneCount + b] - euclid[c * boneCount + b],
    );
    const coreCount = Math.max(1, Math.round(sorted.length * coreRatio));
    const core = sorted.slice(0, coreCount);

    solver.solve(
      core,
      core.map((v) => euclid[v * boneCount + b]),
      coreDistances,
    );

    const limit = seedReach * radii[b];
    for (const v of region) {
      if (coreDistances[v] > limit) continue;
      seedNodes[b].push(v);
      seedDistances[b].push(euclid[v * boneCount + b]);
    }

    // Çekirdek her hâlükârda seed olmalı (limit çok dar kalırsa diye).
    if (!seedNodes[b].length) {
      for (const v of core) {
        seedNodes[b].push(v);
        seedDistances[b].push(euclid[v * boneCount + b]);
      }
    }
  }

  // 4) Kemik başına çok kaynaklı Dijkstra -> yoğun ağırlık matrisi
  let dense = new Float32Array(weldedCount * boneCount);
  const emptySeedBones = [];
  let unreachablePairs = 0;

  for (let b = 0; b < boneCount; b += 1) {
    if (!seedNodes[b].length) {
      emptySeedBones.push(bones[b].name);
      continue;
    }

    solver.solve(seedNodes[b], seedDistances[b], distances);

    for (let v = 0; v < weldedCount; v += 1) {
      const relaxed = distances[v];
      if (!Number.isFinite(relaxed)) {
        unreachablePairs += 1;
        continue; // ağırlık 0 kalıyor: bu kemiğe yüzeyden ulaşılamıyor
      }

      // Yüzeyden giden yol düz çizgiden kısa olamaz. Dijkstra "komşu seed'in
      // Öklid mesafesi + kısa bir yüzey yürüyüşü" toplamını bulup omuz gibi
      // yerlerde Öklid'in altına inebiliyor; bu kestirme, kol kemiğinin
      // gövdeye fazladan bulaşmasına yol açıyor. Alt sınır Öklid mesafesi.
      const distance = Math.max(relaxed, euclid[v * boneCount + b]);
      const scaled = effective(distance, b);
      dense[v * boneCount + b] = 1 / (Math.pow(scaled, power) + epsilon);
    }
  }

  // 4) Yumuşatma: komşuların ağırlıklarıyla karıştır
  for (let i = 0; i < smoothIterations; i += 1) {
    dense = smoothWeights(dense, graph, boneCount, smoothStrength);
  }

  // 5) En büyük 4'ü tut, normalize et, orijinal vertex'lere yay
  return finalizeWeights({
    dense,
    graph,
    geometry,
    bones,
    nearestBone,
    method: 'geodesic',
    stats: {
      power,
      smoothIterations,
      emptySeedBones,
      unreachablePairs,
      elapsedMs: performance.now() - started,
    },
  });
}

/**
 * Kemik yarıçapı: o kemiğin bölgesindeki vertex'lerin kemiğe medyan mesafesi.
 *
 * Medyan kullanılıyor çünkü ortalama, uzuv ucundaki birkaç uzak vertex yüzünden
 * kayıyor. Bölgesi boş kalan kemikler için tüm yarıçapların medyanı yedek
 * değer olarak veriliyor.
 */
function estimateBoneRadii(euclid, nearestBone, weldedCount, boneCount) {
  const samples = Array.from({ length: boneCount }, () => []);

  for (let v = 0; v < weldedCount; v += 1) {
    const bone = nearestBone[v];
    samples[bone].push(euclid[v * boneCount + bone]);
  }

  const radii = new Float64Array(boneCount);
  const known = [];

  for (let b = 0; b < boneCount; b += 1) {
    if (!samples[b].length) continue;
    samples[b].sort((a, c) => a - c);
    const radius = samples[b][Math.floor(samples[b].length / 2)];
    radii[b] = radius;
    if (radius > 0) known.push(radius);
  }

  known.sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;

  for (let b = 0; b < boneCount; b += 1) {
    if (!(radii[b] > 0)) radii[b] = fallback;
  }

  return radii;
}

/**
 * Yoğun ağırlık matrisini komşu ortalamasıyla karıştırır (Laplacian).
 * Kemik sınırlarındaki keskin geçişleri yumuşatıyor; deformasyonda
 * "kırılma çizgisi" görünmesini engelliyor.
 */
function smoothWeights(dense, graph, boneCount, strength) {
  const output = new Float32Array(dense.length);

  for (let v = 0; v < graph.weldedCount; v += 1) {
    const start = graph.neighborOffsets[v];
    const end = graph.neighborOffsets[v + 1];
    const degree = end - start;
    const base = v * boneCount;

    if (degree === 0) {
      output.set(dense.subarray(base, base + boneCount), base);
      continue;
    }

    for (let b = 0; b < boneCount; b += 1) {
      let sum = 0;
      for (let i = start; i < end; i += 1) {
        sum += dense[graph.neighborIndices[i] * boneCount + b];
      }
      const average = sum / degree;
      output[base + b] = dense[base + b] * (1 - strength) + average * strength;
    }
  }

  return output;
}

/**
 * Yoğun matristen skinIndex/skinWeight üretir.
 * Welded vertex'lerin ağırlıkları, aynı konumdaki tüm orijinal vertex'lere
 * kopyalanıyor: dikiş kopyaları aynı ağırlığı almalı, yoksa UV seam'inde
 * mesh yırtılır.
 */
function finalizeWeights({ dense, graph, geometry, bones, nearestBone, method, stats }) {
  const boneCount = bones.length;
  const vertexCount = geometry.getAttribute('position').count;

  const skinIndices = new Uint16Array(vertexCount * MAX_INFLUENCES);
  const skinWeights = new Float32Array(vertexCount * MAX_INFLUENCES);

  const dominantCount = new Uint32Array(boneCount);
  const influencedCount = new Uint32Array(boneCount);
  let influenceSum = 0;
  let fallbackVertices = 0;

  const weldedIndices = new Uint16Array(MAX_INFLUENCES * graph.weldedCount);
  const weldedWeights = new Float32Array(MAX_INFLUENCES * graph.weldedCount);

  const row = new Float64Array(boneCount);

  for (let v = 0; v < graph.weldedCount; v += 1) {
    const base = v * boneCount;
    for (let b = 0; b < boneCount; b += 1) row[b] = dense[base + b];

    const picked = pickTopValues(row);
    let total = 0;
    for (let i = 0; i < picked.count; i += 1) total += picked.weights[i];

    // Hiçbir kemiğe ulaşamayan vertex (kopuk ada, izole vertex): en yakın
    // kemiğe %100 bağlanıyor.
    if (total <= 0) {
      fallbackVertices += 1;
      weldedIndices[v * MAX_INFLUENCES] = nearestBone[v];
      weldedWeights[v * MAX_INFLUENCES] = 1;
      continue;
    }

    for (let i = 0; i < MAX_INFLUENCES; i += 1) {
      const slot = v * MAX_INFLUENCES + i;
      weldedIndices[slot] = i < picked.count ? picked.indices[i] : 0;
      weldedWeights[slot] = i < picked.count ? picked.weights[i] / total : 0;
    }
  }

  for (let v = 0; v < vertexCount; v += 1) {
    const welded = graph.originalToWelded[v];

    for (let i = 0; i < MAX_INFLUENCES; i += 1) {
      const from = welded * MAX_INFLUENCES + i;
      const to = v * MAX_INFLUENCES + i;
      const bone = weldedIndices[from];
      const weight = weldedWeights[from];

      skinIndices[to] = bone;
      skinWeights[to] = weight;

      if (weight >= INFLUENCE_EPSILON) {
        influencedCount[bone] += 1;
        influenceSum += 1;
      }
    }

    if (skinWeights[v * MAX_INFLUENCES] > 0) dominantCount[skinIndices[v * MAX_INFLUENCES]] += 1;
  }

  return {
    skinIndices,
    skinWeights,
    stats: {
      method,
      vertexCount,
      weldedCount: graph.weldedCount,
      boneCount,
      fallbackVertices,
      avgInfluences: vertexCount ? influenceSum / vertexCount : 0,
      perBone: bones.map((bone, index) => ({
        name: bone.name,
        dominant: dominantCount[index],
        influenced: influencedCount[index],
      })),
      ...stats,
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
  skinnedMesh.updateMatrixWorld(true);

  // bindMatrix MUTLAKA açıkça verilmeli. Three.js'te bind(skeleton) tek
  // argümanla çağrılırsa içeride calculateInverses() çalışır ve o anki
  // duruşu bind pose kabul eder. Model poz verilmişken weight yeniden
  // hesaplanırsa o poz kalıcı bind pose olur: iskelet doğru görünür ama
  // hiçbir kemik mesh'i hareket ettirmez, export edilen GLB de bükülür.
  // Inverse bind matrix'ler iskelet kurulurken (bind pose'da) hesaplandı,
  // burada tekrar hesaplanmamalı.
  skinnedMesh.bind(skeleton, skinnedMesh.matrixWorld);

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
function buildBoneSegments(skeleton, options = {}) {
  const tailFactor = options.tailFactor ?? 0;
  const facing = options.facing ?? 1;

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

    if (segments.length) return segments;

    // Uç kemik (el, ayak, kafa ucu): çocuğu yok, dolayısıyla gövdesi de yok.
    // Kuyruk verilmezse etki alanı tek nokta olur, o nokta da ebeveyn
    // segmentinin ucuyla çakıştığı için kemik hiçbir vertex'e hükmedemez.
    const tail = tailDirection(bone, index, bindPositions, indexOf, facing);
    if (!tail || tailFactor <= 0) {
      segments.push({ start, end: start });
      return segments;
    }

    segments.push({ start, end: start.clone().addScaledVector(tail.direction, tail.length * tailFactor) });
    return segments;
  });
}

/**
 * Uç kemiğin sanal kuyruğunun yönü ve ölçüsü.
 *
 * Genel kural: kuyruk, ebeveynden bu kemiğe gelen yönde devam eder — el ön
 * kolun devamıdır. Ayak bunun istisnası: baldır dikey iner ama ayak ileri
 * uzanır, o yüzden modelin baktığı yön kullanılıyor. Bu ayrım olmadan ayak
 * kemiği bacağın içine doğru uzar ve topuk-parmak yuvarlanması hiç çalışmaz.
 */
function tailDirection(bone, index, bindPositions, indexOf, facing) {
  const parentIndex = indexOf.get(bone.parent);
  if (parentIndex === undefined) return null;

  const start = bindPositions[index];
  const parent = bindPositions[parentIndex];
  const length = start.distanceTo(parent);
  if (length < 1e-6) return null;

  if (/Foot$/.test(bone.name)) {
    return { direction: new THREE.Vector3(0, 0, facing >= 0 ? 1 : -1), length };
  }

  return { direction: start.clone().sub(parent).normalize(), length };
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
  const picked = resetPicked();

  for (let b = 0; b < distances.length; b += 1) {
    insertTop(picked, b, 1 / (Math.pow(distances[b], power) + epsilon));
  }

  return picked;
}

/** Hazır ağırlık dizisinden en büyük 4'ünü seçer (geodezik yol bunu kullanıyor). */
function pickTopValues(values) {
  const picked = resetPicked();

  for (let b = 0; b < values.length; b += 1) {
    if (values[b] <= 0) continue;
    insertTop(picked, b, values[b]);
  }

  return picked;
}

// Tek bir tampon yeniden kullanılıyor: vertex başına iki dizi ayırmak
// 8000 vertex'te fark ediyor.
const pickedBuffer = {
  indices: new Uint16Array(MAX_INFLUENCES),
  weights: new Float64Array(MAX_INFLUENCES),
  count: 0,
};

function resetPicked() {
  pickedBuffer.count = 0;
  return pickedBuffer;
}

/** Sıralı ekleme: liste 4 elemanlı, ayrı bir sıralama geçişi gereksiz. */
function insertTop(picked, index, weight) {
  let slot = picked.count < MAX_INFLUENCES ? picked.count : MAX_INFLUENCES - 1;
  if (picked.count === MAX_INFLUENCES && weight <= picked.weights[slot]) return;

  while (slot > 0 && picked.weights[slot - 1] < weight) {
    picked.weights[slot] = picked.weights[slot - 1];
    picked.indices[slot] = picked.indices[slot - 1];
    slot -= 1;
  }

  picked.weights[slot] = weight;
  picked.indices[slot] = index;
  if (picked.count < MAX_INFLUENCES) picked.count += 1;
}
