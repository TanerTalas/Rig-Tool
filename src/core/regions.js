import * as THREE from 'three';

/**
 * Bölge seçimi (flood fill) ve manuel weight override.
 *
 * Otomatik weight ne kadar iyi olursa olsun atkı, pelerin, saç gibi
 * parçalarda sızıntı kalıyor: bu parçalar havada bir uzva yapışık duruyor
 * ama aslında gövdeye bağlılar. Aşama 4'ün sonunda pelerin hâlâ %28 kola
 * bağlıydı. Burada kullanıcı o parçayı seçip tek kemiğe sabitliyor.
 *
 * Seçim mesh yüzeyinde yayılıyor: tıklanan vertex'ten komşulara doğru
 * büyüyor ve iki koşuldan biri sağlanınca duruyor:
 *  - geodezik mesafe limitini aştı
 *  - komşu yüzeyle arasındaki açı eşiği aştı (keskin kenar = doğal sınır)
 */

const MAX_INFLUENCES = 4;

export const DEFAULT_SELECTION = {
  maxDistance: 0.15,
  // Derece. 180 = açı kontrolü kapalı, sadece mesafe sınırlar.
  maxAngle: 60,
};

// Bölge renkleri sırayla dağıtılıyor; okunabilir ve birbirinden ayrık tonlar.
/**
 * Etiketleme için hazır parça isimleri.
 *
 * Bölgeler sadece weight düzeltmek için değil, modelin parçalarını
 * ADLANDIRMAK için de var: "burası atkı, burası sol el" bilgisi bir kez
 * çıkarıldığında regions.json ile birlikte taşınıyor ve sonraki her işte
 * (texture boyama, parça bazlı malzeme, animasyon kısıtları) kullanılabiliyor.
 */
export const REGION_PRESETS = [
  'Kafa', 'Saç', 'Yüz', 'Boyun', 'Atkı', 'Yaka', 'Pelerin', 'Kıyafet',
  'Kemer', 'Etek', 'Sol El', 'Sağ El', 'Sol Kol', 'Sağ Kol',
  'Sol Ayak', 'Sağ Ayak', 'Sol Bacak', 'Sağ Bacak', 'Aksesuar',
];

export const REGION_COLORS = [
  '#e05252', '#4da3ff', '#62e08a', '#e0a852', '#b98ce0',
  '#4ecdc4', '#ff8fab', '#c9d64a', '#8d9db6', '#e07a3f',
];

/**
 * Welded vertex başına normal.
 * Aynı konumdaki kopyaların normalleri ortalanıyor: UV seam'inde iki farklı
 * normal olabiliyor, seçimin dikişte durmaması için tek değere indiriliyor.
 */
export function computeWeldedNormals(geometry, graph) {
  const source = geometry.getAttribute('normal');
  const normals = new Float32Array(graph.weldedCount * 3);

  if (!source) {
    // Normal yoksa açı kontrolü anlamsız; hepsini aynı yöne bakıyor say.
    for (let v = 0; v < graph.weldedCount; v += 1) normals[v * 3 + 1] = 1;
    return normals;
  }

  for (let v = 0; v < graph.weldedCount; v += 1) {
    let x = 0;
    let y = 0;
    let z = 0;

    for (const original of graph.weldedToOriginal[v]) {
      x += source.getX(original);
      y += source.getY(original);
      z += source.getZ(original);
    }

    const length = Math.hypot(x, y, z) || 1;
    normals[v * 3] = x / length;
    normals[v * 3 + 1] = y / length;
    normals[v * 3 + 2] = z / length;
  }

  return normals;
}

/**
 * Tıklanan vertex'ten yüzeyde yayılan seçim.
 *
 * @param {object} graph komşuluk grafiği
 * @param {Float32Array} normals welded vertex normalleri
 * @param {number} seed welded vertex index
 * @param {{maxDistance: number, maxAngle: number}} options
 * @returns {{ vertices: Uint32Array, distances: Float32Array }}
 */
export function floodFill(graph, normals, seed, options = {}) {
  const maxDistance = options.maxDistance ?? DEFAULT_SELECTION.maxDistance;
  const maxAngle = options.maxAngle ?? DEFAULT_SELECTION.maxAngle;
  const cosLimit = Math.cos((maxAngle * Math.PI) / 180);

  const distances = new Float32Array(graph.weldedCount).fill(Infinity);
  const visited = new Uint8Array(graph.weldedCount);
  const result = [];

  // Basit öncelik kuyruğu: seçim mesafeyle sınırlı olduğu için kuyruk küçük
  // kalıyor, ikili yığın karmaşıklığına gerek yok.
  const queue = [seed];
  distances[seed] = 0;

  while (queue.length) {
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (distances[queue[i]] < distances[queue[bestIndex]]) bestIndex = i;
    }

    const current = queue[bestIndex];
    queue[bestIndex] = queue[queue.length - 1];
    queue.pop();

    if (visited[current]) continue;
    visited[current] = 1;
    result.push(current);

    const distance = distances[current];

    for (let i = graph.neighborOffsets[current]; i < graph.neighborOffsets[current + 1]; i += 1) {
      const neighbor = graph.neighborIndices[i];
      if (visited[neighbor]) continue;

      // Keskin kenar kontrolü: iki yüzeyin normalleri arasındaki açı.
      const dot =
        normals[current * 3] * normals[neighbor * 3] +
        normals[current * 3 + 1] * normals[neighbor * 3 + 1] +
        normals[current * 3 + 2] * normals[neighbor * 3 + 2];
      if (dot < cosLimit) continue;

      const candidate = distance + graph.neighborWeights[i];
      if (candidate > maxDistance || candidate >= distances[neighbor]) continue;

      distances[neighbor] = candidate;
      queue.push(neighbor);
    }
  }

  return { vertices: Uint32Array.from(result), distances };
}

/**
 * İki vertex arasındaki en kısa yüzey yolu.
 *
 * Kullanıcı parçanın çevresine nokta nokta tıklıyor, aradaki yolu biz
 * dolduruyoruz: elin bileğine dört tıklama yapmak, o dört noktayı birleştiren
 * bir halka çiziyor.
 */
export function shortestPath(graph, from, to) {
  const distances = new Float64Array(graph.weldedCount).fill(Infinity);
  const previous = new Int32Array(graph.weldedCount).fill(-1);
  const visited = new Uint8Array(graph.weldedCount);
  const queue = [from];
  distances[from] = 0;

  while (queue.length) {
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (distances[queue[i]] < distances[queue[bestIndex]]) bestIndex = i;
    }

    const current = queue[bestIndex];
    queue[bestIndex] = queue[queue.length - 1];
    queue.pop();

    if (visited[current]) continue;
    visited[current] = 1;
    if (current === to) break;

    for (let i = graph.neighborOffsets[current]; i < graph.neighborOffsets[current + 1]; i += 1) {
      const neighbor = graph.neighborIndices[i];
      if (visited[neighbor]) continue;

      const candidate = distances[current] + graph.neighborWeights[i];
      if (candidate >= distances[neighbor]) continue;

      distances[neighbor] = candidate;
      previous[neighbor] = current;
      queue.push(neighbor);
    }
  }

  if (!Number.isFinite(distances[to])) return null;

  const path = [to];
  let step = to;
  while (step !== from) {
    step = previous[step];
    if (step < 0) return null;
    path.push(step);
  }

  return path.reverse();
}

/**
 * Bariyeri aşmadan yayılan doldurma.
 *
 * Çizilen halka "duvar" oluyor, tıklanan taraf doluyor. Halka kapalı değilse
 * yayılma etrafından dolaşıp tüm modeli seçer; kullanıcı bunu gördüğünde ya
 * halkayı kapatır ya da tersine çevirir.
 *
 * @param {Set<number>|Uint8Array} blocked bariyer vertex'leri
 */
export function floodFillBounded(graph, seed, blocked) {
  const isBlocked = blocked instanceof Set ? (v) => blocked.has(v) : (v) => blocked[v] === 1;

  const visited = new Uint8Array(graph.weldedCount);
  const stack = [seed];
  const result = [];

  if (isBlocked(seed)) return Uint32Array.from([seed]);
  visited[seed] = 1;

  while (stack.length) {
    const current = stack.pop();
    result.push(current);

    for (let i = graph.neighborOffsets[current]; i < graph.neighborOffsets[current + 1]; i += 1) {
      const neighbor = graph.neighborIndices[i];
      if (visited[neighbor]) continue;

      visited[neighbor] = 1;
      // Bariyerin kendisi seçime dahil, ötesi değil.
      if (isBlocked(neighbor)) {
        result.push(neighbor);
        continue;
      }

      stack.push(neighbor);
    }
  }

  return Uint32Array.from(result);
}

/** Seçimin tümleyeni: tüm vertex'ler eksi seçim. */
export function invertSelection(graph, selection) {
  const selected = new Set(selection);
  const result = [];

  for (let v = 0; v < graph.weldedCount; v += 1) {
    if (!selected.has(v)) result.push(v);
  }

  return Uint32Array.from(result);
}

/**
 * Bölge deposu.
 * Bölgeler welded vertex index'leriyle tutuluyor; dosyaya yazarken orijinal
 * index'lere açılıyor ki başka bir araç da okuyabilsin.
 */
export function createRegionStore() {
  const regions = [];
  let nextId = 1;

  return {
    get list() {
      return regions;
    },

    /**
     * @param {object} params
     * @param {boolean} [params.exclusive] true ise bu vertex'ler diğer
     *   bölgelerden çıkarılır. Etiketleme bir bölüştürme olmalı: bir vertex
     *   hem "atkı" hem "el" olamaz, yoksa hangi kemiğe sabitleneceği
     *   bölgelerin sırasına kalır.
     */
    add({ name, vertices, boundBone = null, strength = 1, exclusive = true }) {
      if (exclusive) {
        const claimed = new Set(vertices);
        for (const other of regions) {
          const kept = Array.from(other.vertices).filter((v) => !claimed.has(v));
          if (kept.length !== other.vertices.length) {
            other.vertices = Uint32Array.from(kept);
          }
        }
      }

      const region = {
        id: nextId,
        name: name?.trim() || `Bölge ${nextId}`,
        vertices: Uint32Array.from(vertices),
        boundBone,
        // 1 = tamamen kemiğe sabit, 0.5 = yarı yarıya otomatik ağırlıkla
        // karışık. Sert sabitleme parça sınırında kopma çizgisi bırakıyor;
        // kısmi sabitleme o dikişi yumuşatıyor.
        strength,
        color: REGION_COLORS[(nextId - 1) % REGION_COLORS.length],
      };

      nextId += 1;
      regions.push(region);
      return region;
    },

    get(id) {
      return regions.find((region) => region.id === id) ?? null;
    },

    remove(id) {
      const index = regions.findIndex((region) => region.id === id);
      if (index >= 0) regions.splice(index, 1);
    },

    clear() {
      regions.length = 0;
      nextId = 1;
    },

    /** Etiketlenmiş toplam vertex sayısı (bölgeler örtüşmüyor). */
    get labeledCount() {
      const seen = new Set();
      for (const region of regions) {
        for (const vertex of region.vertices) seen.add(vertex);
      }
      return seen.size;
    },

    rename(id, name) {
      const region = this.get(id);
      if (region && name.trim()) region.name = name.trim();
    },

    bindTo(id, boneName) {
      const region = this.get(id);
      if (region) region.boundBone = boneName;
    },

    setStrength(id, strength) {
      const region = this.get(id);
      if (region) region.strength = Math.min(1, Math.max(0, strength));
    },

    toJSON(modelHash, graph) {
      return {
        version: 1,
        modelHash: modelHash ?? null,
        space: 'normalized',
        regions: regions.map((region) => ({
          name: region.name,
          boundBone: region.boundBone,
          strength: region.strength,
          color: region.color,
          // Orijinal vertex index'leri: dosya bizim kaynaştırma algoritmamıza
          // bağımlı kalmasın.
          vertices: expandToOriginal(region.vertices, graph),
        })),
      };
    },

    fromJSON(json, graph) {
      if (!json?.regions) throw new Error('Geçersiz bölge dosyası.');

      this.clear();
      for (const entry of json.regions) {
        const welded = new Set();
        for (const original of entry.vertices ?? []) {
          const index = graph.originalToWelded[original];
          if (index !== undefined) welded.add(index);
        }
        // Dosyadaki bölüştürme aynen korunuyor; yükleme sırasında birbirini
        // kırpmasınlar.
        this.add({
          name: entry.name,
          vertices: welded,
          boundBone: entry.boundBone ?? null,
          strength: entry.strength ?? 1,
          exclusive: false,
        });
      }

      return regions.length;
    },
  };
}

function expandToOriginal(weldedVertices, graph) {
  const output = [];
  for (const welded of weldedVertices) {
    for (const original of graph.weldedToOriginal[welded]) output.push(original);
  }
  return output;
}

/**
 * Bölgelerin weight override'larını hesaplanmış ağırlıklara uygular.
 *
 * Override yıkıcı değil: her weight hesabından sonra yeniden uygulanıyor,
 * böylece kullanıcı p üssünü değiştirip yeniden hesapladığında bölge
 * sabitlemeleri kaybolmuyor.
 *
 * @returns {{ regions: number, vertices: number }} uygulanan override sayısı
 */
export function applyRegionOverrides(weights, regions, boneNames, graph) {
  let applied = 0;
  let touched = 0;

  for (const region of regions) {
    if (!region.boundBone) continue;

    const boneIndex = boneNames.indexOf(region.boundBone);
    if (boneIndex < 0) continue;

    applied += 1;

    const strength = region.strength ?? 1;

    for (const welded of region.vertices) {
      for (const original of graph.weldedToOriginal[welded]) {
        const base = original * MAX_INFLUENCES;

        if (strength >= 1) {
          weights.skinIndices[base] = boneIndex;
          weights.skinWeights[base] = 1;

          for (let i = 1; i < MAX_INFLUENCES; i += 1) {
            weights.skinIndices[base + i] = 0;
            weights.skinWeights[base + i] = 0;
          }
        } else {
          blendTowardBone(weights, base, boneIndex, strength);
        }

        touched += 1;
      }
    }
  }

  return { regions: applied, vertices: touched };
}

/**
 * Mevcut ağırlıkları hedef kemiğe doğru kaydırır.
 * Otomatik ağırlıklar (1 - strength) ile çarpılıyor, hedef kemiğe strength
 * ekleniyor. Hedef kemik listede yoksa en zayıf etkinin yerine geçiyor.
 */
function blendTowardBone(weights, base, boneIndex, strength) {
  let slot = -1;
  let weakest = 0;

  for (let i = 0; i < MAX_INFLUENCES; i += 1) {
    if (weights.skinIndices[base + i] === boneIndex && weights.skinWeights[base + i] > 0) slot = i;
    if (weights.skinWeights[base + i] < weights.skinWeights[base + weakest]) weakest = i;
  }

  for (let i = 0; i < MAX_INFLUENCES; i += 1) {
    weights.skinWeights[base + i] *= 1 - strength;
  }

  if (slot < 0) {
    slot = weakest;
    weights.skinIndices[base + slot] = boneIndex;
    weights.skinWeights[base + slot] = 0;
  }

  weights.skinWeights[base + slot] += strength;

  let total = 0;
  for (let i = 0; i < MAX_INFLUENCES; i += 1) total += weights.skinWeights[base + i];
  if (total <= 0) return;

  for (let i = 0; i < MAX_INFLUENCES; i += 1) {
    weights.skinWeights[base + i] /= total;
  }
}

/** Bölgenin ortalama konumu; kamera odaklama ve etiketleme için. */
export function regionCentroid(region, graph) {
  const centroid = new THREE.Vector3();
  if (!region.vertices.length) return centroid;

  for (const welded of region.vertices) {
    centroid.x += graph.positions[welded * 3];
    centroid.y += graph.positions[welded * 3 + 1];
    centroid.z += graph.positions[welded * 3 + 2];
  }

  return centroid.divideScalar(region.vertices.length);
}
