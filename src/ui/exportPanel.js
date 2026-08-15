import { button, checkbox, element, formatNumber, row, stat } from './dom.js';

/**
 * Export bölümü: üç dosyayı tek hamlede indiriyor.
 */
export function registerExportSections(panel, controller) {
  panel.addSection({
    group: 'export',
    title: () => 'Export',
    render: () => {
      if (!controller.isAvailable) {
        return [
          element(
            'p',
            'list__empty',
            'weight hesaplandıktan sonra export edilebilir',
          ),
        ];
      }

      return [
        checkbox('Orijinal ölçeğe döndür', controller.originalScale, (value) =>
          controller.setOriginalScale(value),
        ),
        element(
          'p',
          'hint',
          'Model yüklenirken 1 birim yüksekliğe normalize edilmişti. Açıkken ' +
            'kaynak GLB\'nin ölçeğine geri döner; kapalıyken 1 birim boyunda kalır.',
        ),
        button(controller.busy ? 'Hazırlanıyor…' : 'Üç dosyayı da indir', () =>
          controller.exportAll(), { disabled: controller.busy }),
        row(
          button('GLB', () => controller.exportModel(), {
            className: 'button button--half',
            disabled: controller.busy,
          }),
          button('rig.json', () => controller.exportRigJSON(), {
            className: 'button button--half',
            disabled: controller.busy,
          }),
          button('context.md', () => controller.exportContext(), {
            className: 'button button--half',
            disabled: controller.busy,
          }),
        ),
        element(
          'p',
          'hint',
          '.rigged.glb skinned model, .rig.json araca geri yüklenebilir ham veri, ' +
            '.context.md asistana verilebilecek özet. Tarayıcı arka arkaya inen ' +
            'dosyaları engelleyebilir; ilk seferde "birden fazla dosyaya izin ver" ' +
            'sorusuna evet de, inmeyen olursa yukarıdan tek tek indir.',
        ),
      ];
    },
  });

  panel.addSection({
    group: 'export',
    title: () => 'Son export',
    render: () => {
      const result = controller.lastResult;
      if (!result) return null;

      if (result.error) {
        return [element('p', 'issue issue--error', result.error)];
      }

      return [
        stat('GLB boyutu', `${(result.glbBytes / 1024).toFixed(0)} KB`),
        stat('vertex', formatNumber(result.vertexCount)),
        stat('kemik', String(result.boneCount)),
        stat('etiketli parça', String(result.regionCount)),
        stat('model yüksekliği', result.height.toFixed(3)),
      ];
    },
  });
}
