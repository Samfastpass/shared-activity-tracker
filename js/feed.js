import { supabase } from './supabase.js';
import { el, formatDate, toast, avatar } from './dom.js';
import { mountComments } from './comments.js';
import { deleteActivity } from './activity.js';
import { signUrls, forgetUrl, deletePhoto, setFavourite, clearFavourite } from './photos.js';
import { openLightbox } from './lightbox.js';
import { icon } from './icons.js';

const PAGE_SIZE = 10;
const PHOTOS = 'photos(id, author_id, storage_path, width, height, created_at)';
const SELECT_V2 = `id, author_id, title, body, happened_at, created_at, kind, who_came, place_name, lat, lng, comments(count), ${PHOTOS}, favourites(user_id, photo_id)`;
const SELECT_V1 = `id, author_id, title, body, happened_at, created_at, comments(count), ${PHOTOS}`;
// PostgREST codes for "that column / table / relationship doesn't exist": the database hasn't been updated yet.
const SCHEMA_MISSING = new Set(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205']);
let select = SELECT_V2;

// Runs a query with the newest column list; if the database predates it, quietly falls back to the old one.
async function query(ctx, build) {
  let { data, error } = await build(select);
  if (error && select === SELECT_V2 && SCHEMA_MISSING.has(error.code)) {
    select = SELECT_V1;
    ctx.features.moments2 = false;
    ({ data, error } = await build(select));
  }
  if (error) throw error;
  return data;
}

// One batched request signs every photo on the page (URLs expire after ~1 hour).
async function withPhotoUrls(rows) {
  const paths = rows.flatMap((a) => (a.photos || []).map((p) => p.storage_path));
  let urls = new Map();
  if (paths.length) {
    try { urls = await signUrls(paths); } catch (e) { toast(`Couldn't load photos: ${e.message}`); }
  }
  for (const a of rows) a.photos = (a.photos || []).map((p) => ({ ...p, url: urls.get(p.storage_path) }));
  return rows;
}

async function fetchPage(ctx, from) {
  const data = await query(ctx, (cols) => supabase
    .from('activities')
    .select(cols)
    .order('happened_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'photos', ascending: true })
    .range(from, from + PAGE_SIZE - 1));
  return withPhotoUrls(data);
}

async function fetchOne(ctx, id) {
  const data = await query(ctx, (cols) => supabase
    .from('activities')
    .select(cols)
    .eq('id', id)
    .order('created_at', { referencedTable: 'photos', ascending: true })
    .maybeSingle());
  return data ? (await withPhotoUrls([data]))[0] : null;
}

// Newest first: by the day it happened, then by when it was posted.
const newer = (x, y) => `${x.happened_at}|${x.created_at}` > `${y.happened_at}|${y.created_at}`;

export function createFeed({ container, moreButton, ctx }) {
  const cards = new Map();            // activity id -> { a, node, api }
  const timers = new Map();           // per-activity debounced refreshes
  const inflight = new Set();
  let offset = 0;
  let commentSync = null;

  const name = (id) => ctx.profiles.get(id)?.display_name || 'Someone';
  const hasMore = () => !moreButton.hidden;
  const ordered = () => [...container.children].map((n) => cards.get(n.dataset.id)).filter(Boolean);

  function build(a, open) {
    const entry = renderCard(a, ctx, { open, remove: () => removeCard(a.id), refresh: () => refreshNow(a.id) });
    cards.set(a.id, entry);
    return entry;
  }

  function showEmptyIfNone() {
    if (!cards.size && !hasMore()) container.replaceChildren(emptyState());
  }

  // ---------- loading ----------
  async function reload({ silent = false } = {}) {
    const open = new Set([...cards].filter(([, e]) => e.api.isOpen()).map(([id]) => id));
    if (!silent) container.replaceChildren(el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }));
    try {
      const rows = await fetchPage(ctx, 0);
      cards.clear();
      offset = rows.length;
      container.replaceChildren(...(rows.length ? rows.map((a) => build(a, open.has(a.id)).node) : [emptyState()]));
      moreButton.hidden = rows.length < PAGE_SIZE;
    } catch (e) {
      if (!silent) container.replaceChildren(el('p', { class: 'muted' }, `Couldn't load activities: ${e.message}`));
      else toast(`Couldn't refresh: ${e.message}`);
    }
  }

  async function loadMore() {
    moreButton.disabled = true;
    try {
      const rows = (await fetchPage(ctx, offset)).filter((a) => !cards.has(a.id));   // live inserts may already be shown
      offset += rows.length;
      rows.forEach((a) => container.append(build(a, false).node));
      moreButton.hidden = rows.length < PAGE_SIZE;
    } catch (e) {
      toast(`Couldn't load activities: ${e.message}`);
    } finally { moreButton.disabled = false; }
  }

  // ---------- in-place updates ----------
  function replaceCard(a) {
    const old = cards.get(a.id);
    if (!old) return;
    const entry = build(a, old.api.isOpen());
    old.node.replaceWith(entry.node);
  }

  async function refreshNow(id) {
    try { const a = await fetchOne(ctx, id); if (a && cards.has(id)) replaceCard(a); } catch { /* next event or reload fixes it */ }
  }

  function scheduleRefresh(id) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => { timers.delete(id); refreshNow(id); }, 400));
  }

  function removeCard(id) {
    const entry = cards.get(id);
    if (!entry) return;
    entry.node.remove();
    cards.delete(id);
    offset = Math.max(0, offset - 1);
    showEmptyIfNone();
  }

  function addNew(a) {
    const entry = build(a, false);
    const next = ordered().find((c) => c !== entry && newer(entry.a, c.a));     // first card that is older
    if (next) next.node.before(entry.node);
    else if (!hasMore()) container.append(entry.node);
    else { cards.delete(a.id); return false; }                                   // belongs on a later page
    container.querySelector(':scope > .empty')?.remove();
    offset += 1;
    return true;
  }

  // ---------- live events ----------
  async function onActivity(payload) {
    if (payload.eventType === 'DELETE') return removeCard(payload.old?.id);
    const id = payload.new?.id;
    if (!id || inflight.has(id)) return;
    if (payload.eventType === 'INSERT' && cards.has(id)) return;                 // already shown (our own post)
    inflight.add(id);
    try {
      const a = await fetchOne(ctx, id);
      if (!a) return;
      if (cards.has(id)) replaceCard(a);
      else if (addNew(a) && a.author_id !== ctx.me.id) toast(`${name(a.author_id)} shared “${a.title}”`);
    } catch { /* a reload catches up */ } finally { inflight.delete(id); }
  }

  function onPhoto(payload) {
    if (payload.eventType === 'INSERT') return scheduleRefresh(payload.new.activity_id);
    if (payload.eventType === 'DELETE') {
      const owner = [...cards.values()].find((e) => e.a.photos.some((p) => p.id === payload.old?.id));
      if (owner) scheduleRefresh(owner.a.id);
    }
  }

  function onComment(payload) {
    if (payload.eventType === 'INSERT' && payload.new.author_id !== ctx.me.id) {
      const title = cards.get(payload.new.activity_id)?.a.title;
      toast(`${name(payload.new.author_id)} commented${title ? ` on “${title}”` : ''}`);
    }
    clearTimeout(commentSync);
    commentSync = setTimeout(syncComments, 300);
  }

  // Re-render open threads and refresh every visible comment count (one query).
  async function syncComments() {
    const ids = [...cards.keys()];
    if (!ids.length) return;
    cards.forEach((e) => e.api.refreshThread());
    const { data, error } = await supabase.from('activities').select('id, comments(count)').in('id', ids);
    if (error) return;
    for (const row of data) cards.get(row.id)?.api.setCount(row.comments?.[0]?.count ?? 0);
  }

  // Drop everything shown (used on sign-out so one person's posts never linger for the next).
  function clear() {
    cards.forEach((_, id) => clearTimeout(timers.get(id)));
    clearTimeout(commentSync);
    cards.clear(); offset = 0; container.replaceChildren();
  }

  moreButton.addEventListener('click', loadMore);
  // Someone picked or changed a favourite photo: refresh that moment's card.
  function onFavourite(payload) {
    const id = payload.new?.activity_id ?? payload.old?.activity_id;
    if (id && cards.has(id)) scheduleRefresh(id);
  }

  const refreshFeedback = (id) => cards.get(id)?.api.refreshFeedback();

  return { reload, clear, onActivity, onPhoto, onComment, onFavourite, refreshFeedback };
}

function emptyState() {
  return el('div', { class: 'empty' }, el('span', { class: 'heart', 'aria-hidden': 'true' }, '♡'), el('p', {}, 'Nothing here yet.'), el('p', { class: 'muted' }, 'Tap + to share your first little moment.'));
}

function renderCard(a, ctx, { open, remove, refresh }) {
  const author = ctx.profiles.get(a.author_id);
  const mine = a.author_id === ctx.me.id;
  let count = a.comments?.[0]?.count ?? 0;
  // An obvious button: speech-bubble icon, "Comment", and how many there are.
  const badge = el('span', { class: 'cb-count' });
  const toggle = el('button', { class: 'comment-btn', type: 'button', 'aria-expanded': 'false' }, icon('comment'), el('span', {}, 'Comment'), badge);
  const thread = el('div', { class: 'thread', hidden: true });
  let threadApi = null;
  let mounting = null;

  const setCount = (n) => {
    count = n;
    badge.textContent = n ? String(n) : '';
    badge.hidden = !n;
    toggle.setAttribute('aria-label', n ? `${n} comment${n === 1 ? '' : 's'}, open to read or reply` : 'Add a comment');
  };
  setCount(count);

  async function show() {
    thread.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (!threadApi && !mounting) {
      mounting = mountComments(thread, a.id, ctx, setCount).then((api) => { threadApi = api; });
    }
    await mounting;
  }

  toggle.addEventListener('click', async () => {
    if (thread.hidden) { await show(); threadApi?.focus(); }      // opened by hand: ready to type
    else { thread.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  });

  const who = ctx.feedback?.other();
  const feedbackButton = ctx.feedback?.available() && who && el('button', {
    class: 'link', type: 'button', 'aria-label': `Ask ${who.display_name} for feedback`, onclick: () => ctx.feedback.openAsk(a),
  }, 'Feedback');
  const feedback = el('div', { class: 'feedback' });
  const renderFeedback = () => feedback.replaceChildren(...(ctx.feedback?.sectionFor(a) ?? []));
  renderFeedback();

  const edit = mine && el('button', { class: 'link', type: 'button', onclick: () => ctx.composer.edit(a) }, 'Edit');
  const del = mine && el('button', {
    class: 'link danger', type: 'button',
    onclick: async () => {
      if (!confirm('Delete this activity, its photos and its comments?')) return;
      try { await deleteActivity(a); remove(); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
    },
  }, 'Delete');

  const node = el('article', { class: 'card', 'data-id': a.id, 'data-author-theme': author?.theme || '' },
    el('header', { class: 'card-head' },
      avatar(author),
      el('strong', { class: 'author' }, author?.display_name || 'Someone'),
      el('time', { class: 'muted', datetime: a.happened_at }, formatDate(a.happened_at))),
    el('h2', { class: 'card-title' }, a.title),
    metaLine(a, ctx),
    a.body && el('p', { class: 'card-body' }, a.body),
    photoSection(a, ctx, refresh),
    feedback,
    el('footer', { class: 'card-foot' }, toggle, feedbackButton, edit, del),
    thread);

  if (open) show();
  return {
    a, node,
    api: { isOpen: () => !thread.hidden, setCount, refreshThread: () => threadApi?.refresh(), refreshFeedback: renderFeedback },
  };
}

// "Just us" / "Group", where it happened, and who else came.
function metaLine(a, ctx) {
  if (ctx.features?.moments2 === false || !a.kind) return null;
  const group = a.kind === 'group';
  return el('div', { class: 'meta' },
    el('span', { class: `badge ${group ? 'group' : 'duo'}` }, icon(group ? 'users' : 'two', 14), group ? 'Group' : 'Just us'),
    a.place_name && el('span', { class: 'place' }, icon('pin', 14), a.place_name),
    group && a.who_came && el('span', { class: 'who' }, `with ${a.who_came}`));
}

// An <img> that re-signs its URL once if it has expired while the page stayed open.
function photoImg(p, alt) {
  const img = el('img', { src: p.url, alt, loading: 'lazy', decoding: 'async', width: p.width || null, height: p.height || null });
  img.addEventListener('error', async () => {
    if (img.dataset.retried) return;
    img.dataset.retried = '1';
    forgetUrl(p.storage_path);
    try {
      const fresh = (await signUrls([p.storage_path])).get(p.storage_path);
      if (fresh) { p.url = fresh; img.src = fresh; }
    } catch { /* leave the broken image */ }
  });
  return img;
}

// Favourite photos headline the moment (one per person); the rest sit in a grid below.
function photoSection(a, ctx, refresh) {
  const photos = a.photos.filter((p) => p.url);
  if (!photos.length) return null;
  const favs = a.favourites || [];
  const name = (id) => ctx.profiles.get(id)?.display_name || 'Someone';
  const chosenBy = (photoId) => favs.filter((f) => f.photo_id === photoId).map((f) => f.user_id)
    .sort((x, y) => (x === a.author_id ? -1 : y === a.author_id ? 1 : 0));          // the moment's author first
  const heroes = photos.filter((p) => chosenBy(p.id).length)
    .sort((x, y) => (chosenBy(x.id).includes(a.author_id) ? -1 : 0) - (chosenBy(y.id).includes(a.author_id) ? -1 : 0));
  const rest = photos.filter((p) => !heroes.includes(p));
  const ordered = [...heroes, ...rest];

  const open = (photo) => openLightbox(ordered.map((x, n) => ({ ...x, alt: `Photo ${n + 1} of ${ordered.length}` })), ordered.indexOf(photo), {
    canDelete: (item) => item.author_id === ctx.me.id,
    onDelete: async (item) => { await deletePhoto(item); await refresh(); },
    favourite: {
      isMine: (item) => favs.some((f) => f.user_id === ctx.me.id && f.photo_id === item.id),
      by: (item) => chosenBy(item.id).map(name),
      toggle: async (item) => {
        const mine = favs.some((f) => f.user_id === ctx.me.id && f.photo_id === item.id);
        if (mine) { await clearFavourite(a.id, ctx.me.id); a.favourites = favs.filter((f) => f.user_id !== ctx.me.id); }
        else { await setFavourite(a.id, item.id); a.favourites = [...favs.filter((f) => f.user_id !== ctx.me.id), { user_id: ctx.me.id, photo_id: item.id }]; }
        favs.length = 0; favs.push(...a.favourites);
        await refresh();
      },
    },
  });

  const parts = [];
  if (heroes.length) {
    parts.push(el('div', { class: 'heroes', 'data-count': String(heroes.length) }, ...heroes.map((p) => {
      const who = chosenBy(p.id);
      const label = `${who.map(name).join(' & ')}’s favourite`;
      return el('button', { class: 'hero', type: 'button', 'aria-label': `Open ${label}`, onclick: () => open(p) },
        photoImg(p, `${label} from “${a.title}”`),
        el('span', { class: 'hero-tag', 'data-author-theme': ctx.profiles.get(who[0])?.theme || '' }, ...who.map((id) => avatar(ctx.profiles.get(id), 'small')), label));
    })));
  }
  if (rest.length) {
    const grid = el('div', { class: 'photo-grid', 'data-count': rest.length === 1 && !heroes.length ? '1' : 'many' });
    rest.forEach((p) => {
      const alt = `Photo ${ordered.indexOf(p) + 1} of ${ordered.length} from “${a.title}”`;
      grid.append(el('button', { class: 'photo', type: 'button', 'aria-label': `Open ${alt}`, onclick: () => open(p) }, photoImg(p, alt)));
    });
    parts.push(grid);
  }
  return el('div', { class: 'photos' }, ...parts);
}
