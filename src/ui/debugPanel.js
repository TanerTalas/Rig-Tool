import { button, checkbox, element, formatNumber, select, slider, stat } from './dom.js';

/**
 * Teşhis bölümleri: heatmap, kemik bazlı poz, vertex inceleme.
 * Aşama 4'ün işe yarayıp yaramadığı bu panelden okunacak.
 */
export function registerDebugSections(panel, controller) {
  panel.addSection({
    group: 'weight',
    title: () => 'Heatmap',
    render: () => {
      if (!controller.isAvailable) return null;

      const nodes = [
        checkbox('Weight heatmap', controller.heatmapEnabled, (value) =>
          controller.setHeatmapEnabled(value),
        ),
        checkbox('Wireframe', controller.wireframe, (value) => controller.setWireframe(value)),
      ];

      if (!controller.heatmapEnabled) {
        nodes.push(
          element('p', 'hint', 'Açınca seçili kemiğin her vertex üzerindeki ağırlığı renklenir.'),
        );
        return nodes;
      }

      nodes.push(
        select(
          'kemik',
          String(controller.selectedBone ?? 0),
          controller.bones.map((bone, index) => ({ id: String(index), label: bone.name })),
          (value) => controller.selectBone(Number(value)),
        ),
        legend(),
      );

      const stats = controller.heatmapStats;
      if (stats) {
        nodes.push(
          stat('etkilenen vertex', `${formatNumber(stats.affected)} / ${formatNumber(stats.vertexCount)}`),
          stat('en yüksek ağırlık', stats.maxWeight.toFixed(3)),
          stat('toplam ağırlık', stats.weightSum.toFixed(1)),
          element('p', 'hint', 'Etkilenen = ağırlığı 0.01 üzerinde olan vertex sayısı.'),
        );
      }

      return nodes;
    },
  });

  panel.addSection({
    group: 'weight',
    title: () => `Poz: ${controller.selectedBoneName ?? '—'}`,
    render: () => {
      if (!controller.isAvailable || controller.selectedBone === null) return null;

      return [
        ...['x', 'y', 'z'].map((axis) =>
          slider(
            `${axis.toUpperCase()} dönüş`,
            controller.getRotation(axis),
            { min: -180, max: 180, step: 1, live: true },
            (value) => controller.setRotation(axis, value),
          ),
        ),
        button('Bu kemiği sıfırla', () => controller.resetBoneRotation()),
        element(
          'p',
          'hint',
          'Kemiği döndürüp weight sızıntısını canlı gör. Tüm iskeleti sıfırlamak ' +
            'için Test pozu bölümündeki "Bind pose\'a dön".',
        ),
      ];
    },
  });

  panel.addSection({
    group: 'weight',
    title: () => 'Vertex incele',
    render: () => {
      if (!controller.isAvailable) return null;

      const inspection = controller.inspection;
      if (!inspection) {
        return [
          element(
            'p',
            'list__empty',
            'modele tıkla (landmark seçili değilken)',
          ),
        ];
      }

      return [
        stat('vertex', String(inspection.vertex)),
        ...inspection.influences.map((entry) =>
          element(
            'div',
            'stat',
            null,
            element('span', 'stat__label', entry.name),
            element('span', 'stat__value', entry.weight.toFixed(3)),
          ),
        ),
      ];
    },
  });
}

function legend() {
  return element(
    'div',
    'legend',
    null,
    element('div', 'legend__bar'),
    element(
      'div',
      'legend__labels',
      null,
      element('span', null, '0'),
      element('span', null, '0.5'),
      element('span', null, '1'),
    ),
  );
}
