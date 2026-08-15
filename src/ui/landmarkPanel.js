import { button, checkbox, element, row } from './dom.js';
import { humanoidTemplate } from '../core/landmarks.js';

/**
 * Landmark bölümü: rehberli akış, liste, aynalama ve JSON kaydet/yükle.
 *
 * Rehberli akış tek bir "aktif landmark" fikri üzerine kurulu. Modele
 * tıklandığında aktif landmark yerleşiyor ve sıra otomatik olarak bir
 * sonrakine geçiyor. Listeden herhangi bir satıra tıklayarak o landmark'a
 * dönüp yeniden işaretlemek mümkün.
 */
export function registerLandmarkSections(panel, controller) {
  panel.addSection({
    title: () => `Landmark (${controller.placedCount}/${humanoidTemplate.landmarks.length})`,
    render: () => {
      if (!controller.isReady) return null;

      const active = controller.activeDefinition;

      const prompt = active
        ? element(
            'div',
            'prompt',
            null,
            element('div', 'prompt__label', active.label),
            element('div', 'prompt__hint', active.hint),
          )
        : element('div', 'prompt prompt--done', 'Tüm landmark\'lar yerleşti.');

      return [
        prompt,
        checkbox('Simetri: sol tarafı sağa aynala', controller.mirrorEnabled, (value) =>
          controller.setMirrorEnabled(value),
        ),
        checkbox('Eklem merkezini tahmin et', controller.useCenterPoint, (value) =>
          controller.setUseCenterPoint(value),
        ),
        element(
          'p',
          'hint',
          'Merkez tahmini açıkken tıklanan nokta, uzvun ön ve arka yüzeyinin ortasına kaydırılır; eklem yüzeyde değil içeride olduğu için iskelet daha doğru oturur.',
        ),
      ];
    },
  });

  panel.addSection({
    title: () => 'Liste',
    render: () => {
      if (!controller.isReady) return null;

      const items = controller.entries.map((entry) => {
        const status = entry.position ? (entry.auto ? 'auto' : 'set') : 'empty';
        const isActive = entry.id === controller.activeId;

        const item = element(
          'li',
          `landmark${isActive ? ' landmark--active' : ''}`,
          null,
          element('span', `landmark__dot landmark__dot--${status}`, null),
          element('span', 'landmark__label', entry.label),
          entry.position
            ? button('✕', (event) => {
                event.stopPropagation();
                controller.clear(entry.id);
              }, { className: 'landmark__clear' })
            : null,
        );

        item.addEventListener('click', () => controller.setActive(entry.id));
        return item;
      });

      return [element('ul', 'list list--landmarks', null, ...items)];
    },
  });

  panel.addSection({
    title: () => 'İskelet',
    render: () => {
      if (!controller.isReady) return null;

      const status = controller.skeletonError
        ? element('p', 'list__empty', controller.skeletonError)
        : controller.hasSkeleton
          ? element('p', 'status status--ok', `${controller.boneCount} kemik kuruldu`)
          : element('p', 'list__empty', 'tüm landmark\'lar işaretlenince kurulacak');

      return [
        status,
        checkbox('İskeleti göster', controller.skeletonVisible, (value) =>
          controller.setSkeletonVisible(value),
        ),
        checkbox('Marker\'ları göster', controller.markersVisible, (value) =>
          controller.setMarkersVisible(value),
        ),
        row(
          button('JSON kaydet', () => controller.saveJSON(), {
            className: 'button button--half',
            disabled: controller.placedCount === 0,
          }),
          button('JSON yükle', () => controller.loadJSON(), { className: 'button button--half' }),
        ),
        button('Hepsini temizle', () => controller.clearAll(), {
          className: 'button button--danger',
          disabled: controller.placedCount === 0,
        }),
      ];
    },
  });
}
