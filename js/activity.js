import { supabase } from './supabase.js';
import { el, toast } from './dom.js';

export async function createActivity({ title, body, happened_at }) {
  const { error } = await supabase.from('activities').insert({ title, body: body || null, happened_at });
  if (error) throw error;
}

export async function deleteActivity(id) {
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) throw error;
}

// Wires the "new activity" dialog. `onCreated` is called after a successful save.
export function setupComposer({ dialog, openButton, onCreated }) {
  const form = dialog.querySelector('form');
  const date = form.elements.happened_at;
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  openButton.addEventListener('click', () => { form.reset(); date.value = today(); dialog.showModal(); form.elements.title.focus(); });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      await createActivity({ title: form.elements.title.value.trim(), body: form.elements.body.value.trim(), happened_at: date.value });
      dialog.close();
      await onCreated();
    } catch (e) {
      toast(`Couldn't save: ${e.message}`);
    } finally { submit.disabled = false; }
  });
}
