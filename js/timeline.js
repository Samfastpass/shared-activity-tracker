import { el } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './dom.js';
import { kindFilter } from './filters.js';
import { loadMoments, matches, hasPin, placeKey } from './moments.js';

const monthOf = (a) => a.happened_at.slice(0, 7);
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
const dayParts = (iso) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return { day: d, dow: dt.toLocaleDateString(undefined, { weekday: 'short' }) }; };

// A vertical timeline, grouped by month, led by each moment's favourite photos.
export function createTimeline({ ctx, view, openMoment }) {
  let moments = [];
  const stats = el('p', { class: 'muted tl-stats' });
  const list = el('div', { class: 'tl-list' });
  const filters = kindFilter(() => render());
  view.replaceChildren(el('div', { class: 'view-head' }, el('h2', {}, 'Timeline'), stats), filters.element, list);

  function item(a) {
    const author = ctx.profiles.get(a.author_id);
    const group = a.kind === 'group';
    const { day, dow } = dayParts(a.happened_at);
    const thumbs = a.heroes.length
      ? el('div', { class: 'tl-thumbs', 'data-count': String(a.heroes.length) }, ...a.heroes.map((h) => el('span', { class: 'tl-thumb' },
        h.url ? el('img', { src: h.url, alt: '', loading: 'lazy', decoding: 'async' }) : null,
        h.by.length ? el('span', { class: 'tl-by', 'data-author-theme': ctx.profiles.get(h.by[0])?.theme || '' }, ...h.by.map((id) => avatar(ctx.profiles.get(id), 'small'))) : null)))
      : el('div', { class: 'tl-thumbs tl-none', 'aria-hidden': 'true' }, icon(a.place_name ? 'pin' : (group ? 'users' : 'two'), 26));
    return el('article', { class: 'tl-item', 'data-kind': a.kind, 'data-author-theme': author?.theme || '' },
      el('div', { class: 'tl-date' }, el('strong', {}, String(day)), el('span', { class: 'muted' }, dow)),
      el('span', { class: 'tl-dot', 'aria-hidden': 'true' }),
      el('button', { class: 'tl-card', type: 'button', onclick: () => openMoment(a.id), 'aria-label': `Open “${a.title}”` },
        thumbs,
        el('span', { class: 'tl-text' },
          el('strong', { class: 'tl-title' }, a.title),
          el('span', { class: 'meta' },
            el('span', { class: `badge ${group ? 'group' : 'duo'}` }, icon(group ? 'users' : 'two', 14), group ? 'Group' : 'Just us'),
            a.place_name && el('span', { class: 'place' }, icon('pin', 14), a.place_name),
            group && a.who_came && el('span', { class: 'who' }, `with ${a.who_came}`)))));
  }

  function render() {
    const shown = moments.filter((a) => matches(a, filters.get()));
    const places = new Set(shown.filter(hasPin).map(placeKey)).size;
    stats.textContent = shown.length ? `${shown.length} moment${shown.length === 1 ? '' : 's'} · ${places} place${places === 1 ? '' : 's'}` : '';
    if (!shown.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'heart', 'aria-hidden': 'true' }, '♡'),
        el('p', {}, moments.length ? 'Nothing matches this filter.' : 'No moments yet.'),
        el('p', { class: 'muted' }, moments.length ? 'Try “All”.' : 'Share your first one from the Moments tab.')));
      return;
    }
    const out = [];
    let current = null;
    for (const a of shown) {
      if (monthOf(a) !== current) { current = monthOf(a); out.push(el('h3', { class: 'tl-month' }, monthLabel(current))); }
      out.push(item(a));
    }
    list.replaceChildren(el('div', { class: 'tl-rail' }, ...out));
  }

  async function show() {
    if (!moments.length) list.replaceChildren(el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }));
    try { moments = await loadMoments(); render(); }
    catch (e) { list.replaceChildren(el('p', { class: 'muted' }, `Couldn't load the timeline: ${e.message}`)); }
  }

  return { show, clear: () => { moments = []; list.replaceChildren(); stats.textContent = ''; } };
}
