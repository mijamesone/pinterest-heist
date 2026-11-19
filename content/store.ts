import type { PageContext } from '../lib/context';
import type { Format } from '../lib/plan';

export type ToastAction = { label: string; run: () => void };
export type ToastStep = { label: string; detail?: string; state: 'todo' | 'doing' | 'done' | 'you' };

export type Toast = {
  id: string;
  tone: 'progress' | 'done' | 'error' | 'info';
  title: string;
  detail?: string;
  path?: string;
  done?: number;
  total?: number;
  steps?: ToastStep[];
  actions?: ToastAction[];
  onCancel?: () => void;
};

export type SheetSection = { key: string; title: string; count?: number; checked: boolean };

export type SheetState = {
  name: string;
  format: Format;
  pattern: string;
  group: boolean;
  includeMeta: boolean;
  skipDupes: boolean;
  /** Board-wide downloads: which sections to include. null when not applicable. */
  sections: SheetSection[] | null;
  sectionsLoading: boolean;
  countText: string;
  sample: { board: string; section: string; title: string; pinner: string; pinId: string; query: string; folders: string[] };
};

export type UIState = {
  mode: boolean;
  countText: string;
  count: number;
  canCopy: boolean;
  ctx: PageContext;
  sheet: SheetState | null;
  shortcuts: boolean;
  tips: boolean;
  toasts: Toast[];
  marquee: { x: number; y: number; w: number; h: number } | null;
  limitPrompt: number | null;
  busy: boolean;
};

export type Store = {
  get: () => UIState;
  set: (patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createStore(initial: UIState): Store {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

let toastSeq = 0;

export function toastApi(store: Store) {
  return {
    add(t: Omit<Toast, 'id'>): string {
      const id = `t${++toastSeq}`;
      store.set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
      return id;
    },
    update(id: string, patch: Partial<Toast>) {
      store.set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    },
    remove(id: string) {
      store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    later(id: string, ms: number) {
      setTimeout(() => this.remove(id), ms);
    },
  };
}
export type Toasts = ReturnType<typeof toastApi>;
