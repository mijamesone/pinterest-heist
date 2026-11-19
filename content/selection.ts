import type { PageContext } from '../lib/context';

/** A pin the user picked individually, remembered by ID so it survives Pinterest re-rendering. */
export type SeenPin = {
  id: string;
  thumb: string;
  title: string;
  /** Board/section of the page it was picked on, used for naming when the API has nothing. */
  board?: string;
  section?: string;
};

export type SectionRef = {
  key: string;
  slug: string;
  title: string;
  username: string;
  boardSlug: string;
  boardPath: string;
  id?: string;
  count?: number;
};

/** "Everything on this page": a board, a section, a profile's pins or search results. */
export type AllScope = {
  ctx: PageContext;
  count?: number;
  /** Search results only: how many to take. */
  limit?: number;
};

export type CountInfo = { n: number; text: string };

export class Selection {
  pins = new Map<string, SeenPin>();
  sections = new Map<string, SectionRef>();
  all: AllScope | null = null;
  excluded = new Set<string>();
  excludedSections = new Set<string>();
  last: string | null = null;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  isPinSelected(id: string): boolean {
    if (this.pins.has(id)) return true;
    return !!this.all && !this.excluded.has(id);
  }

  isSectionSelected(slugKey: string, slug: string): boolean {
    if (this.sections.has(slugKey)) return true;
    return !!this.all && this.all.ctx.kind === 'board' && !this.excludedSections.has(slug);
  }

  setPin(pin: SeenPin, on: boolean) {
    if (this.all) {
      if (on) this.excluded.delete(pin.id);
      else {
        this.excluded.add(pin.id);
        this.pins.delete(pin.id);
      }
    } else if (on) this.pins.set(pin.id, pin);
    else this.pins.delete(pin.id);
    this.last = pin.id;
  }

  togglePin(pin: SeenPin) {
    this.setPin(pin, !this.isPinSelected(pin.id));
    this.emit();
  }

  toggleSection(ref: SectionRef) {
    if (this.all && this.all.ctx.kind === 'board') {
      if (this.excludedSections.has(ref.slug)) this.excludedSections.delete(ref.slug);
      else this.excludedSections.add(ref.slug);
    } else if (this.sections.has(ref.key)) this.sections.delete(ref.key);
    else this.sections.set(ref.key, ref);
    this.emit();
  }

  /** Select everything here. Individually picked pins that are on this page are now covered. */
  setAll(scope: AllScope, renderedIds: string[]) {
    for (const id of renderedIds) this.pins.delete(id);
    this.all = scope;
    this.excluded.clear();
    this.excludedSections.clear();
    this.emit();
  }

  clear() {
    this.pins.clear();
    this.sections.clear();
    this.all = null;
    this.excluded.clear();
    this.excludedSections.clear();
    this.last = null;
    this.emit();
  }

  /** Leaving the page drops "select all", but keeps pins picked one by one. */
  dropAll() {
    if (!this.all) return;
    this.all = null;
    this.excluded.clear();
    this.excludedSections.clear();
    this.emit();
  }

  count(): CountInfo {
    let n = this.pins.size;
    let unknown = false;
    for (const s of this.sections.values()) {
      if (s.count == null) unknown = true;
      else n += s.count;
    }
    if (this.all) {
      if (this.all.limit != null) n += Math.max(0, this.all.limit - this.excluded.size);
      else if (this.all.count != null) n += Math.max(0, this.all.count - this.excluded.size);
      else return { n: Math.max(1, n), text: n ? `All + ${n}` : 'All' };
    }
    return { n: unknown ? Math.max(n, 1) : n, text: unknown ? `${n}+` : String(n) };
  }

  /** Copy only makes sense for exactly one picked image. */
  singlePin(): SeenPin | null {
    if (this.all || this.sections.size || this.pins.size !== 1) return null;
    return [...this.pins.values()][0];
  }
}
