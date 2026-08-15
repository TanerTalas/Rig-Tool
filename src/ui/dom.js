/** Panel bölümlerinin paylaştığı küçük DOM yardımcıları. */

export function element(tag, className, text, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = text;
  node.append(...children.filter(Boolean));
  return node;
}

export function stat(label, value, warn = false) {
  return element(
    'div',
    'stat',
    null,
    element('span', 'stat__label', label),
    element('span', `stat__value${warn ? ' stat__value--warn' : ''}`, value),
  );
}

export function button(label, onClick, { className = 'button', disabled = false } = {}) {
  const node = element('button', className, label);
  node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

export function checkbox(label, checked, onChange) {
  const input = element('input', 'checkbox__input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));

  return element('label', 'checkbox', null, input, element('span', null, label));
}

export function row(...children) {
  return element('div', 'row', null, ...children);
}

/**
 * Etiketli slider. Değer canlı güncelleniyor ama onChange sadece bırakınca
 * tetikleniyor: weight hesabı gibi pahalı işler her piksel hareketinde
 * çalışmasın.
 */
export function slider(label, value, { min, max, step = 0.1, live = false }, onChange) {
  const valueNode = element('span', 'slider__value', formatSliderValue(value, step));

  const input = element('input', 'slider__input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  input.addEventListener('input', () => {
    valueNode.textContent = formatSliderValue(Number(input.value), step);
    if (live) onChange(Number(input.value));
  });

  if (!live) {
    input.addEventListener('change', () => onChange(Number(input.value)));
  }

  return element(
    'div',
    'slider',
    null,
    element('div', 'slider__header', null, element('span', 'slider__label', label), valueNode),
    input,
  );
}

function formatSliderValue(value, step) {
  const decimals = step >= 1 ? 0 : String(step).split('.')[1]?.length ?? 1;
  return value.toFixed(decimals);
}

export function select(label, value, options, onChange) {
  const node = element('select', 'select__input');
  for (const option of options) {
    const item = element('option', null, option.label);
    item.value = option.id;
    if (option.id === value) item.selected = true;
    node.append(item);
  }
  node.addEventListener('change', () => onChange(node.value));

  return element('label', 'select', null, element('span', 'select__label', label), node);
}

export function formatNumber(value) {
  return value.toLocaleString('tr-TR');
}

export function formatVector(vector, digits = 3) {
  return `${vector.x.toFixed(digits)}, ${vector.y.toFixed(digits)}, ${vector.z.toFixed(digits)}`;
}
