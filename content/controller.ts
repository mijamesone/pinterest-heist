/**
 * Everything the extension does on the page: turning on and off, selection input
 * (circles, selection mode, Shift ranges, Ctrl+drag, shortcuts) and running downloads.
 */
import { browser } from 'wxt/browser';
import { humanizeSlug, parseContext, sameContext, supportsSelectAll, type PageContext } from '../lib/context';
import { candidatesFromThumb } from '../lib/images';
import type { ContentEvent, ContentRequest, DownloadOneResult } from '../lib/messages';
import { metadataToCSV, metadataToJSON } from '../lib/metadata';
import { displayPath, isoDate, joinPath } from '../lib/naming';
import * as api from '../lib/pinterest';
import { parsePin } from '../lib/pins';
import { buildPlan, rootFor, type Plan, type PlanOptions } from '../lib/plan';
import { pool } from '../lib/pool';
import { loadSettings, saveSettings } from '../lib/settings';
import { collectEntries, UNSORTED } from './collect';
import { mediaThumb, Scanner, type Card } from './scanner';
import { Selection, type SectionRef, type SeenPin } from './selection';
import { createStore, toastApi, type SheetState, type Store, type Toasts } from './store';

const VERSION = browser.runtime.getManifest().version;

function send<T = any>(msg: ContentRequest): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

function isTyping(e: Event): boolean {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

function inOurUi(e: Event): boolean {
  return e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-heist-ui'));
}

export class Controller {
  readonly store: Store;
  readonly toasts: Toasts;
  readonly sel = new Selection();
  private scanner: Scanner;
  private active = false;
  private escArmed = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;
  private zipJobs = new Map<string, (ev: ContentEvent) => void>();
  private boardNames = new Map<string, string>();

  constructor(private readonly hooks: { mount: () => void; unmount: () => void }) {
    this.store = createStore({
      mode: false,
      countText: '0',
      count: 0,
      canCopy: false,
      ctx: parseContext(location.pathname, location.search),
      sheet: null,
      shortcuts: false,
      tips: false,
      toasts: [],
      marquee: null,
      limitPrompt: null,
      busy: false,
    });
    this.toasts = toastApi(this.store);
    this.scanner = new Scanner({
      getCtx: () => this.store.get().ctx,
      isSelected: (c) => (c.kind === 'pin' ? this.sel.isPinSelected(c.id) : this.sel.isSectionSelected(this.sectionKey(c.id), c.id)),
      onPick: (c, e) => this.pick(c, e.shiftKey),
    });
    this.sel.onChange(() => this.syncCount());
  }

  // ------------------------------------------------------------ activation

  isActive() {
    return this.active;
  }

  async activate() {
    if (this.active) return;
    this.active = true;
    this.hooks.mount();
    this.scanner.start();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('dragstart', this.onDragStart, true);
    const settings = await loadSettings();
    if (!settings.tipsSeen) this.store.set({ tips: true });
    this.syncCount();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('dragstart', this.onDragStart, true);
    this.setMode(false);
    this.scanner.stop();
    this.sel.clear();
    this.store.set({ sheet: null, shortcuts: false, tips: false, marquee: null, limitPrompt: null });
    this.hooks.unmount();
  }

  /** The dock's close button: turn off and update the toolbar badge. */
  turnOff() {
    void send({ type: 'heist:set-active', active: false });
    this.deactivate();
  }

  onLocationChange() {
    const ctx = parseContext(location.pathname, location.search);
    if (sameContext(ctx, this.store.get().ctx)) return;
    this.store.set({ ctx, limitPrompt: null });
    if (this.sel.all) this.sel.dropAll();
    this.scanner.schedule();
  }

  onEvent(ev: ContentEvent) {
    if (ev.type === 'heist:zip-progress' || ev.type === 'heist:zip-done') this.zipJobs.get(ev.jobId)?.(ev);
  }

  // ------------------------------------------------------------ selection

  private sectionKey(slug: string) {
    const ctx = this.store.get().ctx;
    return ctx.kind === 'board' ? `${ctx.path}${slug}`.toLowerCase() : slug;
  }

  private seenFromCard(c: Card): SeenPin {
    const ctx = this.store.get().ctx;
    const board =
      ctx.kind === 'board' ? this.boardName(ctx.path, ctx.slug) : ctx.kind === 'section' ? this.boardName(ctx.boardPath, ctx.boardSlug) : undefined;
    return {
      id: c.id,
      thumb: mediaThumb(c.media),
      title: c.title,
      board,
      section: ctx.kind === 'section' ? humanizeSlug(ctx.sectionSlug) : undefined,
    };
  }

  private boardName(path: string, slug: string): string {
    return this.boardNames.get(path.toLowerCase()) ?? humanizeSlug(slug);
  }

  private pick(c: Card, range: boolean) {
    this.store.set({ tips: false });
    if (c.kind === 'section') {
      const ctx = this.store.get().ctx;
      if (ctx.kind !== 'board') return;
      const ref: SectionRef = {
        key: this.sectionKey(c.id),
        slug: c.id,
        title: c.title || humanizeSlug(c.id),
        username: ctx.username,
        boardSlug: ctx.slug,
        boardPath: ctx.path,
      };
      this.sel.toggleSection(ref);
      if (this.sel.sections.has(ref.key)) void this.fillSectionCount(ref);
      return;
    }
    const seen = this.seenFromCard(c);
    if (range && this.sel.last && this.sel.last !== c.id) {
      const order = this.scanner.order;
      const a = order.indexOf(this.sel.last);
      const b = order.indexOf(c.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const byId = new Map(this.scanner.pinCards().map((x) => [x.id, x]));
        for (let i = lo; i <= hi; i++) {
          const id = order[i];
          const card = byId.get(id);
          this.sel.setPin(card ? this.seenFromCard(card) : { id, thumb: '', title: '' }, true);
        }
        this.sel.last = c.id;
        this.sel.emit();
        return;
      }
    }
    this.sel.togglePin(seen);
  }

  private async fillSectionCount(ref: SectionRef) {
    try {
      const board = await api.getBoard(ref.username, ref.boardSlug, ref.boardPath);
      this.boardNames.set(ref.boardPath.toLowerCase(), board.name);
      const sections = await api.getSections(board.id, ref.boardPath);
      const s = sections.find((x) => x.slug.toLowerCase() === ref.slug.toLowerCase());
      if (s) {
        ref.id = s.id;
        ref.title = s.title;
        ref.count = s.pinCount;
        this.sel.emit();
      }
    } catch {
      /* count stays unknown ("+") */
    }
  }

  private syncCount() {
    const { n, text } = this.sel.count();
    this.store.set({ count: n, countText: text, canCopy: !!this.sel.singlePin() });
    this.scanner.repaint();
  }

  setMode(on: boolean) {
    this.store.set({ mode: on });
    document.documentElement.toggleAttribute('data-heist-mode', on && this.active);
  }

  toggleMode() {
    this.setMode(!this.store.get().mode);
  }

  clear() {
    this.sel.clear();
  }

  async selectAll() {
    const ctx = this.store.get().ctx;
    const rendered = this.scanner.pinCards().map((c) => c.id);
    if (ctx.kind === 'search') {
      this.store.set({ limitPrompt: 200 });
      return;
    }
    if (!supportsSelectAll(ctx)) {
      for (const c of this.scanner.pinCards()) this.sel.setPin(this.seenFromCard(c), true);
      this.sel.emit();
      const t = this.toasts.add({
        tone: 'info',
        title: `Selected the ${rendered.length} pins loaded on this page`,
        detail: 'This page has no end, so only loaded pins are included. Scroll for more and press Ctrl+A again.',
      });
      this.toasts.later(t, 6000);
      return;
    }
    this.sel.setAll({ ctx }, rendered);
    try {
      let count: number | undefined;
      if (ctx.kind === 'board') {
        const b = await api.getBoard(ctx.username, ctx.slug, ctx.path);
        this.boardNames.set(ctx.path.toLowerCase(), b.name);
        count = b.pinCount;
      } else if (ctx.kind === 'section') {
        const b = await api.getBoard(ctx.username, ctx.boardSlug, ctx.boardPath);
        this.boardNames.set(ctx.boardPath.toLowerCase(), b.name);
        const s = (await api.getSections(b.id, ctx.boardPath)).find((x) => x.slug.toLowerCase() === ctx.sectionSlug.toLowerCase());
        count = s?.pinCount;
      } else if (ctx.kind === 'profile') {
        count = await api.getUserPinCount(ctx.username);
      }
      if (this.sel.all && sameContext(this.sel.all.ctx, ctx)) {
        this.sel.all.count = count;
        this.sel.emit();
      }
    } catch {
      /* count shows "All" until the download collects the real list */
    }
  }

  confirmLimit(limit: number) {
    const ctx = this.store.get().ctx;
    const n = Math.max(1, Math.min(5000, Math.floor(limit) || 200));
    this.store.set({ limitPrompt: null });
    this.sel.setAll({ ctx, limit: n }, this.scanner.pinCards().map((c) => c.id));
  }

  cancelLimit() {
    this.store.set({ limitPrompt: null });
  }

  dismissTips() {
    this.store.set({ tips: false });
    void saveSettings({ tipsSeen: true });
  }

  // ------------------------------------------------------------ input handlers

  private onKey = (e: KeyboardEvent) => {
    // Shortcuts keep working after clicking a dock button; only typing fields are skipped.
    if (!this.active || isTyping(e)) return;
    const s = this.store.get();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      this.store.set({ shortcuts: !s.shortcuts, sheet: null });
      return;
    }
    if (e.key === 'Escape') {
      if (s.shortcuts || s.sheet || s.limitPrompt != null) {
        this.store.set({ shortcuts: false, sheet: null, limitPrompt: null });
      } else if (s.count > 0) {
        this.clear();
        this.escArmed = Date.now();
      } else if (s.mode && Date.now() - this.escArmed < 1500) {
        this.setMode(false);
      } else if (s.mode) {
        this.escArmed = Date.now();
      } else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (s.shortcuts || s.sheet) return;
    if ((e.key === 's' || e.key === 'S') && plain && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMode();
      return;
    }
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      void this.selectAll();
    }
  };

  private onClick = (e: MouseEvent) => {
    if (!this.active || inOurUi(e)) return;
    if (this.suppressClick) {
      this.suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    const card = target?.closest ? this.scanner.cardFor(target) : undefined;
    if (!card) return;
    const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (this.store.get().mode || ctrlShift) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.pick(card, e.shiftKey);
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.active || e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.shiftKey || inOurUi(e)) return;
    this.drag = { x: e.clientX, y: e.clientY, moved: false };
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    e.preventDefault();
    const x = Math.min(d.x, e.clientX);
    const y = Math.min(d.y, e.clientY);
    this.store.set({ marquee: { x, y, w: Math.abs(e.clientX - d.x), h: Math.abs(e.clientY - d.y) } });
  };

  private onPointerUp = () => {
    const d = this.drag;
    this.drag = null;
    if (!d?.moved) return;
    const m = this.store.get().marquee;
    this.store.set({ marquee: null });
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 400);
    if (!m) return;
    let picked = 0;
    for (const c of this.scanner.pinCards()) {
      const r = c.host.getBoundingClientRect();
      if (r.right >= m.x && r.left <= m.x + m.w && r.bottom >= m.y && r.top <= m.y + m.h) {
        this.sel.setPin(this.seenFromCard(c), true);
        picked++;
      }
    }
    if (picked) this.sel.emit();
  };

  private onDragStart = (e: DragEvent) => {
    // Holding Ctrl means box-select, so stop the browser dragging the link or image.
    if (this.drag) e.preventDefault();
  };

  // ------------------------------------------------------------ download sheet

  private async suggestName(): Promise<{ name: string; board: string; section: string; folders: string[] }> {
    const ctx = this.store.get().ctx;
    const scope = this.sel.all?.ctx ?? ctx;
    const date = isoDate();
    const boardOf = async (username: string, slug: string, path: string) => {
      try {
        const b = await api.getBoard(username, slug, path);
        this.boardNames.set(path.toLowerCase(), b.name);
        return b.name;
      } catch {
        return this.boardName(path, slug);
      }
    };
    const sections = [...this.sel.sections.values()];
    if (!this.sel.all && sections.length && !this.sel.pins.size) {
      const first = sections[0];
      const board = await boardOf(first.username, first.boardSlug, first.boardPath);
      const name = sections.length === 1 ? `${board} – ${first.title}` : board;
      return { name, board, section: first.title, folders: sections.map((s) => s.title) };
    }
    switch (scope.kind) {
      case 'board': {
        const board = await boardOf(scope.username, scope.slug, scope.path);
        return { name: board, board, section: '', folders: [] };
      }
      case 'section': {
        const board = await boardOf(scope.username, scope.boardSlug, scope.boardPath);
        const section = humanizeSlug(scope.sectionSlug);
        return { name: `${board} – ${section}`, board, section, folders: [] };
      }
      case 'search':
        return { name: `Search – ${scope.query} – ${date}`, board: '', section: '', folders: [] };
      case 'profile':
        return { name: `${scope.username} – ${scope.tab === 'created' ? 'created' : 'pins'}`, board: '', section: '', folders: [] };
      case 'pin': {
        const first = [...this.sel.pins.values()][0];
        return { name: this.sel.pins.size === 1 && first?.title ? first.title : `Pinterest – ${date}`, board: '', section: '', folders: [] };
      }
      default:
        return { name: `Pinterest – ${date}`, board: '', section: '', folders: [] };
    }
  }

  async openSheet() {
    if (this.store.get().count === 0) return;
    const settings = await loadSettings();
    const s = await this.suggestName();
    const firstPin = [...this.sel.pins.values()][0];
    const ctx = this.store.get().ctx;
    const sheet: SheetState = {
      name: s.name,
      format: settings.format,
      pattern: settings.pattern,
      group: settings.group,
      includeMeta: settings.includeMeta,
      skipDupes: settings.skipDupes,
      sections: null,
      sectionsLoading: false,
      countText: this.store.get().countText,
      sample: {
        board: s.board || firstPin?.board || 'Board',
        section: s.section,
        title: firstPin?.title || 'Pin title',
        pinner: 'pinner',
        pinId: firstPin?.id ?? '123456789',
        query: ctx.kind === 'search' ? ctx.query : '',
        folders: s.folders,
      },
    };
    this.store.set({ sheet, tips: false, shortcuts: false });

    const all = this.sel.all;
    if (all?.ctx.kind === 'board') {
      const bctx = all.ctx;
      this.patchSheet({ sectionsLoading: true });
      try {
        const board = await api.getBoard(bctx.username, bctx.slug, bctx.path);
        const list = board.sectionCount === 0 ? [] : await api.getSections(board.id, bctx.path);
        if (list.length) {
          this.patchSheet({
            sections: [
              { key: UNSORTED, title: 'Pins not in a section', checked: true },
              ...list.map((x) => ({ key: x.id, title: x.title, count: x.pinCount, checked: !this.sel.excludedSections.has(x.slug) })),
            ],
            sample: { ...sheet.sample, folders: list.slice(0, 3).map((x) => x.title) },
          });
        }
      } catch {
        /* no section list: the whole board is downloaded */
      } finally {
        this.patchSheet({ sectionsLoading: false });
      }
    }
  }

  patchSheet(patch: Partial<SheetState>) {
    const cur = this.store.get().sheet;
    if (cur) this.store.set({ sheet: { ...cur, ...patch } });
  }

  closeSheet() {
    this.store.set({ sheet: null });
  }

  async startFromSheet() {
    const sheet = this.store.get().sheet;
    if (!sheet) return;
    await saveSettings({
      format: sheet.format,
      pattern: sheet.pattern,
      group: sheet.group,
      includeMeta: sheet.includeMeta,
      skipDupes: sheet.skipDupes,
    });
    const include = sheet.sections ? new Set(sheet.sections.filter((s) => s.checked).map((s) => s.key)) : null;
    this.store.set({ sheet: null });
    await this.run({
      purpose: 'download',
      plan: {
        name: sheet.name,
        format: sheet.format,
        pattern: sheet.pattern || '{index}',
        group: sheet.group,
        includeMeta: sheet.includeMeta,
        skipDupes: sheet.skipDupes,
      },
      include,
    });
  }

  async sendToPureRef() {
    if (this.store.get().count === 0) return;
    const settings = await loadSettings();
    const s = await this.suggestName();
    await this.run({
      purpose: 'pureref',
      plan: {
        name: s.name,
        format: 'files',
        pattern: settings.pattern,
        group: true,
        includeMeta: false,
        skipDupes: true,
        flat: true,
        baseDir: 'Pinterest Heist/_PureRef',
      },
      include: null,
    });
  }

  // ------------------------------------------------------------ running a job

  private async run(job: { purpose: 'download' | 'pureref'; plan: Omit<PlanOptions, 'origin' | 'version' | 'page' | 'query'>; include: Set<string> | null }) {
    const ac = new AbortController();
    const ctx = this.store.get().ctx;
    const isPure = job.purpose === 'pureref';
    const { rootDir, zipPath } = rootFor(job.plan);
    const purePath = displayPath(rootDir);
    const pureSteps = (stage: number) => [
      { label: 'Saving full-size images', detail: purePath, state: stage > 0 ? 'done' : 'doing' },
      { label: 'Opening the folder in Explorer', state: stage > 1 ? 'done' : stage === 1 ? 'doing' : 'todo' },
      { label: 'Drag the folder onto your PureRef canvas', detail: 'One-click sending comes with the Windows helper (phase 4).', state: stage > 1 ? 'you' : 'todo' },
    ] as const;

    const id = this.toasts.add({
      tone: 'progress',
      title: isPure ? 'Send to PureRef' : 'Collecting pins…',
      detail: isPure ? undefined : 'Asking Pinterest for the full list',
      steps: isPure ? pureSteps(0).map((x) => ({ ...x })) : undefined,
      onCancel: () => ac.abort(),
    });
    this.store.set({ busy: true });

    try {
      const entries = await collectEntries(this.sel, {
        includeSections: job.include,
        signal: ac.signal,
        onProgress: (n) => {
          if (!isPure) this.toasts.update(id, { detail: `${n} pins found` });
        },
      });
      if (!entries.length) throw new Error('Nothing to download. Pinterest returned no pins for this selection.');

      const plan = buildPlan(entries, {
        ...job.plan,
        origin: location.origin,
        version: VERSION,
        page: location.href,
        query: ctx.kind === 'search' ? ctx.query : undefined,
      });
      if (!plan.files.length) throw new Error('None of the selected pins had an image to download.');

      if (job.plan.format === 'zip' && !isPure) {
        await this.runZip(plan, id, zipPath, ac, job.plan.includeMeta);
        return;
      }

      // Files mode (and the PureRef handoff).
      let done = 0;
      let lastId: number | null = null;
      const failed: { pinId: string; file: string; reason: string }[] = [];
      if (!isPure) this.toasts.update(id, { title: 'Downloading', detail: undefined, path: displayPath(plan.rootDir), done: 0, total: plan.files.length });
      await pool(
        plan.files,
        3,
        async (f) => {
          const res = await send<DownloadOneResult>({ type: 'heist:download-one', item: { candidates: f.candidates, path: f.fullPath } });
          if (res?.ok) {
            lastId = res.downloadId;
            f.meta.file = res.path.slice(plan.rootDir.length + 1);
          } else failed.push({ pinId: f.pinId, file: f.relPath, reason: res?.error ?? 'Unknown error' });
          done++;
          if (!isPure) this.toasts.update(id, { done });
        },
        ac.signal,
      );
      if (ac.signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      if (job.plan.includeMeta && !isPure) await this.writeMetadata(plan, failed);

      const ok = plan.files.length - failed.length;
      const openFolder = () => (lastId != null ? void send({ type: 'heist:show', downloadId: lastId }) : void send({ type: 'heist:show-default-folder' }));

      if (isPure) {
        this.toasts.update(id, { steps: pureSteps(1).map((x) => ({ ...x })), onCancel: undefined });
        if (lastId != null) await send({ type: 'heist:show', downloadId: lastId }).catch(() => {});
        this.toasts.update(id, {
          tone: 'done',
          title: `${ok} ${ok === 1 ? 'image' : 'images'} ready for PureRef`,
          steps: pureSteps(2).map((x) => ({ ...x })),
          actions: [{ label: 'Open folder again', run: openFolder }],
          detail: failed.length ? `${failed.length} could not be downloaded.` : undefined,
        });
        this.toasts.later(id, 20000);
      } else {
        this.toasts.update(id, {
          tone: failed.length && !ok ? 'error' : 'done',
          title: `${ok} ${ok === 1 ? 'file' : 'files'} saved${failed.length ? ` · ${failed.length} failed` : ''}`,
          detail: plan.metadata.skipped.length ? `${plan.metadata.skipped.length} skipped (duplicates or no image). See metadata.json.` : undefined,
          done: undefined,
          total: undefined,
          onCancel: undefined,
          actions: [
            { label: 'Open folder', run: openFolder },
            { label: 'Show in Downloads', run: () => void send({ type: 'heist:show-default-folder' }) },
          ],
        });
        this.toasts.later(id, 15000);
      }
    } catch (e) {
      const cancelled = (e as Error)?.name === 'AbortError';
      this.toasts.update(id, {
        tone: cancelled ? 'info' : 'error',
        title: cancelled ? 'Download cancelled' : "Couldn't finish the download",
        detail: cancelled ? 'Files already saved stay in your Downloads folder.' : (e as Error)?.message ?? String(e),
        steps: undefined,
        done: undefined,
        total: undefined,
        onCancel: undefined,
      });
      this.toasts.later(id, cancelled ? 5000 : 12000);
    } finally {
      this.store.set({ busy: false });
    }
  }

  private async writeMetadata(plan: Plan, failed: { pinId: string; file: string; reason: string }[]) {
    const failedFiles = new Set(failed.map((f) => f.file));
    const meta = { ...plan.metadata, failed, items: plan.metadata.items.filter((it) => !failedFiles.has(it.file)) };
    await send({ type: 'heist:download-text', path: joinPath(plan.rootDir, 'metadata.json'), mime: 'application/json', text: metadataToJSON(meta) });
    await send({ type: 'heist:download-text', path: joinPath(plan.rootDir, 'metadata.csv'), mime: 'text/csv', text: metadataToCSV(meta) });
  }

  private runZip(plan: Plan, toastId: string, zipPath: string, ac: AbortController, includeMeta: boolean): Promise<void> {
    const jobId = `zip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const total = plan.files.length;
    this.toasts.update(toastId, {
      title: 'Building ZIP',
      detail: undefined,
      path: displayPath(zipPath, false),
      done: 0,
      total,
      onCancel: () => {
        ac.abort();
        void send({ type: 'heist:zip-cancel', jobId });
      },
    });
    return new Promise<void>((resolve) => {
      this.zipJobs.set(jobId, (ev) => {
        if (ev.type === 'heist:zip-progress') {
          this.toasts.update(toastId, { done: ev.done, title: ev.part > 1 ? `Building ZIP · part ${ev.part}` : 'Building ZIP' });
          return;
        }
        if (ev.type !== 'heist:zip-done') return;
        this.zipJobs.delete(jobId);
        const lastId = ev.downloadIds[ev.downloadIds.length - 1];
        if (ev.cancelled) {
          this.toasts.update(toastId, { tone: 'info', title: 'ZIP cancelled', done: undefined, total: undefined, onCancel: undefined });
          this.toasts.later(toastId, 5000);
        } else if (ev.error || lastId == null) {
          this.toasts.update(toastId, {
            tone: 'error',
            title: "Couldn't save the ZIP",
            detail: ev.error ?? 'The browser did not save the file.',
            done: undefined,
            total: undefined,
            onCancel: undefined,
          });
          this.toasts.later(toastId, 12000);
        } else {
          const ok = total - ev.failed.length;
          this.toasts.update(toastId, {
            tone: 'done',
            title: `${ev.parts > 1 ? `${ev.parts} ZIP parts` : 'ZIP'} saved · ${ok} ${ok === 1 ? 'image' : 'images'}${ev.failed.length ? ` · ${ev.failed.length} failed` : ''}`,
            detail: includeMeta ? 'metadata.json and metadata.csv are inside.' : undefined,
            done: undefined,
            total: undefined,
            onCancel: undefined,
            actions: [
              { label: 'Open folder', run: () => void send({ type: 'heist:show', downloadId: lastId }) },
              { label: 'Show in Downloads', run: () => void send({ type: 'heist:show-default-folder' }) },
            ],
          });
          this.toasts.later(toastId, 15000);
        }
        resolve();
      });
      void send({
        type: 'heist:zip',
        job: {
          jobId,
          zipPath,
          files: plan.files.map((f) => ({ pinId: f.pinId, candidates: f.candidates, path: f.relPath })),
          metadata: includeMeta ? plan.metadata : null,
        },
      });
    });
  }

  // ------------------------------------------------------------ copy

  copySelected() {
    const pin = this.sel.singlePin();
    if (!pin) return;
    const blob = (async () => {
      let candidates: string[] | undefined;
      try {
        candidates = parsePin(await api.getPin(pin.id)).media[0]?.candidates;
      } catch {
        /* fall back to the thumbnail's original */
      }
      if (!candidates?.length) candidates = candidatesFromThumb(pin.thumb);
      const res = await send<{ ok: boolean; dataUrl?: string; error?: string }>({ type: 'heist:fetch-image', candidates });
      if (!res?.ok || !res.dataUrl) throw new Error(res?.error ?? 'Image not available');
      const [head, b64] = res.dataUrl.split(',');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const src = new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg' });
      const bmp = await createImageBitmap(src);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0);
      return canvas.convertToBlob({ type: 'image/png' });
    })();
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blob })])
      .then(() => {
        const t = this.toasts.add({ tone: 'done', title: 'Copied to clipboard', detail: 'Paste it into PureRef with Ctrl+V.' });
        this.toasts.later(t, 4000);
      })
      .catch((e) => {
        const t = this.toasts.add({ tone: 'error', title: "Couldn't copy the image", detail: `${(e as Error)?.message ?? e}. Click the page once and try again.` });
        this.toasts.later(t, 8000);
      });
  }
}
