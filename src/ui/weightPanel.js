import { button, element, formatNumber, select, slider, stat } from './dom.js';
import { TEST_POSES } from '../core/pose.js';

/**
 * Weight bölümü.
 *
 * Aşama 2'de burada tek bir yöntem var (naif Öklid). Aşama 4'te geodezik
 * yöntem eklenip aynı panelden karşılaştırılacak, o yüzden istatistikler ve
 * sızıntı ölçümü baştan görünür tutuluyor.
 */
export function registerWeightSections(panel, controller) {
  panel.addSection({
    title: () => 'Weight (naif)',
    render: () => {
      if (!controller.canCompute) {
        if (!controller.isReadyForModel) return null;
        return [element('p', 'list__empty', 'iskelet kurulunca hesaplanabilir')];
      }

      return [
        slider('mesafe üssü (p)', controller.power, { min: 1, max: 8, step: 0.5 }, (value) =>
          controller.setPower(value),
        ),
        element(
          'p',
          'hint',
          'w = 1 / (d^p + eps). p büyüdükçe en yakın kemik baskınlaşır, ' +
            'küçüldükçe ağırlık daha çok kemiğe yayılır.',
        ),
        button(
          controller.isSkinned ? 'Yeniden hesapla' : 'Naif weight hesapla',
          () => controller.compute(),
        ),
      ];
    },
  });

  panel.addSection({
    title: () => 'Sonuç',
    render: () => {
      const stats = controller.stats;
      if (!stats) return null;

      const leakage = controller.leakage;

      return [
        stat('süre', `${stats.elapsedMs.toFixed(0)} ms`),
        stat('vertex', formatNumber(stats.vertexCount)),
        stat('ort. etkileyen kemik', stats.avgInfluences.toFixed(2)),
        element('div', 'divider', null),
        element('div', 'placement__title', 'sızıntı (gövde → kol)'),
        stat('gövde vertex', formatNumber(leakage.torsoVertices)),
        stat(
          'kol ağırlığı alan',
          `${formatNumber(leakage.leakingVertices)} (%${(leakage.leakingRatio * 100).toFixed(1)})`,
          leakage.leakingRatio > 0.05,
        ),
        stat('ort. sızan ağırlık', leakage.avgLeakedWeight.toFixed(3)),
        element(
          'p',
          'hint',
          'Gövde kemiklerinin hükmettiği vertex\'lerin ne kadarı kol kemiklerinden ' +
            'de ağırlık alıyor. Aşama 4 bu oranı düşürmeli.',
        ),
      ];
    },
  });

  panel.addSection({
    title: () => 'Test pozu',
    render: () => {
      if (!controller.isSkinned) return null;

      return [
        select(
          'poz',
          controller.poseId,
          TEST_POSES.map((pose) => ({ id: pose.id, label: pose.label })),
          (value) => controller.setPose(value),
        ),
        button('Bind pose\'a dön', () => controller.setPose('bind'), {
          disabled: controller.poseId === 'bind',
        }),
        element(
          'p',
          'hint',
          'Naif weight\'te kolu kaldırınca göğsün de kalkması bekleniyor. ' +
            'Bu bozukluk Aşama 4 için referans noktası.',
        ),
      ];
    },
  });
}
