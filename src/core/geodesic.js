/**
 * Mesh yüzeyi üzerinde geodezik mesafe (Dijkstra).
 *
 * Öklid mesafesi havadan ölçer: chibi bir modelde el ile uyluk 6 cm uzaktır
 * ve kalça kemiği ele ağırlık verir. Yüzeyde yürüyünce aynı iki nokta 58 cm
 * uzakta çıkar. Aradaki fark, weight sızıntısının tamamı.
 *
 * Grafik Aşama 0'da CSR formatında kuruldu (kaynaştırılmış vertex'ler, kenar
 * ağırlığı = kenar uzunluğu). Burada onun üzerinde çok kaynaklı Dijkstra
 * çalışıyor.
 */

/**
 * Typed array tabanlı ikili min-heap.
 * Tembel silme kullanıyor: bir düğüm birden fazla kez itilebilir, çıkarken
 * ziyaret edilmişse atlanır. Azaltma işlemi (decrease-key) gerekmediği için
 * kod hem kısa hem hızlı kalıyor.
 */
class MinHeap {
  constructor(capacity) {
    this.nodes = new Uint32Array(capacity);
    this.keys = new Float64Array(capacity);
    this.size = 0;
    this.capacity = capacity;
  }

  push(node, key) {
    if (this.size === this.capacity) this.grow();

    let index = this.size;
    this.size += 1;

    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.nodes[index] = this.nodes[parent];
      this.keys[index] = this.keys[parent];
      index = parent;
    }

    this.nodes[index] = node;
    this.keys[index] = key;
  }

  pop() {
    const top = this.nodes[0];

    this.size -= 1;
    if (this.size > 0) {
      const node = this.nodes[this.size];
      const key = this.keys[this.size];

      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        if (left >= this.size) break;

        const right = left + 1;
        const child = right < this.size && this.keys[right] < this.keys[left] ? right : left;
        if (this.keys[child] >= key) break;

        this.nodes[index] = this.nodes[child];
        this.keys[index] = this.keys[child];
        index = child;
      }

      this.nodes[index] = node;
      this.keys[index] = key;
    }

    return top;
  }

  grow() {
    const nodes = new Uint32Array(this.capacity * 2);
    const keys = new Float64Array(this.capacity * 2);
    nodes.set(this.nodes);
    keys.set(this.keys);
    this.nodes = nodes;
    this.keys = keys;
    this.capacity *= 2;
  }

  clear() {
    this.size = 0;
  }
}

export function createGeodesicSolver(graph) {
  const count = graph.weldedCount;
  const visited = new Uint8Array(count);
  const heap = new MinHeap(Math.max(64, count));

  /**
   * Çok kaynaklı Dijkstra.
   *
   * Kaynaklar sıfırdan değil, kendi başlangıç mesafeleriyle başlıyor. Sebep:
   * bir kemiğin seed'leri uzvun yüzeyindeki vertex'ler ve bunların kemik
   * eksenine kendi Öklid mesafeleri var. Sıfırdan başlatılsaydı kalın bir
   * uzvun tüm yüzeyi kemiğe "sıfır mesafede" olurdu ve ağırlık yumuşak
   * geçiş yapamazdı. Bu haliyle uzvun içinde Öklid davranışı korunuyor,
   * uzvun dışına çıkınca yüzey mesafesi devreye giriyor.
   *
   * @param {Uint32Array|number[]} seedNodes
   * @param {Float64Array|number[]} seedDistances seedNodes ile aynı sırada
   * @param {Float64Array} distances sonucun yazılacağı tampon (yeniden kullanılır)
   */
  function solve(seedNodes, seedDistances, distances) {
    distances.fill(Infinity);
    visited.fill(0);
    heap.clear();

    for (let i = 0; i < seedNodes.length; i += 1) {
      const node = seedNodes[i];
      const distance = seedDistances[i];
      if (distance < distances[node]) {
        distances[node] = distance;
        heap.push(node, distance);
      }
    }

    while (heap.size > 0) {
      const current = heap.pop();
      if (visited[current]) continue;
      visited[current] = 1;

      const distance = distances[current];
      const end = graph.neighborOffsets[current + 1];

      for (let i = graph.neighborOffsets[current]; i < end; i += 1) {
        const neighbor = graph.neighborIndices[i];
        if (visited[neighbor]) continue;

        const candidate = distance + graph.neighborWeights[i];
        if (candidate < distances[neighbor]) {
          distances[neighbor] = candidate;
          heap.push(neighbor, candidate);
        }
      }
    }

    return distances;
  }

  return { solve };
}
