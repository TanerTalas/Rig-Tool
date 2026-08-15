import {
  applySkinning,
  computeGeodesicWeights,
  computeNaiveWeights,
  DEFAULT_WEIGHT_OPTIONS,
  measureLeakage,
} from '../core/weights.js';
import { applyTestPose } from '../core/pose.js';

export const WEIGHT_METHODS = [
  { id: 'geodesic', label: 'Geodezik (yüzey)' },
  { id: 'naive', label: 'Naif (Öklid)' },
];

/**
 * Weight hesabı ve test pozları.
 *
 * Skinning her zaman ham mesh'ten yeniden üretiliyor: kullanıcı bir landmark'ı
 * düzeltip iskeleti değiştirdiğinde eski SkinnedMesh geçersiz kalır, çünkü
 * eski iskelete bağlıdır. Bu yüzden iskelet değişince skinning iptal ediliyor
 * ve sahne ham mesh'e dönüyor.
 */
export function createWeightController({
  landmarks,
  getBaseMesh,
  setSceneMesh,
  onRefresh,
  onWeightsChanged,
  applyOverrides,
}) {
  let power = DEFAULT_WEIGHT_OPTIONS.power;
  let smoothIterations = DEFAULT_WEIGHT_OPTIONS.smoothIterations;
  let method = 'geodesic';
  let radiusNormalization = DEFAULT_WEIGHT_OPTIONS.radiusNormalization;
  // Override'sız ham sonuç ile bölge override'ları uygulanmış sonuç ayrı
  // tutuluyor: bir bölgenin sabitlemesi kaldırıldığında ham değerlere
  // dönebilmek gerekiyor.
  let baseWeights = null;
  let weights = null;
  let stats = null;
  let leakage = null;
  let skinnedMesh = null;
  let poseId = 'bind';

  // Yöntemler arası karşılaştırma için son sonuçlar saklanıyor: "sanırım daha
  // iyi oldu" yerine iki sütunu yan yana okumak istiyoruz.
  const results = { naive: null, geodesic: null };

  function refresh() {
    onRefresh?.();
  }

  const controller = {
    get power() {
      return power;
    },
    get method() {
      return method;
    },
    get smoothIterations() {
      return smoothIterations;
    },
    get radiusNormalization() {
      return radiusNormalization;
    },
    get results() {
      return results;
    },
    get stats() {
      return stats;
    },
    get leakage() {
      return leakage;
    },
    get isSkinned() {
      return Boolean(skinnedMesh);
    },
    get poseId() {
      return poseId;
    },
    get canCompute() {
      return Boolean(landmarks.hasSkeleton && getBaseMesh());
    },
    get isReadyForModel() {
      return Boolean(getBaseMesh());
    },

    setPower(value) {
      power = value;
      refresh();
    },

    setMethod(value) {
      method = value;
      refresh();
    },

    setSmoothIterations(value) {
      smoothIterations = value;
      refresh();
    },

    setRadiusNormalization(value) {
      radiusNormalization = value;
      refresh();
    },

    /** Weight hesapla ve SkinnedMesh'e geç. */
    compute() {
      const mesh = getBaseMesh();
      const rig = landmarks.skeleton;
      if (!mesh || !rig) return;

      // Hesaba her zaman bind pose'dan başla: poz verilmiş bir iskelette
      // hesaplamak hem kafa karıştırıcı hem de bind pose'la ilgili her türlü
      // hatanın kaynağı.
      applyTestPose(rig.skeleton, 'bind');
      poseId = 'bind';

      if (method === 'geodesic') {
        const graph = mesh.userData.adjacency;
        if (!graph) {
          console.error('[weights] Komşuluk grafiği yok, geodezik hesap yapılamaz.');
          return;
        }

        weights = computeGeodesicWeights(mesh.geometry, rig.skeleton, graph, {
          power,
          smoothIterations,
          radiusNormalization,
          // Ayak kemiğinin sanal kuyruğu modelin baktığı yöne uzanmalı.
          facing: landmarks.validation?.info?.facing?.direction ?? 1,
        });
      } else {
        weights = computeNaiveWeights(mesh.geometry, rig.skeleton, { power });
      }

      baseWeights = weights;
      weights = {
        skinIndices: baseWeights.skinIndices.slice(),
        skinWeights: baseWeights.skinWeights.slice(),
        stats: baseWeights.stats,
      };
      applyOverrides?.(weights);

      stats = weights.stats;
      leakage = measureLeakage(weights, rig.bones);

      results[method] = {
        method,
        power,
        smoothIterations: method === 'geodesic' ? smoothIterations : null,
        elapsedMs: stats.elapsedMs,
        avgInfluences: stats.avgInfluences,
        orphanBones: stats.perBone.filter((entry) => entry.dominant === 0).length,
        leakingRatio: leakage.leakingRatio,
      };

      skinnedMesh = applySkinning({
        geometry: mesh.geometry,
        material: mesh.material,
        skeleton: rig.skeleton,
        root: rig.root,
        weights,
        name: mesh.name,
      });

      setSceneMesh(skinnedMesh);
      onWeightsChanged?.();
      refresh();

      const dominant = [...stats.perBone]
        .sort((a, b) => b.dominant - a.dominant)
        .slice(0, 5)
        .map((entry) => `${entry.name}=${entry.dominant}`);

      console.log(`[weights] ${method} weight hesaplandı:`, {
        power,
        smoothIterations: method === 'geodesic' ? smoothIterations : undefined,
        vertex: stats.vertexCount,
        kemik: stats.boneCount,
        süreMs: Number(stats.elapsedMs.toFixed(1)),
        ortEtkileyenKemik: Number(stats.avgInfluences.toFixed(2)),
        enÇokHükmeden: dominant,
      });
      console.log('[weights] sızıntı ölçümü:', {
        gövdeVertex: leakage.torsoVertices,
        kolAğırlığıAlan: leakage.leakingVertices,
        oran: `%${(leakage.leakingRatio * 100).toFixed(1)}`,
        ortSızanAğırlık: Number(leakage.avgLeakedWeight.toFixed(3)),
      });
    },

    setPose(id) {
      const rig = landmarks.skeleton;
      if (!rig) return;

      poseId = id;
      applyTestPose(rig.skeleton, id);
      refresh();
    },

    /**
     * Bölge override'larını ham ağırlıkların üzerine yeniden uygular.
     * Bölge eklenince, silinince veya başka kemiğe bağlanınca çağrılıyor.
     */
    reapplyOverrides() {
      if (!baseWeights || !weights || !skinnedMesh) return;

      weights.skinIndices.set(baseWeights.skinIndices);
      weights.skinWeights.set(baseWeights.skinWeights);
      applyOverrides?.(weights);

      // Uint16BufferAttribute / Float32BufferAttribute kurucuları diziyi
      // KOPYALIYOR, referans tutmuyor. Bu yüzden değerleri attribute'un kendi
      // dizisine yazmak gerekiyor; sadece needsUpdate işaretlemek yetmez.
      const geometry = skinnedMesh.geometry;
      const indexAttribute = geometry.getAttribute('skinIndex');
      const weightAttribute = geometry.getAttribute('skinWeight');
      indexAttribute.array.set(weights.skinIndices);
      weightAttribute.array.set(weights.skinWeights);
      indexAttribute.needsUpdate = true;
      weightAttribute.needsUpdate = true;

      leakage = measureLeakage(weights, landmarks.skeleton.bones);
      onWeightsChanged?.();
      refresh();
    },

    /** Kullanıcı bir kemiği elle döndürdü: artık hazır pozlardan biri değiliz. */
    markCustomPose() {
      poseId = 'custom';
    },

    /** İskelet değişti: mevcut skinning artık geçersiz. */
    invalidate() {
      if (!skinnedMesh) return;

      skinnedMesh = null;
      weights = null;
      baseWeights = null;
      stats = null;
      leakage = null;
      poseId = 'bind';

      // İskelet pozda kalmasın: landmark'lar bind pose'da duruyor, iskelet
      // görselleştirmesi onlarla aynı yerde olmalı.
      if (landmarks.skeleton) applyTestPose(landmarks.skeleton.skeleton, 'bind');

      const mesh = getBaseMesh();
      if (mesh) setSceneMesh(mesh);

      console.warn('[weights] İskelet değişti, skinning sıfırlandı. Yeniden hesapla.');
      onWeightsChanged?.();
      refresh();
    },

    reset() {
      skinnedMesh = null;
      weights = null;
      baseWeights = null;
      stats = null;
      leakage = null;
      poseId = 'bind';
      onWeightsChanged?.();
      refresh();
    },

    get weights() {
      return weights;
    },
  };

  return controller;
}
