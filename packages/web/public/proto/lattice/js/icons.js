// Inline icons: 16px grid, stroke-based, decorative (aria-hidden). Paths are static literals.
const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  table: 'M2 3h12v10H2zM2 6.5h12M2 10h12M6 6.5V13',
  chart: 'M2 13h12M4 11V8M8 11V4M12 11V6',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  inspect: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5',
  warn: 'M8 2.5 14 13H2zM8 6.5v3M8 11.2v.01',
  up: 'M8 3v10M4 7l4-4 4 4',
  down: 'M8 13V3M4 9l4 4 4-4',
  flat: 'M3 8h10',
  live: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  replay: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3',
  ui: 'M3 3l4 9 1.4-3.6L12 7z',
  system: 'M3 4h10v7H3zM6 13.5h4',
  offline: 'M2 6a9 9 0 0 1 12 0M4.5 8.8a5.5 5.5 0 0 1 7 0M2 2l12 12',
  check: 'M3 8.5l3.2 3L13 4.5',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  plus: 'M8 3v10M3 8h10',
  sliders: 'M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7M10.5 3v3M5.5 10v3',
};

export const icon = (name, size = 16) => {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon--${name}`);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.flat);
  svg.append(path);
  return svg;
};
