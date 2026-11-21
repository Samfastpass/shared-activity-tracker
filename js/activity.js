import { supabase } from './supabase.js';
import { toast } from './dom.js';
import { createPicker } from './picker.js';
import { removeFiles } from './photos.js';

// The id is generated client-side so photos can be uploaded under {user}/{activity}/ right away.
export async function createActivity({ id, title, body, happened_at }) {
  const { error } = await supabase.from('activities').insert({ id, title, body: body || null, happened_at });
  if (error) throw error;
}

// Deleting the row cascades to photos + comments rows; then the storage objects are removed.
export async function deleteActivity(activity) {
  const { error } = await supabase.from('activities').delete().eq('id', activity.id);
  if (error) throw error;
  try {
    await removeFiles((activity.photos || []).map((p) => p.storage_path));
  } catch {
    toast("Deleted, but some photo files couldn't be removed.");
  }
}

// Wires the composer dialog for two modes: a new activity (with photos), or "add photos" to an
// existing one. Returns { addPhotos(activity) }. `onChanged` runs when the dialog closes after
// anything was saved.
export function setupComposer({ dialog, openButton, onChanged, ctx }) {
  const form = dialog.querySelector('form');
  const fields = form.querySelector('.fields');
  const heading = form.querySelector('h2');
  const status = form.querySelector('.status');
  const submit = form.querySelector('button[type=submit]');
  const cancel = dialog.querySelector('[data-cancel]');
  const date = form.elements.happened_at;
  const picker = createPicker();
  form.querySelector('.row').before(picker.element);

  let mode = 'new', activityId = null, dirty = false;
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  function open(nextMode, activity) {
    mode = nextMode; activityId = activity?.id ?? null; dirty = false;
    form.reset(); picker.reset(); status.textContent = '';
    fields.disabled = mode === 'add'; fields.hidden = mode === 'add';
    heading.firstChild.textContent = mode === 'add' ? 'Add photos ' : 'Share something new ';
    submit.textContent = mode === 'add' ? 'Upload' : 'Share';
    cancel.textContent = 'Cancel';
    date.value = today();
    dialog.showModal();
    (mode === 'add' ? picker.element.querySelector('label') : form.elements.title).focus();
  }

  openButton.addEventListener('click', () => open('new'));
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { picker.reset(); if (dirty) { dirty = false; onChanged(); } });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (mode === 'add' && picker.count() === 0) { status.textContent = 'Choose at least one photo.'; return; }
    submit.disabled = true; cancel.disabled = true;
    try {
      if (!activityId) {                                   // first submit of a new activity
        const id = crypto.randomUUID();
        await createActivity({ id, title: form.elements.title.value.trim(), body: form.elements.body.value.trim(), happened_at: date.value });
        activityId = id; dirty = true;
        fields.disabled = true;                            // saved; only photo retries from here
      }
      const { failed } = await picker.uploadAll(activityId, ctx.me.id);
      if (failed) {
        dirty = true;
        status.textContent = 'Some photos didn\'t upload. Retry, or close and add them later from the post.';
        submit.textContent = 'Retry'; cancel.textContent = 'Close';
        return;
      }
      if (mode === 'add') dirty = true;
      dialog.close();
    } catch (e) {
      toast(`Couldn't save: ${e.message}`);
    } finally { submit.disabled = false; cancel.disabled = false; }
  });

  return { addPhotos: (activity) => open('add', activity) };
}
