import { el, formatDate } from './dom.js';
import { icon } from './icons.js';
import { kindFilter } from './filters.js';
import { loadMoments, matches, hasPin, placeKey } from './moments.js';

const LEAFLET_JS = 'https://esm.sh/leaflet@1.9.4';
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

let leafletPromise = null;
function loadLeaflet() {                                        // only when the Map tab is first opened
  leafletPromise ??= (async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
    document.head.append(css);
    const mod = await import(LEAFLET_JS);
    return mod.default || mod;
  })();
  leafletPromise.catch(() => { leafletPromise = null; });       // allow a retry
  return leafletPromise;
}

// A map of the places you have been, with a photo pin for each spot.
export function createMapView({ ctx, view, openMoment }) {
  let L = null, map = null, layer = null, moments = [], fitted = false;
  const stats = el('p', { class: 'muted tl-stats' });
  const note = el('p', { class: 'muted map-note', role: 'status' });
  const canvas = el('div', { class: 'map-canvas', role: 'application', 'aria-label': 'Map of places you have been' });
  const filters = kindFilter(() => draw(true));
  view.replaceChildren(el('div', { class: 'view-head' }, el('h2', {}, 'Map'), stats), filters.element, canvas, note);

  function pin(group, count) {
    const first = group[0];
    const h = first.heroes[0];
    const kinds = new Set(group.map((a) => a.kind));
    const kind = kinds.size > 1 ? 'mixed' : (first.kind === 'group' ? 'group' : 'duo');
    return el('div', { class: `pin ${kind}` },
      h?.url ? el('img', { src: h.url, alt: '' }) : icon('pin', 22),
      count > 1 ? el('span', { class: 'pin-count' }, String(count)) : null);
  }

  function popup(group) {
    return el('div', { class: 'map-popup' },
      el('strong', { class: 'popup-place' }, group[0].place_name || 'Here'),
      el('ul', {}, ...group.map((a) => el('li', {}, el('button', { class: 'link', type: 'button', onclick: () => { map.closePopup(); openMoment(a.id); } },
        el('span', {}, a.title), el('span', { class: 'muted' }, ` · ${formatDate(a.happened_at)}`))))));
  }

  function draw(refit) {
    if (!map) return;
    layer.clearLayers();
    const shown = moments.filter((a) => matches(a, filters.get()) && hasPin(a));
    const groups = new Map();
    for (const a of shown) { const k = placeKey(a); groups.set(k, [...(groups.get(k) || []), a]); }
    const bounds = [];
    for (const group of groups.values()) {
      const ll = [group[0].lat, group[0].lng];
      bounds.push(ll);
      L.marker(ll, { icon: L.divIcon({ html: pin(group, group.length), className: 'pin-icon', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -22] }), keyboard: true, title: group.map((a) => a.title).join(', ') })
        .bindPopup(popup(group), { closeButton: true }).addTo(layer);
    }
    stats.textContent = shown.length ? `${groups.size} place${groups.size === 1 ? '' : 's'} · ${shown.length} moment${shown.length === 1 ? '' : 's'}` : '';
    const unpinned = moments.filter((a) => matches(a, filters.get()) && !hasPin(a) && a.place_name).length;
    note.textContent = !bounds.length
      ? 'No pins yet. Add a place to a moment (search, or “Use my location”) and it appears here.'
      : (unpinned ? `${unpinned} moment${unpinned === 1 ? ' has' : 's have'} a place name but no pin.` : '');
    if (bounds.length && (refit || !fitted)) { map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 }); fitted = true; }
  }

  async function show() {
    try {
      L = await loadLeaflet();
      if (!map) {
        map = L.map(canvas, { worldCopyJump: true, zoomControl: true }).setView([20, 0], 2);
        L.tileLayer(TILES, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
        layer = L.layerGroup().addTo(map);
      }
      moments = await loadMoments();
      draw(false);
      setTimeout(() => map.invalidateSize(), 50);               // the view was hidden while Leaflet measured it
    } catch (e) { note.textContent = `Couldn't load the map: ${e.message}`; }
  }

  return { show, clear: () => { moments = []; layer?.clearLayers(); stats.textContent = ''; note.textContent = ''; fitted = false; } };
}
