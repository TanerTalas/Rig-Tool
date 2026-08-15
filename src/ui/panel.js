/**
 * Sağ üstteki bilgi paneli.
 *
 * Aşama 0'da sadece model ve mesh istatistiklerini gösteriyor; ilerleyen
 * aşamalarda landmark listesi, bölge listesi ve weight parametreleri buraya
 * eklenecek. DOM elle kuruluyor, UI kütüphanesi eklemeye gerek yok.
 */
export function createPanel(root) {
  const state = {
    model: null,
    stats: null,
    picks: [],
  };

  let onClearMarkers = null;

  function render() {
    if (!state.model) {
      root.classList.add('panel--empty');
      root.innerHTML = '';
      return;
    }

    root.classList.remove('panel--empty');
    root.innerHTML = '';
    root.append(modelSection(state.model), meshSection(state.stats), picksSection(state.picks));

    root.querySelector('[data-action="clear-markers"]')?.addEventListener('click', () => {
      state.picks = [];
      onClearMarkers?.();
      render();
    });
  }

  function modelSection(model) {
    return section('Model', [
      stat('dosya', model.fileName),
      stat('mesh', String(model.meshCount)),
      stat('hash', model.modelHash.slice(7, 19)),
    ]);
  }

  function meshSection(stats) {
    if (!stats) return section('Mesh', [element('p', 'list__empty', 'analiz bekleniyor')]);

    const islandWarning = stats.islandCount > 1;

    return section('Mesh', [
      stat('vertex', formatNumber(stats.vertexCount)),
      stat('welded', formatNumber(stats.weldedCount)),
      stat('duplicate', formatNumber(stats.duplicateCount)),
      stat('kenar', formatNumber(stats.edgeCount)),
      stat('ort. komşu', stats.avgNeighbors.toFixed(2)),
      stat('ada', String(stats.islandCount), islandWarning),
      stat('en büyük ada', `%${(stats.largestIslandRatio * 100).toFixed(1)}`, islandWarning),
    ]);
  }

  function picksSection(picks) {
    // Son 8 tıklama, en yenisi üstte.
    const items = picks.slice(-8).reverse().map((pick, offset) =>
      element(
        'li',
        'list__item',
        null,
        element('span', null, `#${picks.length - offset}`),
        element('span', null, formatVector(pick.point)),
      ),
    );

    const body = picks.length
      ? element('ul', 'list', null, ...items)
      : element('p', 'list__empty', 'modele tıkla');

    const button = element('button', 'button', "Marker'ları temizle");
    button.dataset.action = 'clear-markers';

    return section(`Tıklamalar (${picks.length})`, [
      body,
      button,
      element('p', 'hint', 'Detaylı raycast çıktısı konsolda.'),
    ]);
  }

  return {
    setModel(model) {
      state.model = model;
      state.stats = null;
      state.picks = [];
      render();
    },
    setStats(stats) {
      state.stats = stats;
      render();
    },
    addPick(pick) {
      state.picks.push(pick);
      render();
    },
    onClearMarkers(handler) {
      onClearMarkers = handler;
    },
  };
}

/* ------------------------------------------------------------------ helpers */

function section(title, children) {
  return element('div', 'panel__section', null, element('h2', 'panel__title', title), ...children);
}

function stat(label, value, warn = false) {
  return element(
    'div',
    'stat',
    null,
    element('span', 'stat__label', label),
    element('span', `stat__value${warn ? ' stat__value--warn' : ''}`, value),
  );
}

function element(tag, className, text, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = text;
  node.append(...children);
  return node;
}

function formatNumber(value) {
  return value.toLocaleString('tr-TR');
}

function formatVector(vector) {
  return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`;
}
