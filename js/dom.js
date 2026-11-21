// Tiny DOM helper. Text is always added as text nodes (never innerHTML),
// so user-written content can't inject markup.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);          // avoid timezone shifts for plain dates
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function toast(message) {
  const host = document.getElementById('toasts');
  const t = el('div', { class: 'toast', role: 'status' }, message);
  host.append(t);
  while (host.children.length > 3) host.firstElementChild.remove();   // never pile up
  setTimeout(() => t.remove(), 4500);
}

// Round avatar in the author's colour: their picture if they have one, else initials.
// size: false/'' = normal, true/'small', 'large'.
export function avatar(profile, size = '') {
  const cls = `avatar${size === true || size === 'small' ? ' small' : size === 'large' ? ' large' : ''}`;
  const name = (profile?.display_name || '?').trim();
  const initials = el('span', { class: cls, 'aria-hidden': 'true' }, name.charAt(0).toUpperCase() + name.slice(1, 2).toLowerCase());   // 'Sa' / 'Sh'
  if (!profile?.avatarUrl) return initials;
  const img = el('img', { class: `${cls} has-img`, src: profile.avatarUrl, alt: '', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(initials));
  return img;
}
