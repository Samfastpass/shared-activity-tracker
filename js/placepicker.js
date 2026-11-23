import { el } from './dom.js';
import { icon } from './icons.js';
import { searchPlaces, reverseGeocode, currentPosition } from './places.js';

// "Where was it?": search for a place, use your current location, or just type a name.
// get() -> { place_name, lat, lng } (all null when empty).
export function createPlacePicker({ label = 'Where was it?' } = {}) {
  let place = null;                                          // { name, lat, lng } (lat/lng null for a name only)

  const input = el('input', { type: 'search', placeholder: 'Search for a place…', 'aria-label': 'Search for a place', maxlength: 120, autocomplete: 'off' });
  const searchBtn = el('button', { class: 'btn small', type: 'button' }, icon('search', 16), 'Search');
  const locateBtn = el('button', { class: 'btn small', type: 'button' }, icon('locate', 16), 'Use my location');
  const results = el('ul', { class: 'place-results' });
  const message = el('p', { class: 'muted place-msg', role: 'status' });
  const finder = el('div', { class: 'place-finder' },
    el('div', { class: 'place-search' }, input, searchBtn), el('div', { class: 'place-actions' }, locateBtn), results, message);
  const chipText = el('span', { class: 'place-name' });
  const chip = el('div', { class: 'place-chip', hidden: true }, icon('pin', 16), chipText,
    el('button', { class: 'link', type: 'button', 'aria-label': 'Remove the place', onclick: () => clear() }, icon('close', 16)));
  const element = el('div', { class: 'place-picker' }, el('span', { class: 'place-label' }, label), chip, finder);

  const busy = (on) => { searchBtn.disabled = locateBtn.disabled = on; };
  function render() {
    chip.hidden = !place;
    finder.hidden = !!place;
    chipText.textContent = place ? place.name + (place.lat == null ? ' (name only)' : '') : '';
  }
  function choose(p) { place = p; results.replaceChildren(); message.textContent = ''; input.value = ''; render(); }
  function clear() { place = null; render(); input.focus(); }

  async function search() {
    const q = input.value.trim();
    if (!q) { message.textContent = 'Type a place to search for.'; return; }
    busy(true); message.textContent = 'Searching…'; results.replaceChildren();
    try {
      const found = await searchPlaces(q);
      message.textContent = found.length ? '' : 'Nothing found. You can still use what you typed as the name.';
      results.replaceChildren(...found.map((p) => el('li', {}, el('button', { class: 'place-result', type: 'button', onclick: () => choose(p) }, icon('pin', 16), p.name))),
        el('li', {}, el('button', { class: 'place-result name-only', type: 'button', onclick: () => choose({ name: q.slice(0, 200), lat: null, lng: null }) }, `Use “${q}” as the name only (no map pin)`)));
    } catch (e) { message.textContent = e.message; }
    finally { busy(false); }
  }

  async function useMyLocation() {
    busy(true); message.textContent = 'Finding you…'; results.replaceChildren();
    try {
      const { lat, lng } = await currentPosition();
      message.textContent = 'Looking up the place name…';
      let name = null;
      try { name = await reverseGeocode(lat, lng); } catch { /* the pin is still useful */ }
      choose({ name: name || 'My location', lat, lng });
    } catch (e) { message.textContent = e.message; }
    finally { busy(false); }
  }

  searchBtn.addEventListener('click', search);
  locateBtn.addEventListener('click', useMyLocation);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });   // never submits the form
  render();

  return {
    element,
    get: () => ({ place_name: place?.name ?? null, lat: place?.lat ?? null, lng: place?.lng ?? null }),
    set: ({ place_name, lat, lng } = {}) => { place = place_name ? { name: place_name, lat: lat ?? null, lng: lng ?? null } : null; results.replaceChildren(); message.textContent = ''; input.value = ''; render(); },
  };
}
