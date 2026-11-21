import { supabase } from './supabase.js';
import { el, toast, avatar } from './dom.js';

export async function loadComments(activityId) {
  const { data, error } = await supabase
    .from('comments')
    .select('id, author_id, body, created_at, edited_at')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addComment(activityId, body) {
  const { error } = await supabase.from('comments').insert({ activity_id: activityId, body });
  if (error) throw error;
}

export async function updateComment(id, body) {
  const { error } = await supabase.from('comments').update({ body }).eq('id', id);
  if (error) throw error;
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

// Renders the comment thread + form into `container`. `onCount` is told the new total.
// Returns { refresh } so live updates can re-render the list.
export async function mountComments(container, activityId, ctx, onCount) {
  const list = el('div', { class: 'comment-list' });
  const input = el('input', { type: 'text', maxlength: 5000, placeholder: 'Add a comment…', 'aria-label': 'Add a comment', required: true });
  const form = el('form', { class: 'comment-form' }, input, el('button', { type: 'submit', class: 'btn' }, 'Send'));
  container.append(list, form);

  let editing = 0;      // comments currently being edited
  let stale = false;    // a refresh was requested while editing

  async function refresh() {
    if (editing) { stale = true; return; }     // never clobber a half-typed edit
    stale = false;
    try {
      const comments = await loadComments(activityId);
      if (editing) { stale = true; return; }
      list.replaceChildren(...comments.map((c) => commentRow(c, ctx, {
        remove: async () => {
          try { await deleteComment(c.id); await refresh(); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
        },
        save: async (text) => { await updateComment(c.id, text); },
        editStart: () => { editing += 1; },
        editEnd: () => { editing = Math.max(0, editing - 1); if (!editing && stale) refresh(); },
        done: () => refresh(),
      })));
      onCount(comments.length);
    } catch (e) {
      list.replaceChildren(el('p', { class: 'muted' }, `Couldn't load comments: ${e.message}`));
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    form.querySelector('button').disabled = true;
    try { await addComment(activityId, body); input.value = ''; await refresh(); }
    catch (e) { toast(`Couldn't post comment: ${e.message}`); }
    finally { form.querySelector('button').disabled = false; }
  });

  await refresh();
  return { refresh };
}

function commentRow(c, ctx, h) {
  const author = ctx.profiles.get(c.author_id);
  const mine = c.author_id === ctx.me.id;
  const body = el('p', { class: 'comment-body' }, c.body);

  function startEdit() {
    h.editStart();
    const field = el('textarea', { rows: 2, maxlength: 5000, 'aria-label': 'Edit comment', required: true }, c.body);
    const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
    const save = el('button', { class: 'btn primary', type: 'submit' }, 'Save');
    const editForm = el('form', { class: 'comment-edit' }, field, el('div', { class: 'row' }, cancel, save));
    const stop = () => { editForm.replaceWith(body); h.editEnd(); };
    cancel.addEventListener('click', stop);
    editForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = field.value.trim();
      if (!text) return;
      if (text === c.body) return stop();
      save.disabled = true;
      try { await h.save(text); h.editEnd(); h.done(); }
      catch (e) { toast(`Couldn't save: ${e.message}`); save.disabled = false; }
    });
    body.replaceWith(editForm);
    field.focus();
  }

  return el('div', { class: 'comment', 'data-comment-id': c.id, 'data-author-theme': author?.theme || '' },
    el('div', { class: 'comment-head' },
      avatar(author, true),
      el('strong', {}, author?.display_name || 'Someone'),
      el('span', { class: 'muted when' }, new Date(c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      c.edited_at && el('span', { class: 'muted edited', title: `Edited ${new Date(c.edited_at).toLocaleString()}` }, '· edited'),
      mine && el('span', { class: 'comment-actions' },
        el('button', { class: 'link', type: 'button', onclick: startEdit, 'aria-label': 'Edit comment' }, 'Edit'),
        el('button', { class: 'link', type: 'button', onclick: h.remove, 'aria-label': 'Delete comment' }, 'Delete'))),
    body);
}
