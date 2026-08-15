import { DEGREE } from '../core/pose.js';

const MAX_INFLUENCES = 4;

/**
 * Teşhis araçları (Aşama 3).
 *
 * Weight algoritması görsel geri bildirim olmadan geliştirilemez: hangi
 * kemiğin nereye bulaştığını görmeden Aşama 4'ün işe yarayıp yaramadığı
 * anlaşılamaz. Bu kontrolcü üç şeyi yönetiyor:
 *
 * - seçili kemiğin heatmap'i ve etkilenen vertex sayısı
 * - seçili kemiği X/Y/Z'de döndüren manuel poz
 * - modele tıklayınca o vertex'in ağırlık dökümü
 */
export function createDebugController({ view, landmarks, weights, onRefresh }) {
  let selectedBone = null;
  let heatmapEnabled = false;
  let wireframe = false;
  let heatmapStats = null;
  let inspection = null;

  function refresh() {
    onRefresh?.();
  }

  function repaint() {
    if (!heatmapEnabled || selectedBone === null) return;
    heatmapStats = view.paintBoneWeights(weights.weights, selectedBone);
  }

  const controller = {
    get bones() {
      return landmarks.skeleton?.bones ?? [];
    },
    get selectedBone() {
      return selectedBone;
    },
    get selectedBoneName() {
      return selectedBone === null ? null : (controller.bones[selectedBone]?.name ?? null);
    },
    get heatmapEnabled() {
      return heatmapEnabled;
    },
    get wireframe() {
      return wireframe;
    },
    get heatmapStats() {
      return heatmapStats;
    },
    get inspection() {
      return inspection;
    },
    get isAvailable() {
      return Boolean(weights.isSkinned && landmarks.skeleton);
    },

    selectBone(index) {
      selectedBone = index;
      repaint();
      refresh();
    },

    setHeatmapEnabled(enabled) {
      heatmapEnabled = enabled;

      if (enabled) {
        if (selectedBone === null) selectedBone = 0;
        repaint();
        view.setHeatmapEnabled(true);
      } else {
        view.setHeatmapEnabled(false);
        view.clearColors();
        heatmapStats = null;
      }

      refresh();
    },

    setWireframe(enabled) {
      wireframe = enabled;
      view.setWireframe(enabled);
      refresh();
    },

    /** Seçili kemiğin bir eksendeki dönüşü, derece cinsinden. */
    getRotation(axis) {
      const bone = controller.bones[selectedBone];
      return bone ? bone.rotation[axis] / DEGREE : 0;
    },

    setRotation(axis, degrees) {
      const bone = controller.bones[selectedBone];
      if (!bone) return;

      bone.rotation[axis] = degrees * DEGREE;
      bone.updateMatrixWorld(true);
      weights.markCustomPose();
      refresh();
    },

    resetBoneRotation() {
      const bone = controller.bones[selectedBone];
      if (!bone) return;

      bone.rotation.set(0, 0, 0);
      bone.updateMatrixWorld(true);
      weights.markCustomPose();
      refresh();
    },

    /**
     * Modele tıklandığında o vertex'in ağırlık dökümü.
     * Baskın kemik otomatik seçiliyor: "bu nokta neden oynuyor" sorusunun
     * cevabı genelde ilk satırda.
     */
    handlePick(hit) {
      const data = weights.weights;
      const vertex = hit.nearestVertexIndex;
      if (!data || vertex === null || vertex === undefined) return;

      const bones = controller.bones;
      const influences = [];

      for (let i = 0; i < MAX_INFLUENCES; i += 1) {
        const boneIndex = data.skinIndices[vertex * MAX_INFLUENCES + i];
        const weight = data.skinWeights[vertex * MAX_INFLUENCES + i];
        if (weight <= 0) continue;
        influences.push({ boneIndex, name: bones[boneIndex]?.name ?? '?', weight });
      }

      inspection = { vertex, influences };

      if (influences.length) {
        selectedBone = influences[0].boneIndex;
        repaint();
      }

      console.log(`[inspect] vertex ${vertex}:`, influences
        .map((entry) => `${entry.name}=${entry.weight.toFixed(3)}`)
        .join('  '));

      refresh();
    },

    /**
     * Weight yeniden hesaplandığında heatmap tazelensin.
     *
     * Yeni bir SkinnedMesh üretildiğinde view kendi material durumunu
     * sıfırlıyor; heatmap açık kalmışsa burada tekrar devreye alınmalı,
     * yoksa kutu işaretli görünürken model texture'lı çizilir.
     */
    onWeightsChanged() {
      inspection = null;

      if (!weights.isSkinned) {
        heatmapEnabled = false;
        heatmapStats = null;
        selectedBone = null;
        return;
      }

      if (heatmapEnabled) {
        repaint();
        view.setHeatmapEnabled(true);
        view.setWireframe(wireframe);
      }
    },
  };

  return controller;
}
