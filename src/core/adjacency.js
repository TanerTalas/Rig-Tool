/**
 * Vertex komşuluk grafiği.
 *
 * Neden gerekiyor: geodezik mesafe (Aşama 4) ve flood fill bölge seçimi
 * (Aşama 5) mesh yüzeyinde yürümek zorunda. Yürümek için "hangi vertex hangi
 * vertex'in komşusu" bilgisi lazım ve bu bilgi index buffer'dan çıkarılıyor.
 *
 * Kritik detay: GLB'de UV seam'leri ve sert kenarlar yüzünden aynı fiziksel
 * konumda birden fazla vertex bulunur. Bunlar index buffer'da birbirinin
 * komşusu görünmez, dolayısıyla yayılma o dikişte kesilir. Bu yüzden grafik
 * ham vertex'ler üzerine değil, pozisyona göre kaynaştırılmış (welded)
 * vertex'ler üzerine kuruluyor.
 *
 * Grafik CSR (compressed sparse row) formatında tutuluyor: Dijkstra ve flood
 * fill milyonlarca komşu erişimi yapacak, typed array üstünde gezmek nesne
 * dizisinden belirgin şekilde hızlı.
 */

// Kaynaştırma toleransı. Model yüksekliği 1 birime normalize edildiği için
// 1e-5 ≈ modelin on binde biri; dikiş kopyalarını yakalar, ayrı vertex'leri
// birleştirmez.
const DEFAULT_WELD_EPSILON = 1e-5;

/**
 * @param {THREE.BufferGeometry} geometry indexli, normalize edilmiş geometry
 * @param {{ weldEpsilon?: number }} [options]
 * @returns {AdjacencyGraph}
 */
export function buildAdjacency(geometry, options = {}) {
  const weldEpsilon = options.weldEpsilon ?? DEFAULT_WELD_EPSILON;

  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) {
    throw new Error('Komşuluk grafiği için indexli geometry gerekiyor.');
  }

  const weld = weldVertices(position, weldEpsilon);
  const edges = collectEdges(index, weld.originalToWelded);
  const csr = buildCSR(weld.count, edges, weld.positions);
  const islands = findIslands(weld.count, csr);

  return {
    weldEpsilon,
    vertexCount: position.count,
    weldedCount: weld.count,
    triangleCount: index.count / 3,
    edgeCount: edges.length / 2,
    positions: weld.positions,
    originalToWelded: weld.originalToWelded,
    weldedToOriginal: weld.weldedToOriginal,
    neighborOffsets: csr.offsets,
    neighborIndices: csr.indices,
    neighborWeights: csr.weights,
    islandOfVertex: islands.islandOfVertex,
    islandSizes: islands.sizes,
    stats: buildStats(position.count, weld, csr, edges, islands),
  };
}

/** Bir welded vertex'in komşularını [start, end) aralığı olarak verir. */
export function neighborRange(graph, weldedIndex) {
  return [graph.neighborOffsets[weldedIndex], graph.neighborOffsets[weldedIndex + 1]];
}

/**
 * Pozisyonu aynı olan vertex'leri tek temsilciye indirger.
 * Quantize edilmiş pozisyon string'i hash anahtarı olarak kullanılıyor.
 */
function weldVertices(position, epsilon) {
  const count = position.count;
  const originalToWelded = new Uint32Array(count);
  const keyToWelded = new Map();
  const groups = [];
  const positions = [];

  const inverseEpsilon = 1 / epsilon;

  for (let i = 0; i < count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    const key = `${Math.round(x * inverseEpsilon)},${Math.round(y * inverseEpsilon)},${Math.round(z * inverseEpsilon)}`;

    let welded = keyToWelded.get(key);
    if (welded === undefined) {
      welded = groups.length;
      keyToWelded.set(key, welded);
      groups.push([i]);
      positions.push(x, y, z);
    } else {
      groups[welded].push(i);
    }

    originalToWelded[i] = welded;
  }

  return {
    count: groups.length,
    positions: new Float32Array(positions),
    originalToWelded,
    weldedToOriginal: groups,
  };
}

/**
 * Üçgenlerin kenarlarından tekilleştirilmiş komşuluk çiftleri üretir.
 * Sonuç düz bir dizi: [a0, b0, a1, b1, ...]
 */
function collectEdges(index, originalToWelded) {
  const seen = new Set();
  const edges = [];
  const triangleCount = index.count / 3;

  for (let t = 0; t < triangleCount; t += 1) {
    const a = originalToWelded[index.getX(t * 3)];
    const b = originalToWelded[index.getX(t * 3 + 1)];
    const c = originalToWelded[index.getX(t * 3 + 2)];

    addEdge(seen, edges, a, b);
    addEdge(seen, edges, b, c);
    addEdge(seen, edges, c, a);
  }

  return edges;
}

function addEdge(seen, edges, a, b) {
  if (a === b) return; // dejenere üçgen kenarı

  const low = a < b ? a : b;
  const high = a < b ? b : a;
  // Çift yönlü kenarı tek anahtara indirger. Vertex sayısı 2^26'yı geçmediği
  // sürece bu çarpım güvenli tamsayı aralığında kalır.
  const key = low * 67108864 + high;

  if (seen.has(key)) return;
  seen.add(key);
  edges.push(low, high);
}

/** Kenar listesini CSR'a çevirir; kenar ağırlığı = Öklid kenar uzunluğu. */
function buildCSR(vertexCount, edges, positions) {
  const degrees = new Uint32Array(vertexCount);
  for (let e = 0; e < edges.length; e += 2) {
    degrees[edges[e]] += 1;
    degrees[edges[e + 1]] += 1;
  }

  const offsets = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v += 1) {
    offsets[v + 1] = offsets[v] + degrees[v];
  }

  const indices = new Uint32Array(offsets[vertexCount]);
  const weights = new Float32Array(offsets[vertexCount]);
  const cursor = offsets.slice(0, vertexCount);

  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e];
    const b = edges[e + 1];
    const length = distance(positions, a, b);

    indices[cursor[a]] = b;
    weights[cursor[a]] = length;
    cursor[a] += 1;

    indices[cursor[b]] = a;
    weights[cursor[b]] = length;
    cursor[b] += 1;
  }

  return { offsets, indices, weights };
}

function distance(positions, a, b) {
  const dx = positions[a * 3] - positions[b * 3];
  const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
  const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Bağlantısız ada tespiti (BFS).
 * Ada sayısı önemli bir teşhis: mesh çok parçaya bölünmüşse geodezik mesafe
 * adalar arasında çalışmaz ve ada bazlı fallback gerekir.
 */
function findIslands(vertexCount, csr) {
  const islandOfVertex = new Uint32Array(vertexCount).fill(0xffffffff);
  const sizes = [];
  const queue = new Uint32Array(vertexCount);

  for (let seed = 0; seed < vertexCount; seed += 1) {
    if (islandOfVertex[seed] !== 0xffffffff) continue;

    const island = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    islandOfVertex[seed] = island;
    let size = 0;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      size += 1;

      for (let i = csr.offsets[current]; i < csr.offsets[current + 1]; i += 1) {
        const neighbor = csr.indices[i];
        if (islandOfVertex[neighbor] !== 0xffffffff) continue;
        islandOfVertex[neighbor] = island;
        queue[tail] = neighbor;
        tail += 1;
      }
    }

    sizes.push(size);
  }

  return { islandOfVertex, sizes };
}

function buildStats(originalCount, weld, csr, edges, islands) {
  let minNeighbors = Infinity;
  let maxNeighbors = 0;
  let isolatedCount = 0;

  for (let v = 0; v < weld.count; v += 1) {
    const degree = csr.offsets[v + 1] - csr.offsets[v];
    if (degree < minNeighbors) minNeighbors = degree;
    if (degree > maxNeighbors) maxNeighbors = degree;
    if (degree === 0) isolatedCount += 1;
  }

  const sortedIslands = [...islands.sizes].sort((a, b) => b - a);
  const largestIsland = sortedIslands[0] ?? 0;

  return {
    vertexCount: originalCount,
    weldedCount: weld.count,
    duplicateCount: originalCount - weld.count,
    edgeCount: edges.length / 2,
    avgNeighbors: weld.count ? (edges.length / weld.count) : 0,
    minNeighbors: minNeighbors === Infinity ? 0 : minNeighbors,
    maxNeighbors,
    isolatedCount,
    islandCount: islands.sizes.length,
    largestIslandSize: largestIsland,
    largestIslandRatio: weld.count ? largestIsland / weld.count : 0,
  };
}
