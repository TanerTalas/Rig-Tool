import * as THREE from 'three';

import {
  buildContextMarkdown,
  buildExportMesh,
  buildRigJSON,
  exportGLB,
} from '../core/exporter.js';
import { downloadBlob, downloadJSON } from '../core/annotations.js';

/**
 * Export akışı (Aşama 6).
 *
 * Üç dosya da aynı export mesh'inden üretiliyor: GLB'deki koordinatlarla
 * context.md'deki koordinatlar birebir aynı olmalı, yoksa asistana verilen
 * bilgi yanlış yeri gösterir.
 */
export function createExportController({ landmarks, weights, regions, getState, onRefresh }) {
  let originalScale = true;
  let lastResult = null;
  let busy = false;

  function refresh() {
    onRefresh?.();
  }

  function baseName() {
    return getState().model?.fileName?.replace(/\.glb$/i, '') ?? 'model';
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function run(task) {
    if (!controller.isAvailable || busy) return;

    busy = true;
    refresh();

    try {
      await task();
    } catch (error) {
      console.error('[export] başarısız:', error);
      lastResult = { error: error.message };
    } finally {
      busy = false;
      refresh();
    }
  }

  /** Export mesh'inin boyutları; context.md ve istatistikler için. */
  function measure(built) {
    const size = new THREE.Vector3();
    new THREE.Box3()
      .setFromBufferAttribute(built.mesh.geometry.getAttribute('position'))
      .getSize(size);
    return size;
  }

  const controller = {
    get isAvailable() {
      return Boolean(weights.isSkinned && landmarks.skeleton && getState().model);
    },
    get originalScale() {
      return originalScale;
    },
    get lastResult() {
      return lastResult;
    },
    get busy() {
      return busy;
    },

    setOriginalScale(value) {
      originalScale = value;
      refresh();
    },

    /** Export edilecek mesh'i kurar; hem indirme hem doğrulama bunu kullanıyor. */
    build() {
      const state = getState();

      return buildExportMesh({
        baseMesh: state.baseMesh,
        weights: weights.weights,
        landmarks: landmarks.store.toMap(),
        normalizeMatrix: state.model.normalizeMatrix,
        originalScale,
      });
    },

    /** Skinned GLB. */
    exportModel() {
      return run(async () => {
        const built = controller.build();
        const glb = await exportGLB(built.mesh);
        downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), `${baseName()}.rigged.glb`);

        const size = measure(built);
        lastResult = {
          glbBytes: glb.byteLength,
          boneCount: built.rig.bones.length,
          regionCount: regions.regions.length,
          height: size.y,
          vertexCount: built.mesh.geometry.getAttribute('position').count,
        };
        console.log('[export] GLB indirildi:', lastResult);
      });
    },

    /** Araca geri yüklenebilir ham veri. */
    exportRigJSON() {
      return run(async () => {
        const state = getState();
        const built = controller.build();

        downloadJSON(
          buildRigJSON({
            model: state.model,
            landmarkStore: landmarks.store,
            regionStore: regions.store,
            graph: state.baseMesh.userData.adjacency,
            skeleton: built.rig,
            stats: state.stats,
          }),
          `${baseName()}.rig.json`,
        );
        console.log('[export] rig.json indirildi.');
      });
    },

    /** Asistana verilecek okunabilir özet. */
    exportContext() {
      return run(async () => {
        const state = getState();
        const built = controller.build();

        const markdown = buildContextMarkdown({
          model: state.model,
          skeleton: built.rig,
          regions: regions.regions,
          graph: state.baseMesh.userData.adjacency,
          stats: state.stats,
          exportedScale: {
            matrix: built.matrix,
            height: measure(built).y,
            facing: landmarks.validation?.info?.facing?.direction ?? 1,
          },
        });

        downloadBlob(new Blob([markdown], { type: 'text/markdown' }), `${baseName()}.context.md`);
        console.log('[export] context.md indirildi.');
      });
    },

    /**
     * Üçünü peş peşe indirir.
     *
     * Aralarda bekleniyor: Chrome aynı sayfadan hızlı arka arkaya gelen
     * indirmeleri engelliyor ve ilkinden sonrakiler sessizce düşüyor. İlk
     * seferde tarayıcı "birden fazla dosya inebilir mi" diye sorabilir.
     */
    async exportAll() {
      await controller.exportModel();
      await wait(600);
      await controller.exportRigJSON();
      await wait(600);
      await controller.exportContext();
    },
  };

  return controller;
}
