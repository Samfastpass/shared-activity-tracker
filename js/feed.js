import { supabase } from './supabase.js';
import { el, formatDate, toast, avatar } from './dom.js';
import { mountComments } from './comments.js';
import { deleteActivity } from './activity.js';

const PAGE_SIZE = 10;

async function fetchPage(from) {
  const { data, error } = await supabase
    .from('activities')
    .select('id, author_id, title, body, happened_at, created_at, comments(count)')
    .order('happened_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
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
      if (!confirm('Delete this activity and its comments?')) return;
      try { await deleteActivity(a.id); await reload(); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
    },
  }, 'Delete');

  return el('article', { class: 'card', 'data-author-theme': author?.theme || '' },
    el('header', { class: 'card-head' },
      avatar(author),
      el('strong', { class: 'author' }, author?.display_name || 'Someone'),
      el('time', { class: 'muted', datetime: a.happened_at }, formatDate(a.happened_at))),
    el('h2', { class: 'card-title' }, a.title),
    a.body && el('p', { class: 'card-body' }, a.body),
    el('footer', { class: 'card-foot' }, toggle, del),
    thread);
}
