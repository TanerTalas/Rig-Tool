import { createLandmarkStore, getLandmarkDefinition, humanoidTemplate } from '../core/landmarks.js';
import { buildSkeleton } from '../core/skeleton.js';
import { checkModelHash, downloadJSON, pickJSONFile } from '../core/annotations.js';
import { MIRROR_GROUPS, validateLandmarks } from '../core/validate.js';

/**
 * Landmark akışının beyni: depo, sahne görselleştirmesi ve panel arasında
 * köprü kuruyor.
 *
 * Tüm landmark'lar yerleştiği anda iskelet otomatik olarak (yeniden) kuruluyor;
 * kullanıcı bir landmark'ı düzeltince iskelet anında güncelleniyor, böylece
 * "işaretle - bak - düzelt" döngüsü kesintisiz oluyor.
 */
export function createLandmarkController({ view, onRefresh, onSkeletonChange }) {
  const store = createLandmarkStore();

  let model = null;
  let activeId = null;
  let useCenterPoint = true;
  let skeletonVisible = true;
  let markersVisible = true;
  let skeleton = null;
  let skeletonError = null;
  let lastPlacement = null;

  let validation = null;

  store.subscribe(() => {
    view.setLandmarks(store.entries());
    rebuildSkeleton();
    runValidation();
    refresh();
  });

  /**
   * Denetim sadece set tamamlanınca çalışıyor: eksik landmark'la yapılan
   * kontroller yarısı boş bir iskelet hakkında yanıltıcı sonuç verir, ayrıca
   * mesh içi testi her tıklamada çalıştırmaya değmez.
   */
  function runValidation() {
    if (store.missingIds.length || !model) {
      validation = null;
      return;
    }

    validation = validateLandmarks(store.toMap(), model.mesh);

    const errors = validation.issues.filter((issue) => issue.level === 'error');
    const warnings = validation.issues.filter((issue) => issue.level === 'warn');

    console.log('[validate]', {
      midline: Number(validation.info.midline.toFixed(4)),
      facing: validation.info.facing?.direction > 0 ? '+Z' : '-Z',
      errors: errors.length,
      warnings: warnings.length,
    });
    for (const issue of validation.issues) {
      const log = issue.level === 'error' ? console.error : console.warn;
      log(`[validate] ${issue.message}`);
    }
  }

  function refresh() {
    view.setActive(activeId);
    onRefresh?.();
  }

  function rebuildSkeleton() {
    const missing = store.missingIds;

    if (missing.length) {
      skeleton = null;
      skeletonError = null;
      view.clearSkeleton();
      onSkeletonChange?.(null);
      return;
    }

    try {
      skeleton = buildSkeleton(store.toMap());
      skeletonError = null;
      view.setSkeleton(skeleton.root);
      view.setSkeletonVisible(skeletonVisible);
      onSkeletonChange?.(skeleton);

      console.log('[skeleton] kuruldu:', {
        bones: skeleton.bones.length,
        root: skeleton.root.name,
      });
    } catch (error) {
      skeleton = null;
      skeletonError = error.message;
      view.clearSkeleton();
      onSkeletonChange?.(null);
      console.error('[skeleton] kurulamadı:', error);
    }
  }

  const controller = {
    get isReady() {
      return Boolean(model);
    },
    get placedCount() {
      return store.placedCount;
    },
    get entries() {
      return store.entries();
    },
    get activeId() {
      return activeId;
    },
    get activeDefinition() {
      return activeId ? getLandmarkDefinition(activeId) : null;
    },
    get mirrorEnabled() {
      return store.mirrorEnabled;
    },
    get useCenterPoint() {
      return useCenterPoint;
    },
    get hasSkeleton() {
      return Boolean(skeleton);
    },
    get boneCount() {
      return skeleton?.bones.length ?? 0;
    },
    get skeletonError() {
      return skeletonError;
    },
    get skeletonVisible() {
      return skeletonVisible;
    },
    get markersVisible() {
      return markersVisible;
    },
    get skeleton() {
      return skeleton;
    },
    get store() {
      return store;
    },

    setModel(loaded) {
      model = loaded;
      store.clearAll();
      activeId = store.nextMissingId();
      refresh();
    },

    setActive(id) {
      activeId = id;
      refresh();
    },

    setMirrorEnabled(value) {
      store.setMirrorEnabled(value);
    },

    setUseCenterPoint(value) {
      useCenterPoint = value;
      refresh();
    },

    setSkeletonVisible(value) {
      skeletonVisible = value;
      view.setSkeletonVisible(value);
      refresh();
    },

    setMarkersVisible(value) {
      markersVisible = value;
      view.setMarkersVisible(value);
      refresh();
    },

    clear(id) {
      store.clear(id);
      activeId = id;
      refresh();
    },

    clearAll() {
      store.clearAll();
      activeId = store.nextMissingId();
      refresh();
    },

    get lastPlacement() {
      return lastPlacement;
    },

    get validation() {
      return validation;
    },

    /** Denetimin bulduğu sol/sağ karışıklığını tek hamlede düzeltir. */
    swapGroup(group) {
      const pairs = MIRROR_GROUPS[group];
      if (!pairs) return;

      for (const pair of pairs) {
        store.swap(pair.left, pair.right);
      }
      console.log(`[landmark] ${group} sol/sağ takas edildi.`);
    },

    /** Picker'dan gelen tıklama. */
    handlePick(hit) {
      if (!activeId) return;

      const position = useCenterPoint ? hit.centerPoint : hit.surfacePoint;
      const definition = getLandmarkDefinition(activeId);

      // Teşhis: ışın ikiden fazla yüzey deldiyse ilk kabuk aradığımız uzuv
      // olmayabilir (atkı, saç, bol kıyafet). Merkez tahmini o zaman
      // landmark'ı yanlış parçanın içine koyar.
      lastPlacement = {
        id: activeId,
        label: definition?.label ?? activeId,
        shift: useCenterPoint ? hit.surfacePoint.distanceTo(hit.centerPoint) : 0,
        thickness: hit.thickness,
        hitCount: hit.hitCount,
        suspicious: useCenterPoint && hit.hitCount > 2,
      };

      store.set(activeId, position);

      console.log('[landmark]', activeId, {
        surface: hit.surfacePoint.toArray().map((value) => Number(value.toFixed(4))),
        center: hit.centerPoint.toArray().map((value) => Number(value.toFixed(4))),
        thickness: Number(hit.thickness.toFixed(4)),
        hitCount: hit.hitCount,
      });

      // Sıra bir sonraki boş landmark'a geçiyor; hepsi doluysa aktif kalmıyor.
      activeId = store.nextMissingId(activeId);
      refresh();
    },

    saveJSON() {
      const data = store.toJSON(model?.modelHash);
      const base = model?.fileName?.replace(/\.glb$/i, '') ?? 'model';
      downloadJSON(data, `${base}.landmarks.json`);
    },

    async loadJSON() {
      try {
        const json = await pickJSONFile();
        if (!json) return;
        controller.applyJSON(json);
      } catch (error) {
        console.error('[landmark] JSON okunamadı:', error);
      }
    },

    /** Dosya seçiciden veya sürükle-bırak'tan gelen JSON. */
    applyJSON(json) {
      const check = checkModelHash(json, model?.modelHash);
      if (check.known && !check.match) {
        console.warn(
          '[landmark] Bu dosya başka bir modele ait (modelHash uyuşmuyor). ' +
            'Yine de yükleniyor, iskeletin doğru oturduğunu gözle kontrol et.',
        );
      }

      const result = store.fromJSON(json);
      if (result.unknown.length) {
        console.warn('[landmark] Şablonda olmayan landmark atlandı:', result.unknown);
      }

      activeId = store.nextMissingId();
      refresh();
      console.log(`[landmark] ${result.loaded} landmark yüklendi.`);
    },

    get template() {
      return humanoidTemplate;
    },
  };

  return controller;
}
