import { button, checkbox, element, formatNumber, row, select, slider, stat } from './dom.js';
import { REGION_PRESETS } from '../core/regions.js';

/**
 * Bölge bölümü: seçim, isimlendirme, kemiğe sabitleme, JSON kaydet/yükle.
 *
 * Akış üç adım: modele tıkla (seçim yayılır) -> slider'larla sınırı ayarla ->
 * isim verip kaydet. Sonra listeden bölgeyi seçip bir kemiğe sabitle.
 */
export function registerRegionSections(panel, controller) {
  panel.addSection({
    title: () => 'Bölge seçimi',
    render: () => {
      if (!controller.isAvailable) return null;

      const nodes = [
        checkbox('Bölge modu', controller.enabled, (value) => controller.setEnabled(value)),
      ];

      if (!controller.enabled) {
        nodes.push(
          element(
            'p',
            'hint',
            'Açınca modele tıklayarak yüzeyde yayılan bir seçim yaparsın; ' +
              'atkı, pelerin, saç gibi parçaları ayırmak için.',
          ),
        );
        return nodes;
      }

      nodes.push(
        slider('yayılma mesafesi', controller.maxDistance, { min: 0.01, max: 0.6, step: 0.01 }, (value) =>
          controller.setMaxDistance(value),
        ),
        slider('kenar açısı', controller.maxAngle, { min: 5, max: 180, step: 5 }, (value) =>
          controller.setMaxAngle(value),
        ),
        element(
          'p',
          'hint',
          'Yayılma keskin kenarlarda durur: açı eşiği düştükçe seçim daha erken ' +
            'kesilir, 180 açı kontrolünü kapatır. Shift ile ekle, Alt ile çıkar.',
        ),
      );

      if (controller.hasSelection) {
        // Hazır parça isimleri: etiketleme hızlansın, isimlendirme tutarlı olsun.
        const listId = 'region-presets';
        const datalist = element('datalist', null, null);
        datalist.id = listId;
        for (const preset of REGION_PRESETS) {
          const option = element('option', null, null);
          option.value = preset;
          datalist.append(option);
        }

        const input = element('input', 'text-input');
        input.type = 'text';
        input.placeholder = 'bölge adı (Atkı, Sol El, ...)';
        input.setAttribute('list', listId);
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') controller.saveRegion(input.value);
        });

        nodes.push(
          stat('seçili vertex', formatNumber(controller.selectionSize)),
          datalist,
          input,
          row(
            button('Kaydet', () => controller.saveRegion(input.value), {
              className: 'button button--half',
            }),
            button('Temizle', () => controller.clearSelection(), {
              className: 'button button--half',
            }),
          ),
        );
      } else {
        nodes.push(element('p', 'list__empty', 'modele tıkla'));
      }

      return nodes;
    },
  });

  panel.addSection({
    title: () => `Bölgeler (${controller.regions.length})`,
    render: () => {
      if (!controller.isAvailable || !controller.enabled) return null;

      if (!controller.regions.length) {
        return [element('p', 'list__empty', 'henüz bölge yok')];
      }

      const items = controller.regions.map((region) => {
        const isActive = region.id === controller.activeRegionId;

        const swatch = element('span', 'region__swatch', null);
        swatch.style.background = region.color;

        const item = element(
          'li',
          `region${isActive ? ' region--active' : ''}`,
          null,
          swatch,
          element('span', 'region__name', region.name),
          element('span', 'region__count', formatNumber(region.vertices.length)),
          button('✕', (event) => {
            event.stopPropagation();
            controller.removeRegion(region.id);
          }, { className: 'landmark__clear' }),
        );

        item.addEventListener('click', () => controller.selectRegion(region.id));
        return item;
      });

      const nodes = [
        element('ul', 'list', null, ...items),
        stat(
          'etiketlenen',
          `${formatNumber(controller.labeledCount)} / ${formatNumber(controller.vertexCount)}` +
            ` (%${((controller.labeledCount / Math.max(1, controller.vertexCount)) * 100).toFixed(0)})`,
        ),
      ];

      const active = controller.regions.find((region) => region.id === controller.activeRegionId);
      if (active) {
        nodes.push(
          element('div', 'divider', null),
          select(
            'kemiğe sabitle',
            active.boundBone ?? '',
            [
              { id: '', label: '— sabitleme yok —' },
              ...controller.boneNames.map((name) => ({ id: name, label: name })),
            ],
            (value) => controller.bindRegion(active.id, value),
          ),
          active.boundBone
            ? slider(
                'sabitleme oranı',
                active.strength ?? 1,
                { min: 0, max: 1, step: 0.05 },
                (value) => controller.setRegionStrength(active.id, value),
              )
            : null,
          element(
            'p',
            'hint',
            'Seçilen kemik bu bölgenin ağırlığını alır. Pelerin için Hips, ' +
              'atkı için Neck, saç için Head tipik tercihler. Oran 1 sert ' +
              'sabitler ve parça sınırında kopma çizgisi bırakabilir; 0.6-0.8 ' +
              'dikişi yumuşatır.',
          ),
        );
      }

      const bound = controller.regions.filter((region) => region.boundBone);
      if (bound.length) {
        nodes.push(
          stat('sabitlenen bölge', `${bound.length} / ${controller.regions.length}`),
          controller.lastOverride
            ? stat('etkilenen vertex', formatNumber(controller.lastOverride.vertices))
            : null,
        );
      }

      nodes.push(
        row(
          button('JSON kaydet', () => controller.saveJSON(), {
            className: 'button button--half',
            disabled: !controller.regions.length,
          }),
          button('JSON yükle', () => controller.loadJSON(), { className: 'button button--half' }),
        ),
      );

      return nodes.filter(Boolean);
    },
  });
}
