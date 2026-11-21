import { supabase } from './supabase.js';
import { el, formatDate, toast, avatar } from './dom.js';
import { mountComments } from './comments.js';
import { deleteActivity } from './activity.js';
import { signUrls, forgetUrl } from './photos.js';
import { openLightbox } from './lightbox.js';
import { deletePhoto } from './photos.js';

const PAGE_SIZE = 10;

async function fetchPage(from) {
  const { data, error } = await supabase
    .from('activities')
    .select('id, author_id, title, body, happened_at, created_at, comments(count), photos(id, author_id, storage_path, width, height, created_at)')
    .order('happened_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'photos', ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;

  // One batched request signs every photo on the page (URLs expire after ~1 hour).
  const paths = data.flatMap((a) => (a.photos || []).map((p) => p.storage_path));
  let urls = new Map();
  if (paths.length) {
    try { urls = await signUrls(paths); } catch (e) { toast(`Couldn't load photos: ${e.message}`); }
  }
  for (const a of data) a.photos = (a.photos || []).map((p) => ({ ...p, url: urls.get(p.storage_path) }));
  return data;
}

export function createFeed({ container, moreButton, ctx }) {
  let offset = 0;

  async function loadMore() {
    moreButton.disabled = true;
    try {
      const rows = await fetchPage(offset);
      offset += rows.length;
      rows.forEach((a) => container.append(renderCard(a, ctx, reload)));
      moreButton.hidden = rows.length < PAGE_SIZE;
      if (offset === 0) container.replaceChildren(emptyState());
    } catch (e) {
      toast(`Couldn't load activities: ${e.message}`);
    } finally { moreButton.disabled = false; }
  }

  async function reload() {
    offset = 0;
    container.replaceChildren(el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }));
    try {
      const rows = await fetchPage(0);
      offset = rows.length;
      container.replaceChildren(...(rows.length ? rows.map((a) => renderCard(a, ctx, reload)) : [emptyState()]));
      moreButton.hidden = rows.length < PAGE_SIZE;
    } catch (e) {
      container.replaceChildren(el('p', { class: 'muted' }, `Couldn't load activities: ${e.message}`));
    }
  }

  moreButton.addEventListener('click', loadMore);
  return { reload };
}

function emptyState() {
  return el('div', { class: 'empty' }, el('span', { class: 'heart', 'aria-hidden': 'true' }, '♡'), el('p', {}, 'Nothing here yet.'), el('p', { class: 'muted' }, 'Tap + to share your first little moment.'));
}

function renderCard(a, ctx, reload) {
  const author = ctx.profiles.get(a.author_id);
  const mine = a.author_id === ctx.me.id;
  let count = a.comments?.[0]?.count ?? 0;
  const countLabel = () => `${count} comment${count === 1 ? '' : 's'}`;

  const toggle = el('button', { class: 'link', type: 'button', 'aria-expanded': 'false' }, countLabel());
  const thread = el('div', { class: 'thread', hidden: true });
  let mounted = false;

  toggle.addEventListener('click', async () => {
    const open = thread.hidden;
    thread.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !mounted) {
      mounted = true;
      await mountComments(thread, a.id, ctx, (n) => { count = n; toggle.textContent = countLabel(); });
    }
  });

  const del = mine && el('button', {
    class: 'link danger', type: 'button',
    onclick: async () => {
      if (!confirm('Delete this activity, its photos and its comments?')) return;
      try { await deleteActivity(a); await reload(); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
    },
  }, 'Delete');

  const addPhotos = mine && el('button', { class: 'link', type: 'button', onclick: () => ctx.composer.addPhotos(a) }, 'Add photos');

  return el('article', { class: 'card', 'data-author-theme': author?.theme || '' },
    el('header', { class: 'card-head' },
      avatar(author),
      el('strong', { class: 'author' }, author?.display_name || 'Someone'),
      el('time', { class: 'muted', datetime: a.happened_at }, formatDate(a.happened_at))),
    el('h2', { class: 'card-title' }, a.title),
    a.body && el('p', { class: 'card-body' }, a.body),
    photoGrid(a, ctx, reload),
    el('footer', { class: 'card-foot' }, toggle, addPhotos, del),
    thread);
}

function photoGrid(a, ctx, reload) {
  const photos = a.photos.filter((p) => p.url);
  if (!photos.length) return null;
  const grid = el('div', { class: 'photo-grid', 'data-count': photos.length === 1 ? '1' : 'many' });
  photos.forEach((p, i) => {
    const alt = `Photo ${i + 1} of ${photos.length} from “${a.title}”`;
    const img = el('img', { src: p.url, alt, loading: 'lazy', decoding: 'async', width: p.width || null, height: p.height || null });
    // A signed URL can expire while the page stays open: re-sign once and retry.
    img.addEventListener('error', async () => {
      if (img.dataset.retried) return;
      img.dataset.retried = '1';
      forgetUrl(p.storage_path);
      try {
        const fresh = (await signUrls([p.storage_path])).get(p.storage_path);
        if (fresh) { p.url = fresh; img.src = fresh; }
      } catch { /* leave the broken image */ }
    });
    grid.append(el('button', {
      class: 'photo', type: 'button', 'aria-label': `Open ${alt}`,
      onclick: () => openLightbox(photos.map((x, n) => ({ ...x, alt: `Photo ${n + 1} of ${photos.length}` })), i, {
        canDelete: (item) => item.author_id === ctx.me.id,
        onDelete: async (item) => { await deletePhoto(item); await reload(); },
      }),
    }, img));
  });
  return grid;
}
