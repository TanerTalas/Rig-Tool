import * as THREE from 'three';

/**
 * Weight heatmap ve wireframe.
 *
 * Heatmap ayrı bir material ile çiziliyor (MeshBasicMaterial + vertexColors):
 * ışıklandırma renkleri bozmasın, 0.3 ağırlık her açıdan aynı renkte görünsün.
 * Orijinal material saklanıyor, istendiğinde texture'lı görünüme dönülüyor.
 *
 * Renk rampası: 0 koyu mavi -> 0.25 mavi -> 0.5 yeşil -> 0.75 sarı -> 1 kırmızı.
 * Tek renkli (siyah-kırmızı) bir rampa küçük ağırlıkları ayırt ettirmiyor,
 * asıl merak ettiğimiz şey ise "bu kemik buraya biraz bulaşmış mı" sorusu.
 */

const RAMP = [
  { stop: 0.0, color: [0.05, 0.06, 0.25] },
  { stop: 0.25, color: [0.1, 0.45, 0.9] },
  { stop: 0.5, color: [0.15, 0.8, 0.35] },
  { stop: 0.75, color: [0.98, 0.85, 0.2] },
  { stop: 1.0, color: [0.9, 0.15, 0.15] },
];

const MAX_INFLUENCES = 4;

// Bölge görünümünde seçilmemiş yüzeyin rengi ve aktif seçimin rengi.
const BASE_COLOR = '#9aa3b2';
const SELECTION_COLOR = '#ffc043';
const PATH_COLOR = '#ff4d6d';

export function createDebugView({ scene } = {}) {
  const heatmapMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  // Nokta bulutu: bölge seçerken sınırı görmek dolu yüzeyde zor, vertex'leri
  // doğrudan görmek çok daha okunaklı.
  const pointsMaterial = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.006,
    sizeAttenuation: true,
  });

  let mesh = null;
  let originalMaterial = null;
  let heatmapEnabled = false;
  let points = null;
  let displayMode = 'solid';

  function setMesh(nextMesh) {
    // Önceki mesh heatmap'te kalmışsa kendi material'ına geri döndür.
    if (mesh && originalMaterial) mesh.material = originalMaterial;

    mesh = nextMesh;
    originalMaterial = nextMesh?.material ?? null;
    heatmapEnabled = false;

    disposePoints();
    applyDisplayMode();
  }

  function disposePoints() {
    if (!points) return;
    scene?.remove(points);
    points = null;
  }

  /**
   * Görüntüleme modu.
   *  solid  - dolu yüzey
   *  wire   - tel kafes
   *  points - vertex bulutu + yarı saydam gövde
   *
   * Nokta bulutu bind pose'daki konumları gösteriyor: THREE.Points kemik
   * dönüşümü uygulamıyor, o yüzden poz verilmişken noktalar yerinde kalır.
   * Etiketleme zaten bind pose'da yapıldığı için bu bir sorun değil.
   */
  function setDisplayMode(mode) {
    displayMode = mode;
    applyDisplayMode();
  }

  function applyDisplayMode() {
    if (!mesh) return;

    const material = heatmapEnabled ? heatmapMaterial : originalMaterial;
    if (!material) return;

    material.wireframe = displayMode === 'wire';
    material.transparent = displayMode === 'points';
    material.opacity = displayMode === 'points' ? 0.25 : 1;
    material.depthWrite = displayMode !== 'points';
    material.needsUpdate = true;

    if (displayMode === 'points') {
      if (!points && scene) {
        points = new THREE.Points(mesh.geometry, pointsMaterial);
        points.name = 'region-points';
        points.renderOrder = 996;
        scene.add(points);
      }
    } else {
      disposePoints();
    }
  }

  /**
   * Seçili kemiğin ağırlıklarını vertex color olarak yazar.
   * @param {{skinIndices: Uint16Array, skinWeights: Float32Array}} weights
   * @param {number} boneIndex
   */
  function paintBoneWeights(weights, boneIndex) {
    if (!mesh || !weights) return null;

    const geometry = mesh.geometry;
    const vertexCount = geometry.getAttribute('position').count;

    let attribute = geometry.getAttribute('color');
    if (!attribute || attribute.count !== vertexCount) {
      attribute = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
      geometry.setAttribute('color', attribute);
    }

    const color = new THREE.Color();
    let affected = 0;
    let maxWeight = 0;
    let weightSum = 0;

    for (let v = 0; v < vertexCount; v += 1) {
      let weight = 0;
      for (let i = 0; i < MAX_INFLUENCES; i += 1) {
        if (weights.skinIndices[v * MAX_INFLUENCES + i] === boneIndex) {
          weight += weights.skinWeights[v * MAX_INFLUENCES + i];
        }
      }

      if (weight >= 0.01) affected += 1;
      if (weight > maxWeight) maxWeight = weight;
      weightSum += weight;

      sampleRamp(weight, color);
      // Vertex renkleri lineer uzayda bekleniyor, rampa sRGB olarak yazıldı.
      color.convertSRGBToLinear();
      attribute.setXYZ(v, color.r, color.g, color.b);
    }

    attribute.needsUpdate = true;
    return { affected, maxWeight, weightSum, vertexCount };
  }

  function setHeatmapEnabled(enabled) {
    if (!mesh) return;

    heatmapEnabled = enabled;
    mesh.material = enabled ? heatmapMaterial : originalMaterial;

    // Kapanırken dolu görünüme dön: yarı saydam gövde ve noktalar bölge
    // moduna ait, texture'lı görünümde kafa karıştırıyor.
    if (!enabled) {
      displayMode = 'solid';
      disposePoints();
      if (originalMaterial) {
        originalMaterial.wireframe = false;
        originalMaterial.transparent = false;
        originalMaterial.opacity = 1;
        originalMaterial.depthWrite = true;
        originalMaterial.needsUpdate = true;
      }
    } else {
      applyDisplayMode();
    }
  }

  /**
   * Bölge seçimini ve kayıtlı bölgeleri boyar (Aşama 5).
   *
   * Heatmap ile aynı material ve aynı renk attribute'unu kullanıyor: ikisi
   * aynı anda açık olamaz, panel hangisinin aktif olduğunu yönetiyor.
   *
   * @param {object} params
   * @param {Uint32Array|number[]} params.selection aktif seçim (welded index)
   * @param {Array} params.regions kayıtlı bölgeler
   * @param {object} params.graph welded -> orijinal vertex eşlemesi için
   */
  function paintRegions({ selection, regions, graph, path }) {
    if (!mesh || !graph) return;

    const geometry = mesh.geometry;
    const vertexCount = geometry.getAttribute('position').count;

    let attribute = geometry.getAttribute('color');
    if (!attribute || attribute.count !== vertexCount) {
      attribute = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
      geometry.setAttribute('color', attribute);
    }

    const base = new THREE.Color(BASE_COLOR).convertSRGBToLinear();
    for (let v = 0; v < vertexCount; v += 1) {
      attribute.setXYZ(v, base.r, base.g, base.b);
    }

    const color = new THREE.Color();

    for (const region of regions ?? []) {
      color.set(region.color).convertSRGBToLinear();
      for (const welded of region.vertices) {
        for (const original of graph.weldedToOriginal[welded]) {
          attribute.setXYZ(original, color.r, color.g, color.b);
        }
      }
    }

    // Aktif seçim en üstte: kayıtlı bölgelerin üzerine yazıyor.
    color.set(SELECTION_COLOR).convertSRGBToLinear();
    for (const welded of selection ?? []) {
      for (const original of graph.weldedToOriginal[welded]) {
        attribute.setXYZ(original, color.r, color.g, color.b);
      }
    }

    // Çizilen halka en üstte: nereye çizdiğini seçimin içinde de görmelisin.
    color.set(PATH_COLOR).convertSRGBToLinear();
    for (const welded of path ?? []) {
      for (const original of graph.weldedToOriginal[welded]) {
        attribute.setXYZ(original, color.r, color.g, color.b);
      }
    }

    attribute.needsUpdate = true;
  }

  function setWireframe(enabled) {
    setDisplayMode(enabled ? 'wire' : 'solid');
  }

  function setPointSize(size) {
    pointsMaterial.size = size;
  }

  /**
   * Heatmap kapanırken renk attribute'u siliniyor: aksi halde export edilen
   * GLB'ye COLOR_0 olarak gider ve modeli boyar.
   */
  function clearColors() {
    if (!mesh) return;
    mesh.geometry.deleteAttribute('color');
  }

  return {
    setMesh,
    paintBoneWeights,
    paintRegions,
    setHeatmapEnabled,
    setOverlayEnabled: setHeatmapEnabled,
    setWireframe,
    setDisplayMode,
    setPointSize,
    clearColors,
    get displayMode() {
      return displayMode;
    },
    get isHeatmapEnabled() {
      return heatmapEnabled;
    },
  };
}

function sampleRamp(value, target) {
  const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;

  for (let i = 0; i < RAMP.length - 1; i += 1) {
    const from = RAMP[i];
    const to = RAMP[i + 1];
    if (clamped > to.stop) continue;

    const span = to.stop - from.stop;
    const t = span > 0 ? (clamped - from.stop) / span : 0;

    target.setRGB(
      from.color[0] + (to.color[0] - from.color[0]) * t,
      from.color[1] + (to.color[1] - from.color[1]) * t,
      from.color[2] + (to.color[2] - from.color[2]) * t,
    );
    return target;
  }

  const last = RAMP[RAMP.length - 1].color;
  target.setRGB(last[0], last[1], last[2]);
  return target;
}
