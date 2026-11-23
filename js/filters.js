import { el } from './dom.js';
import { icon } from './icons.js';

const OPTIONS = [['all', 'All', null], ['one_to_one', 'Just us', 'two'], ['group', 'Group', 'users']];

// "All / Just us / Group" chips. `onChange(value)` runs when one is chosen.
export function kindFilter(onChange) {
  let value = 'all';
  const buttons = OPTIONS.map(([key, label, ic]) => el('button', {
    class: 'chip filter', type: 'button', role: 'radio', 'data-value': key, 'aria-checked': String(key === value),
    onclick: () => { value = key; sync(); onChange(key); },
  }, ic && icon(ic, 14), label));
  const element = el('div', { class: 'filters', role: 'radiogroup', 'aria-label': 'Show' }, ...buttons);
  function sync() { buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value))); }
  return { element, get: () => value };
}
