import { el } from './dom.js';
import { prepareImage, uploadPhoto, MAX_PER_BATCH } from './photos.js';

const STATUS_TEXT = { queued: 'Ready', preparing: 'Preparing…', uploading: 'Uploading…', done: 'Uploaded ✓', failed: 'Failed' };

// A multi-photo picker with per-photo status, removal and retry.
// `uploadAll()` resolves to { done, failed } and can be called again to retry failures.
export function createPicker({ onChange = () => {} } = {}) {
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const addButton = el('label', { class: 'btn photo-add' }, 'Add photos', input);
  const list = el('ul', { class: 'picks' });
  const summary = el('p', { class: 'muted pick-summary', role: 'status' });
  const element = el('div', { class: 'picker' }, addButton, list, summary);
  let items = [];

  function render() {
    list.replaceChildren(...items.map((it) => el('li', { class: `pick ${it.status}` },
      el('img', { src: it.thumb, alt: '' }),
      el('span', { class: 'pick-text' },
        el('span', { class: 'pick-name' }, it.file.name || 'Photo'),
        el('span', { class: 'muted pick-status' }, it.status === 'failed' ? `Failed: ${it.message}` : STATUS_TEXT[it.status])),
      (it.status === 'queued' || it.status === 'failed') &&
        el('button', { class: 'link', type: 'button', 'aria-label': `Remove ${it.file.name || 'photo'}`, onclick: () => remove(it) }, '✕'))));
    onChange(items.length);
  }

  function remove(it) {
    URL.revokeObjectURL(it.thumb);
    items = items.filter((x) => x !== it);
    render();
  }

  input.addEventListener('change', () => {
    const room = MAX_PER_BATCH - items.length;
    const files = [...input.files].filter((f) => f.type.startsWith('image/')).slice(0, Math.max(room, 0));
    summary.textContent = input.files.length > files.length ? `Up to ${MAX_PER_BATCH} photos at a time.` : '';
    for (const file of files) items.push({ file, thumb: URL.createObjectURL(file), status: 'queued', message: '', prepared: null });
    input.value = '';
    render();
  });

  async function uploadAll(activityId, userId) {
    const todo = items.filter((it) => it.status === 'queued' || it.status === 'failed');
    let n = 0;
    for (const it of todo) {
      n += 1;
      summary.textContent = `Photo ${n} of ${todo.length}…`;
      try {
        it.status = 'preparing'; render();
        it.prepared ??= await prepareImage(it.file);
        it.status = 'uploading'; render();
        await uploadPhoto({ activityId, userId, prepared: it.prepared });
        it.status = 'done';
      } catch (e) {
        it.status = 'failed';
        it.message = e.message || 'upload error';
      }
      render();
    }
    const failed = items.filter((it) => it.status === 'failed').length;
    summary.textContent = failed ? `${failed} photo${failed === 1 ? '' : 's'} didn't upload.` : '';
    return { done: items.filter((it) => it.status === 'done').length, failed };
  }

  function reset() {
    items.forEach((it) => URL.revokeObjectURL(it.thumb));
    items = [];
    summary.textContent = '';
    render();
  }

  return { element, uploadAll, reset, count: () => items.length };
}
