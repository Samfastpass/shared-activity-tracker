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
  setTimeout(() => t.remove(), 4500);
}

// Round initials in the author's colour (the colour comes from the enclosing [data-author-theme]).
export function avatar(profile, small = false) {
  const name = (profile?.display_name || '?').trim();
  const initial = name.charAt(0).toUpperCase() + name.slice(1, 2).toLowerCase();   // 'Sa' / 'Sh' (both names start with S)
  return el('span', { class: small ? 'avatar small' : 'avatar', 'aria-hidden': 'true' }, initial);
}
