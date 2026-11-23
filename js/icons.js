// Small inline SVG icons (stroke style, inherit the text colour). Built with DOM calls, never innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  comment: ['M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12z'],
  pin: ['M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z', 'M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M21 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  two: ['M9.5 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M14.5 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z'],
  star: ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1L12 2z'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  locate: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3M12 19v3M2 12h3M19 12h3'],
  close: ['M18 6L6 18M6 6l12 12'],
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'icon' })) svg.setAttribute(k, v);
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
