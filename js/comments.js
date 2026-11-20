import { supabase } from './supabase.js';
import { el, toast, avatar } from './dom.js';

export async function loadComments(activityId) {
  const { data, error } = await supabase
    .from('comments')
    .select('id, author_id, body, created_at')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addComment(activityId, body) {
  const { error } = await supabase.from('comments').insert({ activity_id: activityId, body });
  if (error) throw error;
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

// Renders the comment thread + form into `container`. `onCount` is told the new total.
export async function mountComments(container, activityId, ctx, onCount) {
  const list = el('div', { class: 'comment-list' });
  const input = el('input', { type: 'text', maxlength: 5000, placeholder: 'Add a comment…', 'aria-label': 'Add a comment', required: true });
  const form = el('form', { class: 'comment-form' }, input, el('button', { type: 'submit', class: 'btn' }, 'Send'));
  container.append(list, form);

  async function refresh() {
    try {
      const comments = await loadComments(activityId);
      list.replaceChildren(...comments.map((c) => commentRow(c, ctx, async () => {
        try { await deleteComment(c.id); await refresh(); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
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
}

function commentRow(c, ctx, onDelete) {
  const author = ctx.profiles.get(c.author_id);
  const mine = c.author_id === ctx.me.id;
  return el('div', { class: 'comment', 'data-author-theme': author?.theme || '' },
    el('div', { class: 'comment-head' },
      avatar(author, true),
      el('strong', {}, author?.display_name || 'Someone'),
      el('span', { class: 'muted when' }, new Date(c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      mine && el('button', { class: 'link', type: 'button', onclick: onDelete, 'aria-label': 'Delete comment' }, 'Delete')),
    el('p', { class: 'comment-body' }, c.body));
}
