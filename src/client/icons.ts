// « Les finitions » (iteration 46): every icon of the menus and of the HUD is drawn here, in SVG, instead of emoji
// (emoji look different on every system, and some phones draw them as empty boxes). Drawn on a 24 × 24 grid with a
// round 2-pixel stroke in currentColor, so they take the colour of the text around them, like the HUD's own icons.

const P: Record<string, string> = {
  // the corner frame and the bar buttons
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  mute: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path d="M3 3l18 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  // the tabs of the manual
  pad: '<path d="M7 8h10a5 5 0 0 1 4.6 7l-.9 2.2a2 2 0 0 1-3.3.6L15 15H9l-2.4 2.8a2 2 0 0 1-3.3-.6L2.4 15A5 5 0 0 1 7 8z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".6" fill="currentColor"/><circle cx="18" cy="13.5" r=".6" fill="currentColor"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  crate: '<rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="M3 11h18M12 7v13M12 7c-2-4-6-4-6-1.5S9 7 12 7c3 0 6-.5 6-1.5S14 3 12 7"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5zM4 20a2 2 0 0 0 2 2h13v-4"/><path d="M9 8h6"/>',
  bricks: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  // the feedback window
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  clip: '<path d="M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
  // the modes
  tank: '<rect x="3" y="13" width="18" height="6" rx="3"/><path d="M6 13v-2.5h9V13M12 10.5V8h9"/><circle cx="7" cy="16" r=".8" fill="currentColor"/><circle cx="12" cy="16" r=".8" fill="currentColor"/><circle cx="17" cy="16" r=".8" fill="currentColor"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17.5h2"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>',
  swords: '<path d="M4 4l10 10M14 14l-2 3M14 14l3-2M17 17l3 3M20 4L10 14M10 14l2 3M10 14l-3-2M7 17l-3 3"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  mask: '<path d="M3 8c3-2 15-2 18 0 0 5-2 9-5 9-2 0-2.5-2-4-2s-2 2-4 2c-3 0-5-4-5-9z"/><path d="M7 11c1-1 2.5-1 3.5 0M13.5 11c1-1 2.5-1 3.5 0"/>',
  hammer: '<path d="M14 6l4 4M12.5 7.5l-8.6 8.6a2 2 0 0 0 2.9 2.9l8.6-8.6"/><path d="M11 6l3-3 3 1 4 4-2 2-2-1-2 2"/>',
  // the weathers
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
  fog: '<path d="M4 8h16M2 12h14M6 16h16M4 20h10"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15z"/><path d="M5 19l9-9"/>',
  // the mole's role
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  // the skill branches
  burst: '<path d="M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z"/>',
  bomb: '<circle cx="10.5" cy="14" r="7"/><path d="M15.5 9l2-2M17 5.5l1-1M19 7.5l1.5-.5M18.5 3.5l.3-1.3"/>',
  // the bosses
  pick: '<path d="M4 9c5-6 11-6 16 0M12 5v16"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 15c0-3 2.5-5 6-5 0 3-2.5 5-6 5z"/>',
  // the quick-chat lines (in the order of EMOTES)
  bravo: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  merci: '<path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z"/>',
  oups: '<circle cx="12" cy="12" r="9"/><path d="M8 9.5h.01M16 9.5h.01M9 16c2-1.4 4-1.4 6 0"/><path d="M18 3c1 1.5 1.5 2.5 0 3.5"/>',
  ici: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  attention: '<path d="M12 3L2 20h20z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  hehe: '<circle cx="12" cy="12" r="9"/><path d="M7.5 10c.8-1 2.2-1 3 0M13.5 10c.8-1 2.2-1 3 0M7.5 14c2.5 3 6.5 3 9 0z"/>',
};

export type IconName = keyof typeof P & string;
export const ICON_NAMES = Object.keys(P);

/** The quick-chat lines' icons, in the order of EMOTES. */
export const EMOTE_ICONS = ['bravo', 'merci', 'oups', 'ici', 'attention', 'hehe'];

const svg = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ''}</svg>`;

/** An inline icon, to put in innerHTML (it takes the colour and the size of the text: 1em). */
export function icon(name: string, cls = '') {
  return svg(name).replace('<svg ', `<svg class="ico${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false" `);
}

/**
 * Fills every `[data-icon]` element of the page with its icon, and defines a CSS variable `--ico-<name>` for each icon
 * (a data URI, for the `::before` of the stylesheet, which draws it with `mask` in the colour of the text).
 */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone === el.dataset.icon) return;
    el.innerHTML = icon(el.dataset.icon!);
    el.dataset.iconDone = el.dataset.icon;
  });
  if (root === document && !document.getElementById('ico-vars')) {
    const st = document.createElement('style');
    st.id = 'ico-vars';
    st.textContent = `:root{${ICON_NAMES.map((n) => `--ico-${n}:url("data:image/svg+xml,${encodeURIComponent(svg(n).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, '#000'))}")`).join(';')}}`;
    document.head.appendChild(st);
  }
}
