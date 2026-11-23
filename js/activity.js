import { supabase } from './supabase.js';
import { toast } from './dom.js';
import { createPicker } from './picker.js';
import { removeFiles } from './photos.js';
import { createPlacePicker } from './placepicker.js';

const $ = (id) => document.getElementById(id);

// The id is generated client-side so photos can be uploaded under {user}/{activity}/ right away.
// `extra` (kind, who_came, place_name, lat, lng) is only sent once the database has those columns.
const fields = ({ title, body, happened_at }, extra) => ({ title, body: body || null, happened_at, ...(extra || {}) });

export async function createActivity({ id, ...text }, extra) {
  const { error } = await supabase.from('activities').insert({ id, ...fields(text, extra) });
  if (error) throw error;
}

export async function updateActivity(id, text, extra) {
  const { error } = await supabase.from('activities').update(fields(text, extra)).eq('id', id);
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

// Wires the composer dialog for two modes: a new activity, or editing one of your own (text and/or
// more photos). Returns { edit(activity) }. `onChanged` runs when the dialog closes after
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
  const places = createPlacePicker();
  $('place-slot').append(places.element);
  const whoLabel = $('who-label');
  const syncKind = () => { whoLabel.hidden = form.elements.kind.value !== 'group'; };
  form.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', syncKind));

  let mode = 'new', activityId = null, dirty = false, saved = false;
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  function open(nextMode, activity) {
    mode = nextMode; activityId = activity?.id ?? null; dirty = false; saved = false;
    form.reset(); picker.reset(); status.textContent = '';
    fields.disabled = false; fields.hidden = false;
    heading.firstChild.textContent = mode === 'edit' ? 'Edit this moment ' : 'Share something new ';
    submit.textContent = mode === 'edit' ? 'Save' : 'Share';
    cancel.textContent = 'Cancel';
    form.querySelectorAll('.v2').forEach((n) => { n.dataset.off = ctx.features?.moments2 === false ? '1' : ''; });   // database not updated yet
    form.elements.kind.value = activity?.kind ?? 'one_to_one';
    form.elements.who_came.value = activity?.who_came ?? '';
    places.set(activity ?? {});
    syncKind();
    form.elements.title.value = activity?.title ?? '';
    form.elements.body.value = activity?.body ?? '';
    date.value = activity?.happened_at ?? today();
    dialog.showModal();
    form.elements.title.focus();
  }

  openButton.addEventListener('click', () => open('new'));
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { picker.reset(); if (dirty) { dirty = false; onChanged(); } });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    submit.disabled = true; cancel.disabled = true;
    try {
      if (!saved) {                                        // first submit: create or update the text
        const text = { title: form.elements.title.value.trim(), body: form.elements.body.value.trim(), happened_at: date.value };
        const kind = form.elements.kind.value;
        const extra = ctx.features?.moments2 === false ? null : {
          kind, who_came: kind === 'group' ? (form.elements.who_came.value.trim() || null) : null, ...places.get(),
        };
        if (mode === 'edit') await updateActivity(activityId, text, extra);
        else { activityId = crypto.randomUUID(); await createActivity({ id: activityId, ...text }, extra); }
        saved = true; dirty = true;
        fields.disabled = true;                            // saved; only photo retries from here
      }
      const { failed } = await picker.uploadAll(activityId, ctx.me.id);
      if (failed) {
        dirty = true;
        status.textContent = 'Some photos didn\'t upload. Retry, or close and add them later from the post.';
        submit.textContent = 'Retry'; cancel.textContent = 'Close';
        return;
      }
      dialog.close();
    } catch (e) {
      toast(`Couldn't save: ${e.message}`);
    } finally { submit.disabled = false; cancel.disabled = false; }
  });

  return { edit: (activity) => open('edit', activity) };
}
