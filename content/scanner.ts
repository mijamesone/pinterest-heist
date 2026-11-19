/**
 * Finds pins (and board section cards) on the page and puts a select circle on each.
 * Pinterest constantly adds and removes pins while you scroll, so this re-scans on DOM
 * changes and keys everything by pin ID.
 */
import type { PageContext } from '../lib/context';
import { bestImgSrc } from '../lib/images';

export type Card = {
  el: HTMLElement;
  kind: 'pin' | 'section';
  id: string;
  media: HTMLElement;
  host: HTMLElement;
  btn: HTMLButtonElement;
  title: string;
  restorePosition: string | null;
};

const PIN_HREF = /\/pin\/([^/?#]+)/;
const BOARD_SUBPAGES = new Set(['more_ideas', 'more-ideas', 'organize', 'organise', 'activity', 'collaborators']);
const CARD_ROOTS = '[data-grid-item],[data-test-id="pin"],[data-test-id="pinWrapper"],[data-test-id="pin-visual-wrapper"]';
const CLOSEUP_SELECTORS = [
  '[data-test-id="pin-closeup-image"] img',
  '[data-test-id="closeup-image"] img',
  '[data-test-id="closeup-image-main"] img',
  '[data-test-id="closeup-body-image-container"] img',
  '[data-test-id="visual-content-container"] img',
  'img[elementtiming*="closeup" i]',
  '[data-test-id="pin-closeup-image"] video',
  '[data-test-id="closeup-video"] video',
];

const PAGE_STYLE = `
[data-heist-card]:hover > .heist-pin-host,
[data-heist-card]:focus-within > .heist-pin-host,
html[data-heist-mode] .heist-pin-host { --heist-show: 1; }
html[data-heist-mode] [data-heist-card], html[data-heist-mode] [data-heist-card] * { cursor: pointer !important; }
`;

const PIN_CSS = `
:host { position: absolute; pointer-events: none; z-index: 40; display: block; }
.ring {
  position: absolute; inset: 0; border-radius: 16px; opacity: 0; transition: opacity .12s ease;
  box-shadow: inset 0 0 0 3px #e60023, inset 0 0 0 5px rgba(14, 13, 14, .85);
  background: rgba(230, 0, 35, .08);
}
:host([data-selected]) .ring { opacity: 1; }
.pick {
  all: unset; box-sizing: border-box; position: absolute; left: 10px; bottom: 10px; width: 30px; height: 30px;
  border-radius: 50%; display: grid; place-items: center; cursor: pointer; pointer-events: auto;
  background: rgba(17, 16, 17, .55); border: 1.5px solid rgba(255, 255, 255, .9);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .35);
  opacity: var(--heist-show, 0); transform: scale(calc(.85 + .15 * var(--heist-show, 0)));
  transition: opacity .14s ease, transform .14s ease, background .14s ease, border-color .14s ease;
}
.pick:hover { background: rgba(17, 16, 17, .85); }
.pick:focus-visible { outline: 2px solid #fff; outline-offset: 2px; opacity: 1; }
.pick svg { width: 14px; height: 14px; stroke: #fff; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transition: opacity .1s; }
:host([data-selected]) .pick { opacity: 1; transform: none; background: #e60023; border-color: #e60023; animation: pop .22s cubic-bezier(.3, 1.6, .5, 1); }
:host([data-selected]) .pick svg { opacity: 1; }
:host([data-kind="section"]) .pick { top: 8px; left: 8px; bottom: auto; }
:host([data-small]) .pick { width: 24px; height: 24px; left: 6px; bottom: 6px; }
@keyframes pop { from { transform: scale(.7); } to { transform: scale(1); } }
@media (hover: none) { .pick { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pick, .ring { transition: none; animation: none; } }
`;

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function commonAncestor(nodes: Element[], within: Element): HTMLElement {
  if (nodes.length === 1) return nodes[0] as HTMLElement;
  let anc: Element | null = nodes[0].parentElement;
  while (anc && anc !== within && !nodes.every((n) => anc!.contains(n))) anc = anc.parentElement;
  return (anc ?? within) as HTMLElement;
}

function largestMedia(root: Element): HTMLElement | null {
  let best: HTMLElement | null = null;
  let area = 0;
  root.querySelectorAll<HTMLElement>('img[src*="pinimg.com"], video').forEach((m) => {
    const r = m.getBoundingClientRect();
    const a = r.width * r.height;
    if (r.width >= 60 && r.height >= 40 && a > area) {
      best = m;
      area = a;
    }
  });
  return best;
}

export function mediaThumb(el: HTMLElement): string {
  if (el instanceof HTMLImageElement) return bestImgSrc(el);
  if (el instanceof HTMLVideoElement) return el.poster || '';
  return '';
}

export class Scanner {
  readonly cards = new Map<HTMLElement, Card>();
  /** Pin IDs in the order they appeared on the page, for Shift-click ranges. */
  readonly order: string[] = [];
  private orderSet = new Set<string>();
  private mo: MutationObserver | null = null;
  private ro: ResizeObserver | null = null;
  private style: HTMLStyleElement | null = null;
  private queued = false;

  constructor(
    private readonly opts: {
      getCtx: () => PageContext;
      isSelected: (c: Card) => boolean;
      onPick: (c: Card, e: MouseEvent) => void;
    },
  ) {}

  start() {
    this.style = document.createElement('style');
    this.style.setAttribute('data-heist-ui', '');
    this.style.textContent = PAGE_STYLE;
    document.head.appendChild(this.style);
    this.ro = new ResizeObserver(() => this.positionAll());
    this.mo = new MutationObserver((records) => {
      const ours = (n: Node) => n instanceof Element && n.hasAttribute('data-heist-ui');
      for (const r of records) {
        if (r.target instanceof Element && r.target.closest('[data-heist-ui]')) continue;
        if ([...r.addedNodes, ...r.removedNodes].every(ours)) continue;
        this.schedule();
        return;
      }
    });
    this.mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', this.schedule);
    this.scan();
  }

  stop() {
    this.mo?.disconnect();
    this.ro?.disconnect();
    window.removeEventListener('resize', this.schedule);
    for (const c of this.cards.values()) this.detach(c);
    this.cards.clear();
    this.style?.remove();
    this.style = null;
    this.order.length = 0;
    this.orderSet.clear();
  }

  schedule = () => {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.scan();
    });
  };

  cardFor(el: Element): Card | undefined {
    const root = el.closest<HTMLElement>('[data-heist-card]');
    return root ? this.cards.get(root) : undefined;
  }

  pinCards(): Card[] {
    return [...this.cards.values()].filter((c) => c.kind === 'pin');
  }

  repaint() {
    for (const c of this.cards.values()) this.paint(c);
  }

  scan() {
    for (const c of [...this.cards.values()]) {
      if (!c.el.isConnected || !c.media.isConnected || !c.el.contains(c.media)) this.detach(c);
    }
    const ctx = this.opts.getCtx();

    // Pins in grids: every link to /pin/<id>/ that wraps an image.
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/pin/"]').forEach((a) => {
      const m = PIN_HREF.exec(a.getAttribute('href') ?? '');
      if (!m || a.closest('[data-heist-ui]')) return;
      const root = a.closest<HTMLElement>(CARD_ROOTS) ?? a;
      const existing = this.cards.get(root);
      if (existing && existing.id === m[1] && existing.media.isConnected) return;
      const media = largestMedia(root);
      if (!media) return;
      this.ensure(root, 'pin', decodeURIComponent(m[1]), media, a.getAttribute('aria-label') ?? (media as HTMLImageElement).alt ?? '');
    });

    // The big image on a pin's own page.
    if (ctx.kind === 'pin') {
      let media: HTMLElement | null = null;
      for (const sel of CLOSEUP_SELECTORS) {
        media = document.querySelector<HTMLElement>(sel);
        if (media) break;
      }
      if (!media) {
        const main = document.querySelector('main, [role="main"]') ?? document.body;
        let area = 0;
        main.querySelectorAll<HTMLImageElement>('img[src*="pinimg.com"]').forEach((img) => {
          if (img.closest('a[href*="/pin/"]')) return;
          const r = img.getBoundingClientRect();
          if (r.width >= 250 && r.width * r.height > area) {
            media = img;
            area = r.width * r.height;
          }
        });
      }
      const root = media?.parentElement;
      if (media && root && !root.closest('a[href*="/pin/"]')) {
        const existing = this.cards.get(root);
        if (!existing || existing.id !== ctx.pinId) {
          this.ensure(root, 'pin', ctx.pinId, media, (media as HTMLImageElement).alt ?? document.title);
        }
      }
    }

    // Section cards at the top of a board.
    if (ctx.kind === 'board') {
      const base = ctx.path.toLowerCase();
      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        if (a.closest('[data-heist-ui]') || this.cards.has(a)) return;
        let path: string;
        try {
          path = new URL(a.getAttribute('href') ?? '', location.origin).pathname;
        } catch {
          return;
        }
        if (!path.toLowerCase().startsWith(base)) return;
        const rest = path.slice(base.length).split('/').filter(Boolean);
        if (rest.length !== 1 || rest[0].startsWith('_') || BOARD_SUBPAGES.has(rest[0])) return;
        const imgs = [...a.querySelectorAll('img')];
        if (!imgs.length) return;
        const cover = commonAncestor(imgs, a);
        const title = (a.getAttribute('aria-label') || a.textContent || rest[0]).replace(/\d+\s*(pins?|Pins?).*$/, '').trim();
        this.ensure(a, 'section', decodeURIComponent(rest[0]), cover, title);
      });
    }

    for (const c of this.cards.values()) this.paint(c);
  }

  private ensure(el: HTMLElement, kind: Card['kind'], id: string, media: HTMLElement, title: string) {
    const old = this.cards.get(el);
    if (old) this.detach(old);

    const host = document.createElement('div');
    host.className = 'heist-pin-host';
    host.setAttribute('data-heist-ui', '');
    host.setAttribute('data-kind', kind);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${PIN_CSS}</style><div class="ring"></div><button class="pick" type="button" aria-pressed="false" aria-label="${kind === 'section' ? 'Select section' : 'Select pin'}" title="Select · Shift+click for a range">${CHECK}</button>`;
    const btn = shadow.querySelector('button') as HTMLButtonElement;

    const card: Card = { el, kind, id, media, host, btn, title: title.trim(), restorePosition: null };
    const stop = (e: Event) => {
      e.stopPropagation();
      if (e.type !== 'pointerenter') e.preventDefault();
    };
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'dblclick', 'dragstart']) btn.addEventListener(t, stop);
    btn.addEventListener('click', (e) => {
      stop(e);
      this.opts.onPick(card, e);
    });

    if (getComputedStyle(el).position === 'static') {
      card.restorePosition = el.style.position;
      el.style.position = 'relative';
    }
    el.setAttribute('data-heist-card', id);
    el.appendChild(host);
    this.cards.set(el, card);
    this.ro?.observe(media);
    this.position(card);
    if (kind === 'pin' && !this.orderSet.has(id)) {
      this.orderSet.add(id);
      this.order.push(id);
    }
  }

  private detach(c: Card) {
    this.ro?.unobserve(c.media);
    c.host.remove();
    if (c.el.getAttribute('data-heist-card') === c.id) c.el.removeAttribute('data-heist-card');
    if (c.restorePosition !== null) c.el.style.position = c.restorePosition;
    this.cards.delete(c.el);
  }

  private positionAll() {
    for (const c of this.cards.values()) this.position(c);
  }

  private position(c: Card) {
    const cr = c.el.getBoundingClientRect();
    const mr = c.media.getBoundingClientRect();
    const left = mr.left - cr.left - c.el.clientLeft;
    const top = mr.top - cr.top - c.el.clientTop;
    const s = c.host.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${mr.width}px`;
    s.height = `${mr.height}px`;
    c.host.toggleAttribute('data-small', mr.width < 140 || mr.height < 100);
  }

  private paint(c: Card) {
    const on = this.opts.isSelected(c);
    if (c.host.hasAttribute('data-selected') !== on) c.host.toggleAttribute('data-selected', on);
    c.btn.setAttribute('aria-pressed', String(on));
  }
}
