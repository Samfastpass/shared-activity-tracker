import { el, toast } from './dom.js';
import { icon } from './icons.js';

let dialog, img, counter, prevBtn, nextBtn, delBtn, closeBtn, favBtn, favLabel, favNote;
let items = [], index = 0, opts = {};

function build() {
  img = el('img', { class: 'lightbox-img', alt: '' });
  counter = el('span', { class: 'muted' });
  prevBtn = el('button', { class: 'btn lb-nav', type: 'button', 'aria-label': 'Previous photo', onclick: () => show(index - 1) }, '‹');
  nextBtn = el('button', { class: 'btn lb-nav', type: 'button', 'aria-label': 'Next photo', onclick: () => show(index + 1) }, '›');
  delBtn = el('button', { class: 'link danger', type: 'button', onclick: onDelete }, 'Delete photo');
  favLabel = el('span', {});
  favBtn = el('button', { class: 'fav-btn', type: 'button', 'aria-pressed': 'false', onclick: onFavourite }, icon('star', 16), favLabel);
  favNote = el('p', { class: 'fav-note muted' });
  closeBtn = el('button', { class: 'btn', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '✕');
  dialog = el('dialog', { class: 'lightbox', 'aria-label': 'Photo viewer' },
    el('div', { class: 'lb-bar' }, counter, delBtn, closeBtn),
    el('div', { class: 'lb-stage' }, prevBtn, img, nextBtn),
    el('div', { class: 'lb-foot' }, favBtn, favNote));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  let startX = null;
  img.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
  });
  document.body.append(dialog);
}

function show(i) {
  if (i < 0 || i >= items.length) return;
  index = i;
  const item = items[i];
  img.src = item.url;
  img.alt = item.alt || `Photo ${i + 1} of ${items.length}`;
  counter.textContent = `${i + 1} / ${items.length}`;
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i === items.length - 1;
  delBtn.hidden = !opts.canDelete?.(item);
  paintFavourite(item);
}

// Favourites: "make this my favourite" for any photo of the moment, plus who has picked it.
function paintFavourite(item) {
  favBtn.hidden = !opts.favourite;
  favNote.hidden = !opts.favourite;
  if (!opts.favourite) return;
  const mine = opts.favourite.isMine(item);
  favBtn.setAttribute('aria-pressed', String(mine));
  favLabel.textContent = mine ? 'Your favourite (tap to undo)' : 'Make this my favourite';
  const by = opts.favourite.by(item);
  favNote.textContent = by.length ? `Favourite of ${by.join(' and ')}` : '';
}

async function onFavourite() {
  const item = items[index];
  favBtn.disabled = true;
  try { await opts.favourite.toggle(item); paintFavourite(item); }
  catch (e) { toast(`Couldn't update your favourite: ${e.message}`); }
  finally { favBtn.disabled = false; }
}

async function onDelete() {
  if (!confirm('Delete this photo?')) return;
  try {
    await opts.onDelete(items[index]);
    dialog.close();
  } catch (e) {
    toast(`Couldn't delete: ${e.message}`);
  }
}

// items: [{ url, alt, ... }]. opts: { canDelete(item), onDelete(item), favourite?: { isMine(item), by(item), toggle(item) } }.
export function openLightbox(list, startIndex, options = {}) {
  if (!dialog) build();
  items = list; opts = options;
  show(startIndex);
  dialog.showModal();
  closeBtn.focus();                       // never land on Delete
}
