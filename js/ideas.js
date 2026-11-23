import { supabase } from './supabase.js';
import { el, toast, avatar, formatDate } from './dom.js';
import { icon } from './icons.js';
import { mountComments, IDEA_COMMENTS } from './comments.js';
import { createPlacePicker } from './placepicker.js';

const SELECT = 'id, author_id, title, body, place_name, lat, lng, status, moment_id, created_at, idea_votes(user_id), idea_comments(count)';
const STATUSES = [['idea', 'Idea'], ['planned', 'Planned'], ['done', 'Done']];
const FILTERS = [['all', 'All'], ['idea', 'Ideas'], ['planned', 'Planned'], ['done', 'Done']];
const $ = (id) => document.getElementById(id);

// The ideas board: add ideas, like them, comment, move them from Idea to Planned to Done, and turn
// one into a moment. If the tables aren't there yet (database not updated) `load()` reports false
// and the app hides the tab.
export function createIdeas({ ctx, view, newMoment, openMoment }) {
  const ideas = new Map();          // id -> idea
  const cards = new Map();          // id -> { sig, node, api }
  let filter = 'all';
  let editing = null;               // the idea being edited in the dialog (null = adding)

  const name = (id) => ctx.profiles.get(id)?.display_name || 'Someone';
  const mine = (i) => i.author_id === ctx.me.id;
  const votesOf = (i) => (i.idea_votes || []).length;
  const iVoted = (i) => (i.idea_votes || []).some((v) => v.user_id === ctx.me.id);
  const commentCount = (i) => i.idea_comments?.[0]?.count ?? 0;

  // ---------- page shell ----------
  const count = el('p', { class: 'muted tl-stats' });
  const addBtn = el('button', { class: 'btn primary', type: 'button' }, icon('plus', 16), 'Add an idea');
  const chips = FILTERS.map(([key, label]) => el('button', { class: 'chip filter', type: 'button', role: 'radio', 'data-value': key, 'aria-checked': String(key === filter),
    onclick: () => { filter = key; chips.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.value === filter))); render(); } }, label));
  const list = el('div', { class: 'idea-list' });
  view.replaceChildren(el('div', { class: 'view-head' }, el('h2', {}, 'Ideas'), count),
    el('div', { class: 'idea-bar' }, el('div', { class: 'filters', role: 'radiogroup', 'aria-label': 'Show' }, ...chips), addBtn), list);

  // ---------- loading ----------
  async function load() {
    const { data, error } = await supabase.from('ideas').select(SELECT).order('created_at', { ascending: false });
    if (error) { ideas.clear(); render(); return false; }
    ideas.clear();
    data.forEach((i) => ideas.set(i.id, i));
    render();
    return true;
  }

  function clear() { ideas.clear(); cards.clear(); list.replaceChildren(); count.textContent = ''; }

  // ---------- one idea ----------
  function sig(i) {
    return JSON.stringify([i.title, i.body, i.place_name, i.status, i.moment_id, (i.idea_votes || []).map((v) => v.user_id).sort(),
      name(i.author_id), ctx.profiles.get(i.author_id)?.theme, ctx.profiles.get(i.author_id)?.avatarUrl ? 1 : 0, ctx.me.id]);
  }

  // A card can outlive the object it was built from (a refresh replaces them), so actions always
  // work on the current copy, looked up by id.
  const live = (i) => ideas.get(i.id) ?? i;

  async function patch(idea, fields, failMessage) {
    const i = live(idea);
    const before = { ...i };
    Object.assign(i, fields); render();                                        // optimistic
    const { error } = await supabase.from('ideas').update(fields).eq('id', i.id);
    if (error) { Object.assign(i, before); render(); toast(`${failMessage}: ${error.message}`); return false; }
    return true;
  }

  async function toggleVote(idea) {
    const i = live(idea);
    const had = iVoted(i);
    const before = i.idea_votes;
    i.idea_votes = had ? before.filter((v) => v.user_id !== ctx.me.id) : [...before, { user_id: ctx.me.id }];
    render();
    const { error } = had
      ? await supabase.from('idea_votes').delete().eq('idea_id', i.id).eq('user_id', ctx.me.id)
      : await supabase.from('idea_votes').insert({ idea_id: i.id });
    if (error) { i.idea_votes = before; render(); toast(`Couldn't update your like: ${error.message}`); }
  }

  async function remove(i) {
    if (!confirm('Delete this idea and its comments?')) return;
    const { error } = await supabase.from('ideas').delete().eq('id', i.id);
    if (error) return toast(`Couldn't delete: ${error.message}`);
    ideas.delete(i.id); render();
  }

  function turnIntoMoment(i) {
    newMoment({ title: i.title, body: i.body, place_name: i.place_name, lat: i.lat, lng: i.lng }, async (activityId) => {
      await patch(i, { status: 'done', moment_id: activityId }, "Couldn't link the moment");
    });
  }

  // Builds (or rebuilds) an idea's card. The comment thread element and its state are carried over from
  // the previous card, so a like, a status change or a new comment never wipes a reply being typed.
  function buildCard(i, prev) {
    const author = ctx.profiles.get(i.author_id);
    const state = prev?.state ?? { api: null, mounting: null, setCount: () => {} };
    const thread = prev?.thread ?? el('div', { class: 'thread', hidden: true });
    const n = commentCount(i);
    const label = (c) => (c ? `${c} comment${c === 1 ? '' : 's'}, open to read or reply` : 'Add a comment');
    const badge = el('span', { class: 'cb-count', hidden: !n }, n ? String(n) : '');
    const toggle = el('button', { class: 'comment-btn', type: 'button', 'aria-expanded': String(!thread.hidden), 'aria-label': label(n) },
      icon('comment'), el('span', {}, 'Comment'), badge);
    const setCount = (c) => { badge.textContent = c ? String(c) : ''; badge.hidden = !c; toggle.setAttribute('aria-label', label(c)); };
    state.setCount = setCount;

    async function show() {
      thread.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      if (!state.api && !state.mounting) state.mounting = mountComments(thread, i.id, ctx, (c) => state.setCount(c), IDEA_COMMENTS).then((api) => { state.api = api; });
      await state.mounting;
    }
    toggle.addEventListener('click', async () => {
      if (thread.hidden) { await show(); state.api?.focus(); } else { thread.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    });

    const likes = votesOf(i);
    const vote = el('button', { class: 'vote-btn', type: 'button', 'aria-pressed': String(iVoted(i)), 'aria-label': iVoted(i) ? `Unlike (${likes} like${likes === 1 ? '' : 's'})` : `Like this idea (${likes} like${likes === 1 ? '' : 's'})`, onclick: () => toggleVote(i) },
      icon('heart', 16), el('span', { class: 'vote-count' }, String(likes)));

    const status = el('div', { class: 'status-seg', role: 'radiogroup', 'aria-label': 'Status' }, ...STATUSES.map(([key, label]) =>
      el('button', { type: 'button', role: 'radio', 'aria-checked': String(i.status === key), 'data-status': key, onclick: () => { if (i.status !== key) patch(i, { status: key }, "Couldn't change the status"); } }, label)));

    const next = [];
    if (i.moment_id) next.push(el('button', { class: 'btn small', type: 'button', onclick: () => openMoment(i.moment_id) }, icon('check', 16), 'See the moment'));
    else if (i.status !== 'idea') next.push(el('button', { class: 'btn small primary', type: 'button', onclick: () => turnIntoMoment(i) }, icon('plus', 16), 'We did it: make it a moment'));

    const node = el('article', { class: 'idea-card', 'data-status': i.status, 'data-id': i.id, 'data-author-theme': author?.theme || '' },
      el('header', { class: 'card-head' }, avatar(author), el('strong', { class: 'author' }, author?.display_name || 'Someone'), el('time', { class: 'muted' }, formatDate(i.created_at.slice(0, 10)))),
      el('h3', { class: 'idea-title' }, i.title),
      i.body && el('p', { class: 'card-body' }, i.body),
      i.place_name && el('div', { class: 'meta' }, el('span', { class: 'place' }, icon('pin', 14), i.place_name)),
      el('div', { class: 'idea-actions' }, vote, toggle, status),
      next.length ? el('div', { class: 'idea-next' }, ...next) : null,
      mine(i) ? el('div', { class: 'idea-owner' },
        el('button', { class: 'link', type: 'button', onclick: () => openDialog(i) }, 'Edit'),
        el('button', { class: 'link danger', type: 'button', onclick: () => remove(i) }, 'Delete')) : null,
      thread);
    return { sig: sig(i), node, thread, state, api: { isOpen: () => !thread.hidden, refreshThread: () => state.api?.refresh(), setCount } };
  }

  // ---------- the list ----------
  const rank = (a, b) => votesOf(b) - votesOf(a) || b.created_at.localeCompare(a.created_at);

  function render() {
    const all = [...ideas.values()];
    const shown = all.filter((i) => filter === 'all' || i.status === filter).sort(rank);
    count.textContent = all.length ? `${all.length} idea${all.length === 1 ? '' : 's'}` : '';
    const nodes = [];
    const keep = new Set();
    for (const i of shown) {
      const old = cards.get(i.id);
      if (old && old.sig === sig(i)) old.api.setCount(commentCount(i));       // only the badge can have changed
      const entry = old && old.sig === sig(i) ? old : buildCard(i, old);
      cards.set(i.id, entry); keep.add(i.id); nodes.push(entry.node);
    }
    for (const id of [...cards.keys()]) if (!keep.has(id)) cards.delete(id);
    list.replaceChildren(...(nodes.length ? nodes : [el('div', { class: 'empty' }, el('span', { class: 'heart', 'aria-hidden': 'true' }, '♡'),
      el('p', {}, all.length ? 'Nothing here with this status.' : 'No ideas yet.'),
      el('p', { class: 'muted' }, all.length ? 'Try “All”.' : 'Add the first thing you want to do together.'))]));
  }

  // ---------- add / edit dialog ----------
  const dialog = $('idea-dialog');
  const form = $('idea-form');
  const status = form.querySelector('.status');
  const places = createPlacePicker({ label: 'Where would we go? (optional)' });
  $('idea-place-slot').append(places.element);
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

  function openDialog(idea = null) {
    editing = idea;
    form.reset(); status.textContent = '';
    $('idea-heading').textContent = idea ? 'Edit this idea' : 'A new idea';
    form.elements.title.value = idea?.title ?? '';
    form.elements.body.value = idea?.body ?? '';
    places.set(idea ?? {});
    dialog.showModal();
    form.elements.title.focus();
  }
  addBtn.addEventListener('click', () => openDialog());
  form.addEventListener('input', () => { status.textContent = ''; });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) { status.textContent = 'Give your idea a title.'; return; }
    const fields = { title, body: form.elements.body.value.trim() || null, ...places.get() };
    const button = form.querySelector('button[type=submit]');
    button.disabled = true; status.textContent = '';
    try {
      if (editing) {
        const { error } = await supabase.from('ideas').update(fields).eq('id', editing.id);
        if (error) throw error;
        Object.assign(live(editing), fields);
      } else {
        const { data, error } = await supabase.from('ideas').insert(fields).select(SELECT).single();
        if (error) throw error;
        ideas.set(data.id, data);
      }
      render();
      dialog.close();
    } catch (e) { status.textContent = `Couldn't save: ${e.message}`; }
    finally { button.disabled = false; }
  });

  // ---------- live events (the data is small: refetch and keep unchanged cards as they are) ----------
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(async () => { await load(); cards.forEach((e) => e.api.refreshThread()); }, 350); };

  function onIdea(payload) {
    if (payload.eventType === 'INSERT' && payload.new?.author_id !== ctx.me.id) toast(`${name(payload.new.author_id)} added an idea: “${payload.new.title}”`);
    soon();
  }
  function onVote() { soon(); }
  function onComment(payload) {
    if (payload.eventType === 'INSERT' && payload.new?.author_id !== ctx.me.id) toast(`${name(payload.new.author_id)} commented on an idea`);
    soon();
  }

  return { load, clear, onIdea, onVote, onComment, show: load };
}
