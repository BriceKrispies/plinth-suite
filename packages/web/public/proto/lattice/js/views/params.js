import { h, uid } from '../dom.js';

const INPUT_TYPE = { int: 'number', float: 'number', bool: 'checkbox', string: 'text', timestamp: 'text', duration: 'text' };
const HINT = { timestamp: 'ISO 8601, e.g. 2026-01-31T09:00Z', duration: 'e.g. 24h' };

/** Dashboard parameters as a real form. Values live in the URL as `p.<name>`. */
export const buildParams = (decls, search, onChange) => {
  const names = Object.keys(decls);
  if (!names.length) return null;
  const form = h('form', { class: 'params', 'aria-label': 'Dashboard parameters', onsubmit: (e) => e.preventDefault() });
  for (const name of names) {
    const decl = decls[name];
    const id = uid('param');
    const current = search.get(`p.${name}`);
    const type = INPUT_TYPE[decl.type] ?? 'text';
    const input = h('input', { id, name, class: type === 'checkbox' ? 'check' : 'input', type, step: decl.type === 'float' ? 'any' : null, placeholder: decl.default !== undefined ? String(decl.default) : (HINT[decl.type] ?? null), 'aria-describedby': HINT[decl.type] ? `${id}-hint` : null });
    if (type === 'checkbox') input.checked = current !== null ? current === 'true' : decl.default === true;
    else if (current !== null) input.value = current;
    input.addEventListener('change', () => {
      const url = new URL(location.href);
      const empty = type === 'checkbox' ? false : input.value === '';
      if (empty) url.searchParams.delete(`p.${name}`);
      else url.searchParams.set(`p.${name}`, type === 'checkbox' ? String(input.checked) : input.value);
      history.replaceState(null, '', url);
      onChange();
    });
    form.append(
      h('div', { class: `field${type === 'checkbox' ? ' field--inline' : ''}` }, h('label', { for: id }, name), input, HINT[decl.type] ? h('p', { class: 'field__hint', id: `${id}-hint` }, HINT[decl.type]) : null),
    );
  }
  return form;
};
