import { element } from './dom.js';

/**
 * Sağ üstteki panel kabuğu.
 *
 * Panel kendi içeriğini bilmiyor: her özellik (model bilgisi, landmark akışı,
 * ileride bölge listesi ve weight parametreleri) kendi bölümünü kaydediyor.
 * `refresh()` çağrıldığında bölümler yeniden render ediliyor.
 */
export function createPanel(root) {
  const sections = [];

  function refresh() {
    // Panelin kaydırma konumu render sonrası kaybolmasın.
    const scrollTop = root.scrollTop;
    root.innerHTML = '';

    let rendered = 0;
    for (const definition of sections) {
      const content = definition.render();
      if (!content) continue;

      const children = Array.isArray(content) ? content.filter(Boolean) : [content];
      if (!children.length) continue;

      root.append(
        element(
          'div',
          'panel__section',
          null,
          definition.title ? element('h2', 'panel__title', definition.title()) : null,
          ...children,
        ),
      );
      rendered += 1;
    }

    root.classList.toggle('panel--empty', rendered === 0);
    root.scrollTop = scrollTop;
  }

  return {
    /**
     * @param {{ title?: () => string, render: () => (Node|Node[]|null) }} definition
     * title ve render fonksiyon: bölümler her refresh'te güncel state'i okuyor.
     */
    addSection(definition) {
      sections.push(definition);
      return { refresh };
    },
    refresh,
  };
}
