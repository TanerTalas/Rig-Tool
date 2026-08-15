import { button, checkbox, element, row, stat } from './dom.js';
import { humanoidTemplate } from '../core/landmarks.js';

/**
 * Son yerleştirmenin teşhisi.
 *
 * "Kayma" tıklanan yüzey noktası ile landmark'ın son konumu arasındaki mesafe,
 * "kalınlık" ışının deldiği ilk kabuğun kalınlığı. Işın ikiden fazla yüzey
 * deldiyse ilk kabuk aradığımız uzuv olmayabilir (atkı, saç, bol kıyafet) ve
 * landmark yanlış parçanın içine düşmüş olabilir; bu durumda uyarı çıkıyor.
 */
function placementInfo(placement) {
  if (!placement) return null;

  return element(
    'div',
    'placement',
    null,
    element('div', 'placement__title', `son: ${placement.label}`),
    stat('kayma', placement.shift.toFixed(3)),
    stat('kalınlık', placement.thickness.toFixed(3)),
    stat('delinen yüzey', String(placement.hitCount), placement.suspicious),
    placement.suspicious
      ? element(
          'p',
          'hint hint--warn',
          'Işın ikiden fazla yüzey deldi. İlk kabuk aradığın uzuv olmayabilir; ' +
            'konumu kontrol et, gerekirse merkez tahminini kapatıp tekrar tıkla.',
        )
      : null,
  );
}

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
          'Merkez tahmini, tıklanan noktayı bakış yönünde ön ve arka yüzeyin ortasına iter. ' +
            'Bu yüzden yan taraftaki landmark\'ları (kalça, omuz, dirsek, diz) önden bakarak işaretle; ' +
            'yandan bakarken tıklarsan nokta gövdenin ortasına kayar.',
        ),
        placementInfo(controller.lastPlacement),
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
    title: () => 'Kontrol',
    render: () => {
      if (!controller.isReady) return null;

      const validation = controller.validation;
      if (!validation) {
        return [element('p', 'list__empty', 'tüm landmark\'lar yerleşince çalışır')];
      }

      const nodes = [];
      const facing = validation.info.facing;
      if (facing?.reliable) {
        nodes.push(
          stat('bakış yönü', facing.direction > 0 ? '+Z' : '-Z'),
          stat('orta çizgi', validation.info.midline.toFixed(3)),
        );
      }

      if (!validation.issues.length) {
        nodes.push(element('p', 'status status--ok', '✓ kontroller temiz'));
        return nodes;
      }

      for (const issue of validation.issues) {
        nodes.push(element('p', `issue issue--${issue.level}`, issue.message));

        if (issue.swappable && issue.group) {
          nodes.push(
            button(
              issue.group === 'arms' ? 'Kolları sol/sağ değiştir' : 'Bacakları sol/sağ değiştir',
              () => controller.swapGroup(issue.group),
            ),
          );
        }
      }

      return nodes;
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
