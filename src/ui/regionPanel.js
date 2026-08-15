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
    group: 'region',
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
        select(
          'görünüm',
          controller.displayMode,
          [
            { id: 'points', label: 'Noktalar' },
            { id: 'wire', label: 'Tel kafes' },
            { id: 'solid', label: 'Dolu yüzey' },
          ],
          (value) => controller.setDisplayMode(value),
        ),
      );

      if (controller.displayMode === 'points') {
        nodes.push(
          slider('nokta boyutu', controller.pointSize, { min: 0.002, max: 0.02, step: 0.001, live: true },
            (value) => controller.setPointSize(value)),
        );
      }

      nodes.push(
        select(
          'seçim yöntemi',
          controller.mode,
          [
            { id: 'path', label: 'Çizerek (nokta nokta)' },
            { id: 'spread', label: 'Yayılarak (tek tık)' },
          ],
          (value) => controller.setMode(value),
        ),
      );

      if (controller.mode === 'path') {
        nodes.push(
          stat('nokta', String(controller.pathPointCount)),
          stat('halka vertex', String(controller.pathVertexCount)),
          element(
            'p',
            'hint',
            controller.pathClosed
              ? 'Halka kapalı ve küçük taraf seçildi. Yanlış tarafsa "Tersine çevir", ' +
                'başka bir bölge istiyorsan modele tıklayarak o tarafı doldur. ' +
                'Sonra aşağıdan isim verip kaydet.'
              : 'Ayırmak istediğin parçanın çevresine sırayla tıkla; noktalar ' +
                'yüzeydeki en kısa yolla birleşir. En az 3 nokta koyup halkayı kapat.',
          ),
          row(
            button('Halkayı kapat ve doldur', () => controller.closePath(), {
              className: 'button button--half',
              disabled: controller.pathPointCount < 3 || controller.pathClosed,
            }),
            button('Son noktayı sil', () => controller.undoPathPoint(), {
              className: 'button button--half',
              disabled: !controller.pathPointCount,
            }),
          ),
        );
      } else {
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
      }

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
        input.value = controller.pendingName;
        // Yazılan isim kontrolcüde saklanıyor: panel yeniden çizilince
        // kaybolmasın.
        input.addEventListener('input', () => controller.setPendingName(input.value));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') controller.saveRegion(input.value);
        });

        nodes.push(
          stat('seçili vertex', formatNumber(controller.selectionSize)),
          button('Tersine çevir', () => controller.invert()),
          datalist,
          input,
          row(
            button('Kaydet', () => controller.saveRegion(input.value), {
              className: 'button button--half',
            }),
            button('Temizle', () => {
              controller.clearSelection();
              controller.clearPath();
            }, { className: 'button button--half' }),
          ),
        );
      } else {
        nodes.push(element('p', 'list__empty', 'modele tıkla'));
      }

      return nodes;
    },
  });

  panel.addSection({
    group: 'region',
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
      if (active && !controller.canBind) {
        nodes.push(
          element('div', 'divider', null),
          element(
            'p',
            'hint',
            'Kemiğe sabitleme için önce Ağırlık sekmesinden weight hesapla. ' +
              'Etiketleme şimdiden yapılabilir, sabitleme sonradan eklenir.',
          ),
        );
      }

      if (active && controller.canBind) {
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
