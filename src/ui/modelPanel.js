import { element, formatNumber, stat } from './dom.js';

/**
 * Model ve mesh istatistik bölümleri.
 * Aşama 0'ın teşhis çıktısı burada kalıyor: ada sayısı Aşama 4'te
 * karşımıza çıkacak sorunun erken habercisi.
 */
export function registerModelSections(panel, state) {
  panel.addSection({
    group: 'rig',
    title: () => 'Model',
    render: () => {
      if (!state.model) return null;
      return [
        stat('dosya', state.model.fileName),
        stat('mesh', String(state.model.meshCount)),
        stat('hash', state.model.modelHash.slice(7, 19)),
      ];
    },
  });

  panel.addSection({
    group: 'rig',
    title: () => 'Mesh',
    render: () => {
      if (!state.model) return null;
      if (!state.stats) return [element('p', 'list__empty', 'analiz bekleniyor')];

      const stats = state.stats;
      const islandWarning = stats.islandCount > 1;

      return [
        stat('vertex', formatNumber(stats.vertexCount)),
        stat('welded', formatNumber(stats.weldedCount)),
        stat('kenar', formatNumber(stats.edgeCount)),
        stat('ort. komşu', stats.avgNeighbors.toFixed(2)),
        stat('ada', String(stats.islandCount), islandWarning),
        stat('en büyük ada', `%${(stats.largestIslandRatio * 100).toFixed(1)}`, islandWarning),
      ];
    },
  });
}
