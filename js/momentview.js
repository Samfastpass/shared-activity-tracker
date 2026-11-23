import { renderCard, fetchOne } from './feed.js';
import { el, toast } from './dom.js';

const $ = (id) => document.getElementById(id);

// Opens a moment's full card (photos, comments, feedback, edit) from the timeline or the map.
export function setupMomentDialog({ ctx, onChanged }) {
  const dialog = $('moment-dialog');
  const body = $('moment-body');
  $('moment-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { body.replaceChildren(); onChanged(); });

  async function open(id) {
    body.replaceChildren(el('div', { class: 'skeleton' }));
    dialog.showModal();
    const render = (a) => body.replaceChildren(renderCard(a, ctx, {
      open: false,
      remove: () => { dialog.close(); },
      refresh: async () => { const fresh = await fetchOne(ctx, id); if (fresh) render(fresh); },
    }).node);
    try {
      const a = await fetchOne(ctx, id);
      if (!a) { dialog.close(); return toast('That moment is no longer there.'); }
      render(a);
    } catch (e) { dialog.close(); toast(`Couldn't open it: ${e.message}`); }
  }
  return { open };
}
