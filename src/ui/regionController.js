import {
  applyRegionOverrides,
  computeWeldedNormals,
  createRegionStore,
  DEFAULT_SELECTION,
  floodFill,
  floodFillBounded,
  invertSelection,
  shortestPath,
} from '../core/regions.js';
import { checkModelHash, downloadJSON, pickJSONFile } from '../core/annotations.js';

/**
 * Bölge seçimi ve weight override akışı (Aşama 5).
 *
 * Seçim canlı: kullanıcı mesafe veya açı slider'ını çevirdiğinde aynı
 * tıklama noktasından yayılma yeniden hesaplanıyor ve modelde anında
 * güncelleniyor. Seçim tamamlanınca isimlendirilip kaydediliyor, ardından
 * bir kemiğe sabitleniyor.
 *
 * Override'lar weight hesabından SONRA uygulanıyor ve her hesapta yeniden
 * uygulanıyor: kullanıcı p üssünü değiştirip yeniden hesapladığında bölge
 * sabitlemeleri kaybolmasın.
 */
export function createRegionController({ view, landmarks, weights, onRefresh }) {
  const store = createRegionStore();

  let graph = null;
  let normals = null;
  let model = null;

  let enabled = false;
  let seed = null;
  let selection = [];
  // 'spread' = tek tıkla yayılan seçim, 'path' = nokta nokta çizilen halka
  let mode = 'path';
  let displayMode = 'points';
  let pointSize = 0.006;
  let pathPoints = [];
  let pathVertices = [];
  let pathClosed = false;
  // Panel her değişimde yeniden çiziliyor; yazılan isim kontrolcüde
  // tutulmazsa her tıklamada siliniyor.
  let pendingName = '';
  // Kayıtlı bir bölge düzenleniyorsa id'si; "Kaydet" yeni bölge açmak yerine
  // bunu güncelliyor.
  let editingRegionId = null;
  // Yeni doldurma mevcut seçimle nasıl birleşsin.
  let combineMode = 'replace';
  let maxDistance = DEFAULT_SELECTION.maxDistance;
  let maxAngle = DEFAULT_SELECTION.maxAngle;
  let activeRegionId = null;
  let lastOverride = null;

  function refresh() {
    onRefresh?.();
  }

  function repaint() {
    if (!enabled || !graph) return;
    // Çizilen halka seçimden ayrı bir renkte gösteriliyor.
    view.paintRegions({ selection, regions: store.list, graph, path: pathVertices });
  }

  /** Tıklanan noktaları en kısa yüzey yollarıyla birleştirir. */
  function rebuildPath() {
    pathVertices = [];
    if (pathPoints.length < 2) {
      pathVertices = [...pathPoints];
      return;
    }

    const collected = new Set();
    const pairs = pathClosed
      ? pathPoints.map((point, i) => [point, pathPoints[(i + 1) % pathPoints.length]])
      : pathPoints.slice(0, -1).map((point, i) => [point, pathPoints[i + 1]]);

    for (const [from, to] of pairs) {
      const segment = shortestPath(graph, from, to);
      if (!segment) {
        console.warn('[region] İki nokta arasında yüzey yolu yok, ayrı adalarda olabilirler.');
        continue;
      }
      for (const vertex of segment) collected.add(vertex);
    }

    pathVertices = Array.from(collected);
  }

  function recompute() {
    if (seed === null || !graph) {
      selection = [];
      repaint();
      return;
    }

    const started = performance.now();
    const result = floodFill(graph, normals, seed, { maxDistance, maxAngle });
    selection = Array.from(result.vertices);
    repaint();

    console.log('[region] seçim:', {
      vertex: selection.length,
      mesafe: maxDistance,
      açı: maxAngle,
      süreMs: Number((performance.now() - started).toFixed(1)),
    });
  }

  /** Yeni doldurmayı mevcut seçimle birleştirir. */
  function applyFill(filled) {
    if (combineMode === 'add') {
      const merged = new Set(selection);
      for (const v of filled) merged.add(v);
      selection = Array.from(merged);
    } else if (combineMode === 'subtract') {
      const removed = new Set(filled);
      selection = selection.filter((v) => !removed.has(v));
    } else {
      selection = Array.from(filled);
    }

    repaint();
    refresh();
  }

  const controller = {
    /**
     * Etiketleme weight'e bağlı değil: parçaları adlandırmak modelin
     * geometrisiyle ilgili bir iş, iskelet kurulmadan da yapılabilir.
     * Kemiğe sabitleme ise ağırlıklar hesaplandıktan sonra anlam kazanıyor.
     */
    get isAvailable() {
      return Boolean(graph);
    },
    get canBind() {
      return Boolean(weights.isSkinned && landmarks.skeleton);
    },
    get enabled() {
      return enabled;
    },
    get selectionSize() {
      return selection.length;
    },
    get hasSelection() {
      return selection.length > 0;
    },
    get maxDistance() {
      return maxDistance;
    },
    get maxAngle() {
      return maxAngle;
    },
    get mode() {
      return mode;
    },
    get displayMode() {
      return displayMode;
    },
    get pointSize() {
      return pointSize;
    },
    get pathPointCount() {
      return pathPoints.length;
    },
    get pathVertexCount() {
      return pathVertices.length;
    },
    get pathClosed() {
      return pathClosed;
    },
    get pendingName() {
      return pendingName;
    },
    get editingRegionId() {
      return editingRegionId;
    },
    get editingRegion() {
      return editingRegionId === null ? null : store.get(editingRegionId);
    },
    get combineMode() {
      return combineMode;
    },

    setCombineMode(value) {
      combineMode = value;
      refresh();
    },

    setPendingName(value) {
      pendingName = value;
    },
    get regions() {
      return store.list;
    },
    get store() {
      return store;
    },
    get activeRegionId() {
      return activeRegionId;
    },
    get lastOverride() {
      return lastOverride;
    },
    get labeledCount() {
      return store.labeledCount;
    },
    get vertexCount() {
      return graph?.weldedCount ?? 0;
    },
    get boneNames() {
      return landmarks.skeleton?.bones.map((bone) => bone.name) ?? [];
    },

    setModel(loaded, adjacency) {
      model = loaded;
      graph = adjacency;
      normals = adjacency ? computeWeldedNormals(loaded.mesh.geometry, adjacency) : null;
      store.clear();
      seed = null;
      selection = [];
      activeRegionId = null;
      enabled = false;
      refresh();
    },

    setEnabled(value) {
      enabled = value;

      if (enabled) {
        repaint();
        view.setOverlayEnabled(true);
        view.setDisplayMode(displayMode);
        view.setPointSize(pointSize);
      } else {
        view.setOverlayEnabled(false);
        view.clearColors();
      }

      refresh();
    },

    setDisplayMode(value) {
      displayMode = value;
      view.setDisplayMode(value);
      refresh();
    },

    setPointSize(value) {
      pointSize = value;
      view.setPointSize(value);
      refresh();
    },

    setMode(value) {
      mode = value;
      controller.clearPath();
      controller.clearSelection();
      refresh();
    },

    /**
     * Halkayı kapatır ve küçük tarafı otomatik doldurur.
     *
     * Bir parçanın çevresine halka çizen kullanıcı neredeyse her zaman o
     * parçayı istiyor, yani küçük tarafı. Yanlış tahmin edersek "Tersine
     * çevir" tek tıklık.
     */
    closePath() {
      if (pathPoints.length < 3) return;
      pathClosed = true;
      rebuildPath();
      controller.fillSmallerSide();
      refresh();
    },

    /** Halkanın iki tarafını da hesaplayıp küçük olanı seçer. */
    fillSmallerSide() {
      if (!pathVertices.length) return;

      const barrier = new Set(pathVertices);
      let seed = -1;
      for (let v = 0; v < graph.weldedCount; v += 1) {
        if (!barrier.has(v)) { seed = v; break; }
      }
      if (seed < 0) return;

      const first = floodFillBounded(graph, seed, barrier);
      const firstSet = new Set(first);

      let otherSeed = -1;
      for (let v = 0; v < graph.weldedCount; v += 1) {
        if (!firstSet.has(v) && !barrier.has(v)) { otherSeed = v; break; }
      }

      if (otherSeed < 0) {
        // Halka kapanmamış: tek taraf var, tümü seçildi.
        applyFill(first);
        console.warn('[region] Halka meshi ikiye bölmüyor; seçim tüm modeli kapsıyor.');
      } else {
        const second = floodFillBounded(graph, otherSeed, barrier);
        applyFill(first.length <= second.length ? first : second);
      }

      console.log('[region] halka kapatıldı, küçük taraf seçildi:', selection.length, 'vertex');
    },

    /** Halkanın bir tarafını doldurur; tıklanan taraf seçilir. */
    fillFrom(welded) {
      if (!pathVertices.length) return;
      applyFill(floodFillBounded(graph, welded, new Set(pathVertices)));
      console.log('[region] halka dolduruldu:', selection.length, 'vertex');
    },

    invert() {
      if (!graph || !selection.length) return;
      selection = Array.from(invertSelection(graph, selection));
      repaint();
      refresh();
      console.log('[region] seçim tersine çevrildi:', selection.length, 'vertex');
    },

    undoPathPoint() {
      if (!pathPoints.length) return;
      pathPoints.pop();
      pathClosed = false;
      rebuildPath();
      repaint();
      refresh();
    },

    clearPath() {
      pathPoints = [];
      pathVertices = [];
      pathClosed = false;
      repaint();
      refresh();
    },

    setMaxDistance(value) {
      maxDistance = value;
      recompute();
      refresh();
    },

    setMaxAngle(value) {
      maxAngle = value;
      recompute();
      refresh();
    },

    /** Modele tıklama: moda göre nokta ekler veya yayılma yapar. */
    handlePick(hit) {
      if (!graph || hit.nearestVertexIndex === null || hit.nearestVertexIndex === undefined) return;

      const welded = graph.originalToWelded[hit.nearestVertexIndex];

      if (mode === 'path') {
        // Halka kapandıktan sonraki tıklama "hangi tarafı istiyorum" demek.
        if (pathClosed) {
          controller.fillFrom(welded);
          return;
        }

        pathPoints.push(welded);
        rebuildPath();
        repaint();
        refresh();
        return;
      }

      if (hit.shiftKey || hit.altKey) {
        // Shift ekler, Alt çıkarır: aynı yayılmayı yeni noktadan hesaplayıp
        // mevcut seçimle birleştiriyoruz.
        const result = floodFill(graph, normals, welded, { maxDistance, maxAngle });
        const current = new Set(selection);

        for (const vertex of result.vertices) {
          if (hit.altKey) current.delete(vertex);
          else current.add(vertex);
        }

        selection = Array.from(current);
        seed = welded;
        repaint();
        refresh();
        return;
      }

      seed = welded;
      recompute();
      refresh();
    },

    clearSelection() {
      seed = null;
      selection = [];
      editingRegionId = null;
      pendingName = '';
      combineMode = 'replace';
      repaint();
      refresh();
    },

    /**
     * Seçimi kaydeder. Bir bölge düzenleniyorsa onu günceller, aksi halde
     * yeni bölge açar.
     */
    saveRegion(name, { asNew = false } = {}) {
      if (!selection.length) return null;

      if (editingRegionId !== null && !asNew) {
        const updated = store.update(editingRegionId, { name: name ?? pendingName, vertices: selection });
        controller.reapply();
        repaint();
        refresh();
        console.log(`[region] "${updated.name}" güncellendi:`, updated.vertices.length, 'vertex');
        return updated;
      }

      const region = store.add({ name: name ?? pendingName, vertices: selection });
      pendingName = '';
      editingRegionId = null;
      combineMode = 'replace';
      activeRegionId = region.id;
      seed = null;
      selection = [];
      pathPoints = [];
      pathVertices = [];
      pathClosed = false;
      repaint();
      refresh();

      console.log(`[region] "${region.name}" kaydedildi:`, region.vertices.length, 'vertex');
      return region;
    },

    selectRegion(id) {
      const region = store.get(id);
      if (!region) return;

      activeRegionId = id;
      editingRegionId = id;
      pendingName = region.name;
      selection = Array.from(region.vertices);
      seed = null;
      pathPoints = [];
      pathVertices = [];
      pathClosed = false;
      // Düzenlemeye girerken varsayılan davranış eklemek: kullanıcı genelde
      // bölgeyi büyütmek için geri dönüyor.
      combineMode = 'add';
      repaint();
      refresh();
    },

    /** Düzenlemeyi bırakır, sonraki kayıt yeni bölge açar. */
    stopEditing() {
      editingRegionId = null;
      pendingName = '';
      combineMode = 'replace';
      refresh();
    },

    removeRegion(id) {
      store.remove(id);
      if (activeRegionId === id) activeRegionId = null;
      if (editingRegionId === id) {
        editingRegionId = null;
        pendingName = '';
        selection = [];
      }
      repaint();
      controller.reapply();
      refresh();
    },

    renameRegion(id, name) {
      store.rename(id, name);
      refresh();
    },

    /** Bölgenin ağırlığını tek kemiğe verir. */
    bindRegion(id, boneName) {
      store.bindTo(id, boneName || null);
      controller.reapply();
      refresh();
    },

    /** Sabitleme oranı: 1 tamamen kemiğe, 0.5 yarı yarıya karışık. */
    setRegionStrength(id, strength) {
      store.setStrength(id, strength);
      controller.reapply();
      refresh();
    },

    /**
     * Override'ları mevcut ağırlıklara uygular ve SkinnedMesh'i tazeler.
     * Weight yeniden hesaplandığında da çağrılıyor.
     */
    applyOverrides(weightData) {
      if (!graph || !weightData) return null;

      lastOverride = applyRegionOverrides(
        weightData,
        store.list,
        controller.boneNames,
        graph,
      );

      return lastOverride;
    },

    /** Ağırlıklar zaten hesaplanmışsa override'ı yeniden uygulayıp yazar. */
    reapply() {
      if (!weights.isSkinned) return;
      weights.reapplyOverrides();
      repaint();
    },

    saveJSON() {
      if (!graph) return;
      const base = model?.fileName?.replace(/\.glb$/i, '') ?? 'model';
      downloadJSON(store.toJSON(model?.modelHash, graph), `${base}.regions.json`);
    },

    async loadJSON() {
      try {
        const json = await pickJSONFile();
        if (!json) return;
        controller.applyJSON(json);
      } catch (error) {
        console.error('[region] JSON okunamadı:', error);
      }
    },

    applyJSON(json) {
      if (!graph) {
        console.warn('[region] Önce bir GLB yükle.');
        return;
      }

      const check = checkModelHash(json, model?.modelHash);
      if (check.known && !check.match) {
        console.warn('[region] Bu dosya başka bir modele ait, bölgeler yanlış yere düşebilir.');
      }

      const count = store.fromJSON(json, graph);
      activeRegionId = null;
      selection = [];
      seed = null;
      controller.reapply();
      repaint();
      refresh();

      console.log(`[region] ${count} bölge yüklendi.`);
    },
  };

  return controller;
}
