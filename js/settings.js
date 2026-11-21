import { supabase } from './supabase.js';
import { el, avatar } from './dom.js';
import { applyTheme, THEMES } from './theme.js';
import { prepareAvatar, uploadAvatar, removeFiles, signUrls } from './photos.js';

const $ = (id) => document.getElementById(id);

// Settings page: display name, profile picture and theme. The theme previews as you pick it and
// reverts if you leave without saving. `onSaved` runs after a successful save; `onBack` to leave.
export function setupSettings({ ctx, onSaved, onBack }) {
  const form = $('settings-form');
  const slot = $('settings-avatar');
  const status = form.querySelector('.status');
  const saveButton = form.querySelector('button[type=submit]');
  const tiles = $('theme-tiles');
  let pending = null;          // { blob, url } — a newly chosen picture, not saved yet
  let removePicture = false;
  let saving = false;

  tiles.replaceChildren(...THEMES.map((t) => el('label', { class: 'theme-tile', 'data-theme': t.key },
    el('input', { type: 'radio', name: 'theme', value: t.key }),
    el('span', { class: 'swatches', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
    el('strong', {}, t.name),
    el('span', { class: 'muted' }, t.blurb))));

  const draft = () => ({
    display_name: form.elements.display_name.value.trim() || ctx.me.display_name,
    avatarUrl: removePicture ? null : (pending?.url ?? ctx.me.avatarUrl),
  });
  const renderAvatar = () => slot.replaceChildren(avatar(draft(), 'large'));
  const dropPreview = () => { if (pending) URL.revokeObjectURL(pending.url); pending = null; };

  function open() {
    dropPreview(); removePicture = false; status.textContent = '';
    form.elements.display_name.value = ctx.me.display_name;
    form.elements.theme.value = ctx.me.theme;
    $('avatar-remove').hidden = !ctx.me.avatar_path;
    renderAvatar();
  }

  // Leaving without saving: undo the theme preview and forget a picked picture.
  function revert() { applyTheme(ctx.me.theme); dropPreview(); removePicture = false; }

  form.elements.display_name.addEventListener('input', renderAvatar);
  tiles.addEventListener('change', () => applyTheme(form.elements.theme.value));

  $('avatar-input').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    status.textContent = 'Preparing photo…';
    saveButton.disabled = true;               // saving now would silently drop the photo being prepared
    try {
      const blob = await prepareAvatar(file);
      dropPreview();
      pending = { blob, url: URL.createObjectURL(blob) };
      removePicture = false;
      $('avatar-remove').hidden = false;
      status.textContent = '';
      renderAvatar();
    } catch (e) { status.textContent = e.message; }
    finally { if (!saving) saveButton.disabled = false; }
  });

  $('avatar-remove').addEventListener('click', () => {
    dropPreview(); removePicture = true;
    $('avatar-remove').hidden = true;
    renderAvatar();
  });

  $('settings-back').addEventListener('click', () => { revert(); onBack(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saving) return;
    const name = form.elements.display_name.value.trim();
    if (!name) { status.textContent = 'Please enter a name.'; return; }
    const fields = {};
    if (name !== ctx.me.display_name) fields.display_name = name;
    if (form.elements.theme.value !== ctx.me.theme) fields.theme = form.elements.theme.value;
    const oldPath = ctx.me.avatar_path;
    let newPath = null;
    saving = true; saveButton.disabled = true; status.textContent = '';
    try {
      if (pending) { newPath = await uploadAvatar(ctx.me.id, pending.blob); fields.avatar_path = newPath; }
      else if (removePicture && oldPath) fields.avatar_path = null;
      if (Object.keys(fields).length) {
        const { error } = await supabase.from('profiles').update(fields).eq('id', ctx.me.id);
        if (error) { if (newPath) removeFiles([newPath]).catch(() => {}); throw error; }
      }
      if ('avatar_path' in fields && oldPath) removeFiles([oldPath]).catch(() => {});   // best effort
      let avatarUrl = ctx.me.avatarUrl;
      if ('avatar_path' in fields) avatarUrl = newPath ? ((await signUrls([newPath])).get(newPath) ?? null) : null;
      Object.assign(ctx.me, fields, { avatarUrl });      // ctx.me is the same object as in ctx.profiles
      dropPreview(); removePicture = false;
      await onSaved();
    } catch (e) {
      status.textContent = `Couldn't save: ${e.message}`;
    } finally { saving = false; saveButton.disabled = false; }
  });

  return { open, revert };
}
