import { button, checkbox, element, formatNumber, select, slider, stat } from './dom.js';
import { TEST_POSES } from '../core/pose.js';
import { WEIGHT_METHODS } from './weightController.js';

/**
 * Weight bölümü.
 *
 * Aşama 2'de burada tek bir yöntem var (naif Öklid). Aşama 4'te geodezik
 * yöntem eklenip aynı panelden karşılaştırılacak, o yüzden istatistikler ve
 * sızıntı ölçümü baştan görünür tutuluyor.
 */
export function registerWeightSections(panel, controller) {
  panel.addSection({
    title: () => 'Weight',
    render: () => {
      if (!controller.canCompute) {
        if (!controller.isReadyForModel) return null;
        return [element('p', 'list__empty', 'iskelet kurulunca hesaplanabilir')];
      }

      const nodes = [
        select('yöntem', controller.method, WEIGHT_METHODS, (value) =>
          controller.setMethod(value),
        ),
        slider('mesafe üssü (p)', controller.power, { min: 1, max: 8, step: 0.5 }, (value) =>
          controller.setPower(value),
        ),
      ];

      if (controller.method === 'geodesic') {
        nodes.push(
          slider(
            'yumuşatma',
            controller.smoothIterations,
            { min: 0, max: 5, step: 1 },
            (value) => controller.setSmoothIterations(value),
          ),
          checkbox('Kemik kalınlığını hesaba kat', controller.radiusNormalization, (value) =>
            controller.setRadiusNormalization(value),
          ),
          element(
            'p',
            'hint',
            'Mesafe mesh yüzeyinde yürüyerek ölçülüyor: havada yakın ama yüzeyde ' +
              'uzak olan kemikler (el ile uyluk gibi) ağırlık sızdırmıyor. Kalınlık ' +
              'hesaba katılınca mesafe kemik ekseninden değil uzvun yüzeyinden ' +
              'ölçülür; ince kol, kalın gövdenin duvarını kendine çekemez.',
          ),
        );
      } else {
        nodes.push(
          element(
            'p',
            'hint',
            'Düz Öklid mesafesi. Referans amaçlı: geodezik sonucun ne kadar ' +
              'iyileştirdiğini görmek için.',
          ),
        );
      }

      nodes.push(
        button(controller.isSkinned ? 'Yeniden hesapla' : 'Weight hesapla', () =>
          controller.compute(),
        ),
      );

      return nodes;
    },
  });

  panel.addSection({
    title: () => 'Karşılaştırma',
    render: () => {
      const { naive, geodesic } = controller.results;
      if (!naive || !geodesic) {
        if (!naive && !geodesic) return null;
        return [
          element(
            'p',
            'hint',
            'Diğer yöntemi de bir kez hesapla, sonuçlar burada yan yana görünsün.',
          ),
        ];
      }

      return [
        comparisonRow('', 'naif', 'geodezik', true),
        comparisonRow('süre', `${naive.elapsedMs.toFixed(0)}ms`, `${geodesic.elapsedMs.toFixed(0)}ms`),
        comparisonRow(
          'sızıntı',
          `%${(naive.leakingRatio * 100).toFixed(1)}`,
          `%${(geodesic.leakingRatio * 100).toFixed(1)}`,
        ),
        comparisonRow('boşta kemik', String(naive.orphanBones), String(geodesic.orphanBones)),
        comparisonRow(
          'ort. kemik',
          naive.avgInfluences.toFixed(2),
          geodesic.avgInfluences.toFixed(2),
        ),
        element(
          'p',
          'hint',
          'Boşta kemik = hiçbir vertex\'e hükmetmeyen kemik sayısı. ' +
            'Sızıntı = gövde vertex\'lerinin kol kemiklerinden ağırlık alan oranı.',
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
          // Kullanıcı kemikleri elle döndürdüyse hazır pozlardan biri değiliz;
          // listede bunu gösteren geçici bir seçenek beliriyor.
          controller.poseId === 'custom'
            ? [{ id: 'custom', label: '(elle ayarlandı)' }, ...TEST_POSES]
            : TEST_POSES.map((pose) => ({ id: pose.id, label: pose.label })),
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

/** Karşılaştırma tablosunun tek satırı: etiket + iki sütun. */
function comparisonRow(label, left, right, header = false) {
  return element(
    'div',
    `compare${header ? ' compare--header' : ''}`,
    null,
    element('span', 'compare__label', label),
    element('span', 'compare__value', left),
    element('span', 'compare__value', right),
  );
}
