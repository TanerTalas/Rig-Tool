import { element } from './dom.js';

/**
 * Sağ üstteki panel kabuğu.
 *
 * Bölümler gruplara ayrılıyor ve solda dikey bir sekme şeridi ile geçiş
 * yapılıyor: her şey alt alta sıralanınca panel ekran boyunu aşıyor ve
 * aradığın kontrolü bulmak için kaydırmak gerekiyordu.
 *
 * Panel kendi içeriğini bilmiyor: her özellik kendi bölümünü hangi gruba
 * ait olduğunu söyleyerek kaydediyor.
 */
export function createPanel(root) {
  const groups = [];
  const sections = [];
  let activeGroup = null;

  function isAvailable(group) {
    return group.available ? Boolean(group.available()) : true;
  }

  function renderNav() {
    const nav = element('div', 'panel__nav', null);

    for (const group of groups) {
      const available = isAvailable(group);
      const isActive = group.id === activeGroup;

      const tab = element('button', `panel__tab${isActive ? ' panel__tab--active' : ''}`, group.label);
      tab.disabled = !available;
      tab.title = group.title ?? group.label;
      tab.addEventListener('click', () => {
        activeGroup = group.id;
        refresh();
      });

      nav.append(tab);
    }

    return nav;
  }

  function renderBody() {
    const body = element('div', 'panel__body', null);
    let rendered = 0;

    for (const definition of sections) {
      if (definition.group !== activeGroup) continue;

      const content = definition.render();
      if (!content) continue;

      const children = Array.isArray(content) ? content.filter(Boolean) : [content];
      if (!children.length) continue;

      body.append(
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

    if (!rendered) {
      body.append(element('p', 'list__empty', 'bu sekmede gösterilecek bir şey yok'));
    }

    return body;
  }

  function refresh() {
    // Aktif sekme kullanılamaz hale geldiyse (model kapandı gibi) ilk
    // kullanılabilir sekmeye düş.
    const active = groups.find((group) => group.id === activeGroup);
    if (!active || !isAvailable(active)) {
      activeGroup = (groups.find(isAvailable) ?? groups[0])?.id ?? null;
    }

    const scrollTop = root.querySelector('.panel__body')?.scrollTop ?? 0;
    root.innerHTML = '';

    if (!groups.length) {
      root.classList.add('panel--empty');
      return;
    }

    root.classList.remove('panel--empty');
    root.append(renderNav(), renderBody());

    const body = root.querySelector('.panel__body');
    if (body) body.scrollTop = scrollTop;
  }

  return {
    /**
     * @param {{ id: string, label: string, title?: string, available?: () => boolean }} group
     */
    addGroup(group) {
      groups.push(group);
      if (activeGroup === null) activeGroup = group.id;
    },

    /**
     * @param {{ group: string, title?: () => string, render: () => (Node|Node[]|null) }} definition
     */
    addSection(definition) {
      sections.push(definition);
      return { refresh };
    },

    showGroup(id) {
      activeGroup = id;
      refresh();
    },

    refresh,
  };
}
