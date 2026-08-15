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

export function formatNumber(value) {
  return value.toLocaleString('tr-TR');
}

export function formatVector(vector, digits = 3) {
  return `${vector.x.toFixed(digits)}, ${vector.y.toFixed(digits)}, ${vector.z.toFixed(digits)}`;
}
