import {
  applySkinning,
  computeNaiveWeights,
  DEFAULT_WEIGHT_OPTIONS,
  measureLeakage,
} from '../core/weights.js';
import { applyTestPose } from '../core/pose.js';

/**
 * Weight hesabı ve test pozları.
 *
 * Skinning her zaman ham mesh'ten yeniden üretiliyor: kullanıcı bir landmark'ı
 * düzeltip iskeleti değiştirdiğinde eski SkinnedMesh geçersiz kalır, çünkü
 * eski iskelete bağlıdır. Bu yüzden iskelet değişince skinning iptal ediliyor
 * ve sahne ham mesh'e dönüyor.
 */
export function createWeightController({ landmarks, getBaseMesh, setSceneMesh, onRefresh }) {
  let power = DEFAULT_WEIGHT_OPTIONS.power;
  let weights = null;
  let stats = null;
  let leakage = null;
  let skinnedMesh = null;
  let poseId = 'bind';

  function refresh() {
    onRefresh?.();
  }

  const controller = {
    get power() {
      return power;
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

    /** Aşama 2'nin çekirdeği: naif weight hesapla ve SkinnedMesh'e geç. */
    compute() {
      const mesh = getBaseMesh();
      const rig = landmarks.skeleton;
      if (!mesh || !rig) return;

      weights = computeNaiveWeights(mesh.geometry, rig.skeleton, { power });
      stats = weights.stats;
      leakage = measureLeakage(weights, rig.bones);

      skinnedMesh = applySkinning({
        geometry: mesh.geometry,
        material: mesh.material,
        skeleton: rig.skeleton,
        root: rig.root,
        weights,
        name: mesh.name,
      });

      poseId = 'bind';
      setSceneMesh(skinnedMesh);
      refresh();

      const dominant = [...stats.perBone]
        .sort((a, b) => b.dominant - a.dominant)
        .slice(0, 5)
        .map((entry) => `${entry.name.replace('mixamorig:', '')}=${entry.dominant}`);

      console.log('[weights] naif weight hesaplandı:', {
        power,
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

    /** İskelet değişti: mevcut skinning artık geçersiz. */
    invalidate() {
      if (!skinnedMesh) return;

      skinnedMesh = null;
      weights = null;
      stats = null;
      leakage = null;
      poseId = 'bind';

      const mesh = getBaseMesh();
      if (mesh) setSceneMesh(mesh);

      console.warn('[weights] İskelet değişti, skinning sıfırlandı. Yeniden hesapla.');
      refresh();
    },

    reset() {
      skinnedMesh = null;
      weights = null;
      stats = null;
      leakage = null;
      poseId = 'bind';
      refresh();
    },

    get weights() {
      return weights;
    },
  };

  return controller;
}
