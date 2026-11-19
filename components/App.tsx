import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Controller } from '../content/controller';
import { displayPath, isoDate, renderPattern, sanitizeSegment, TOKENS } from '../lib/naming';
import { rootFor } from '../lib/plan';
import type { SheetState, Toast } from '../content/store';

const Icon = {
  pointer: <path d="M5 3l14 8-6 2-2 6z" />,
  all: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  none: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />,
  pureref: (
    <>
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="7" rx="1.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  keys: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
};

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function App({ ctl }: { ctl: Controller }) {
  const s = useSyncExternalStore(ctl.store.subscribe, ctl.store.get);
  const none = s.count === 0;

  return (
    <div className="heist-root">
      {s.mode && (
        <div className="mode-pill" role="status">
          <span className="dot" />
          Selection mode · <Kbd>S</Kbd> to exit
        </div>
      )}

      {s.marquee && <div className="marquee" style={{ left: s.marquee.x, top: s.marquee.y, width: s.marquee.w, height: s.marquee.h }} />}

      {s.tips && <Tips onDone={() => ctl.dismissTips()} />}
      {s.limitPrompt != null && <LimitPrompt initial={s.limitPrompt} onOk={(n) => ctl.confirmLimit(n)} onCancel={() => ctl.cancelLimit()} />}

      <div className={`dock${none ? '' : ' has-sel'}`} role="toolbar" aria-label="Pinterest Heist">
        <span className="dlogo" aria-hidden="true">
          H
        </span>
        <button className="btn toggle" aria-pressed={s.mode} title="Selection mode (S)" onClick={() => ctl.toggleMode()}>
          <Svg>{Icon.pointer}</Svg>
          <span className="lbl">Select mode</span>
          <Kbd>S</Kbd>
        </button>
        <button className="btn" title="Select all here (Ctrl+A)" onClick={() => void ctl.selectAll()}>
          <Svg>{Icon.all}</Svg>
          <span className="lbl">Select all</span>
        </button>
        <button className="btn" aria-disabled={none} title="Deselect all (Esc)" onClick={() => !none && ctl.clear()}>
          <Svg>{Icon.none}</Svg>
          <span className="lbl">Deselect all</span>
        </button>
        <div className="sep" />
        <div className="count" aria-live="polite">
          <b>{s.countText}</b>
          <span className="lbl">selected</span>
        </div>
        <button className="btn primary" aria-disabled={none || s.busy} onClick={() => !none && !s.busy && void ctl.openSheet()}>
          <Svg>{Icon.download}</Svg>
          <span className="lbl">Download</span>
        </button>
        <button
          className="btn"
          aria-disabled={none || s.busy}
          title="Save to a PureRef folder and open it in Explorer"
          onClick={() => !none && !s.busy && void ctl.sendToPureRef()}
        >
          <Svg>{Icon.pureref}</Svg>
          <span className="lbl">Send to PureRef</span>
        </button>
        <button
          className="btn"
          aria-disabled={!s.canCopy}
          title={s.canCopy ? 'Copy the image for Ctrl+V in PureRef' : 'Copy works with exactly one pin selected'}
          onClick={() => s.canCopy && ctl.copySelected()}
        >
          <Svg>{Icon.copy}</Svg>
          <span className="lbl">Copy</span>
        </button>
        <div className="sep" />
        <button className="btn icon" title="Shortcuts (?)" aria-label="Shortcuts" onClick={() => ctl.store.set({ shortcuts: true, sheet: null })}>
          <Svg>{Icon.keys}</Svg>
        </button>
        <button className="btn icon" title="Turn off Pinterest Heist (Alt+Shift+H)" aria-label="Turn off" onClick={() => ctl.turnOff()}>
          <Svg>{Icon.close}</Svg>
        </button>
      </div>

      <div className="toasts">
        {s.toasts.map((t) => (
          <ToastView key={t.id} t={t} onClose={() => ctl.toasts.remove(t.id)} />
        ))}
      </div>

      {s.sheet && <Sheet sheet={s.sheet} ctl={ctl} />}
      {s.shortcuts && <Shortcuts onClose={() => ctl.store.set({ shortcuts: false })} />}
    </div>
  );
}

// ---------------------------------------------------------------- toasts

function ToastView({ t, onClose }: { t: Toast; onClose: () => void }) {
  const pct = t.total ? Math.round(((t.done ?? 0) / t.total) * 100) : null;
  return (
    <div className={`toast ${t.tone}`} role="status">
      <div className="row">
        <span className="title">{t.title}</span>
        {t.total != null ? (
          <span className="num">
            {t.done ?? 0} / {t.total}
          </span>
        ) : (
          <button className="x small" aria-label="Dismiss" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      {pct != null && (
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {t.steps && (
        <ol className="steps">
          {t.steps.map((st, i) => (
            <li key={i} className={st.state}>
              <span>
                {st.label}
                {st.detail && <small>{st.detail}</small>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {t.path && <div className="path">{t.path}</div>}
      {t.detail && <div className="detail">{t.detail}</div>}
      {(t.actions?.length || t.onCancel) && (
        <div className="acts">
          {t.actions?.map((a) => (
            <button key={a.label} className="btn small" onClick={a.run}>
              {a.label}
            </button>
          ))}
          {t.onCancel && (
            <button className="btn small" onClick={t.onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- download sheet

function Sheet({ sheet, ctl }: { sheet: SheetState; ctl: Controller }) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
  const set = (p: Partial<SheetState>) => ctl.patchSheet(p);
  const { rootDir, zipPath } = rootFor({ name: sheet.name, group: sheet.group });
  const where = sheet.format === 'zip' ? displayPath(zipPath, false) : displayPath(rootDir);
  const anySection = !sheet.sections || sheet.sections.some((x) => x.checked);

  const sampleName = (section: string, idx: string) =>
    (renderPattern(sheet.pattern || '{index}', {
      board: sheet.sample.board,
      section,
      index: idx,
      pinId: sheet.sample.pinId,
      title: sheet.sample.title,
      pinner: sheet.sample.pinner,
      date: isoDate(),
      query: sheet.sample.query,
    }) || idx) + '.jpg';

  const lines: ReactNode[] = [<b key="root">{where}</b>];
  lines.push(`  ${sampleName(sheet.sample.section, '001')}`);
  lines.push(`  ${sampleName(sheet.sample.section, '002')}`);
  for (const f of sheet.sample.folders.slice(0, 3)) {
    lines.push(<b key={`f-${f}`}>{`  ${sanitizeSegment(f)}\\`}</b>);
    lines.push(`    ${sampleName(f, '001')}`);
  }
  if (sheet.includeMeta) lines.push('  metadata.json · metadata.csv');

  const addToken = (t: string) => set({ pattern: `${sheet.pattern.replace(/[_\s-]+$/, '')}${sheet.pattern ? '_' : ''}{${t}}` });

  return (
    <div className="veil" onMouseDown={(e) => e.target === e.currentTarget && ctl.closeSheet()}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="heist-sheet-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') ctl.closeSheet();
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text' && anySection) void ctl.startFromSheet();
        }}
      >
        <header>
          <h3 id="heist-sheet-title">Download {sheet.countText} pins</h3>
          <button className="x" aria-label="Close" onClick={() => ctl.closeSheet()}>
            ✕
          </button>
        </header>
        <div className="form">
          <div className="field">
            <span className="lab">Saves to</span>
            <div className="loc">
              <Svg>{Icon.folder}</Svg>
              <span>{where}</span>
            </div>
            <span className="hint">Your PC's Downloads folder, or wherever your browser saves downloads.</span>
          </div>
          <div className="field">
            <label htmlFor="heist-name">Name</label>
            <input id="heist-name" ref={nameRef} className="input" type="text" value={sheet.name} onChange={(e) => set({ name: e.target.value })} />
            <span className="hint">Suggested from the page you are on. Becomes the folder or ZIP name.</span>
          </div>
          <div className="field">
            <span className="lab">Format</span>
            <div className={`seg${sheet.format === 'zip' ? ' zip' : ''}`}>
              <span className="thumb" />
              <button aria-pressed={sheet.format === 'files'} onClick={() => set({ format: 'files' })}>
                Files
              </button>
              <button aria-pressed={sheet.format === 'zip'} onClick={() => set({ format: 'zip' })}>
                ZIP
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="heist-pattern">File names</label>
            <input id="heist-pattern" className="input mono" type="text" value={sheet.pattern} onChange={(e) => set({ pattern: e.target.value })} />
            <div className="chips">
              {TOKENS.map((t) => (
                <button key={t} className="chip" onClick={() => addToken(t)}>{`{${t}}`}</button>
              ))}
            </div>
          </div>
          {(sheet.sections || sheet.sectionsLoading) && (
            <div className="field">
              <span className="lab">Sections</span>
              {sheet.sectionsLoading && !sheet.sections ? (
                <span className="hint">Loading sections…</span>
              ) : (
                <div className="checks">
                  {sheet.sections!.map((sec, i) => (
                    <label key={sec.key} className="check">
                      <input
                        type="checkbox"
                        checked={sec.checked}
                        onChange={(e) => set({ sections: sheet.sections!.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)) })}
                      />
                      <span>{sec.title}</span>
                      {sec.count != null && <small>{sec.count}</small>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="field">
            <span className="lab">Preview</span>
            <div className="tree">
              {lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
          <div className="toggles">
            <Toggle
              label='Group inside a "Pinterest Heist" folder'
              hint="Off saves straight into Downloads"
              checked={sheet.group}
              onChange={(v) => set({ group: v })}
            />
            <Toggle label="Include metadata" hint="metadata.json + metadata.csv with source links" checked={sheet.includeMeta} onChange={(v) => set({ includeMeta: v })} />
            <Toggle label="Skip duplicates" hint="Same pin, or the same image saved twice" checked={sheet.skipDupes} onChange={(v) => set({ skipDupes: v })} />
          </div>
          <div className="foot">
            <span className="est">Largest size Pinterest has for each pin</span>
            <button className="btn primary" aria-disabled={!anySection} onClick={() => anySection && void ctl.startFromSheet()}>
              {sheet.format === 'zip' ? 'Download ZIP' : `Download ${sheet.countText} pins`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="tg">
      <span>
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <input type="checkbox" className="sw" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ---------------------------------------------------------------- shortcuts, tips, limit

function Shortcuts({ onClose }: { onClose: () => void }) {
  const row = (label: string, keys: ReactNode) => (
    <div className="krow">
      <span>{label}</span>
      <span>{keys}</span>
    </div>
  );
  return (
    <div className="veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby="heist-keys-title" onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1}>
        <header>
          <h3 id="heist-keys-title">Shortcuts</h3>
          <button className="x" aria-label="Close" onClick={onClose} autoFocus>
            ✕
          </button>
        </header>
        <div className="keys">
          <div>
            <div className="kgroup">
              <h5>SELECT</h5>
              {row('Select a pin', 'hover, click ◯')}
              {row('Select a range', <><Kbd>Shift</Kbd> + click ◯</>)}
              {row('Range (alternative)', <><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd> + click</>)}
              {row('Box-select', <><Kbd>Ctrl</Kbd> + drag</>)}
              {row('Select all here', <><Kbd>Ctrl</Kbd><Kbd>A</Kbd></>)}
              {row('Deselect all', <Kbd>Esc</Kbd>)}
            </div>
          </div>
          <div>
            <div className="kgroup">
              <h5>MODES</h5>
              {row('Selection mode on / off', <Kbd>S</Kbd>)}
              {row('Leave selection mode', <><Kbd>Esc</Kbd><Kbd>Esc</Kbd></>)}
              {row('Turn Pinterest Heist on / off', <><Kbd>Alt</Kbd><Kbd>Shift</Kbd><Kbd>H</Kbd></>)}
            </div>
            <div className="kgroup">
              <h5>GENERAL</h5>
              {row('Show this sheet', <Kbd>?</Kbd>)}
              {row('Open a pin in a new tab', 'middle-click')}
              {row('Send one pin to PureRef', 'drag onto canvas')}
            </div>
          </div>
          <p className="knote">Keys do nothing while you type in a search box or comment field. Every action also has a button on the dock.</p>
        </div>
      </div>
    </div>
  );
}

function Tips({ onDone }: { onDone: () => void }) {
  return (
    <div className="tips" role="dialog" aria-label="How to use Pinterest Heist">
      <h4>Pinterest Heist is on</h4>
      <ol>
        <li>
          Hover a pin and click the <b>circle</b> at its bottom left. <Kbd>Shift</Kbd>+click selects a range.
        </li>
        <li>
          Press <Kbd>S</Kbd> for selection mode, where a plain click selects.
        </li>
        <li>
          On a board, <Kbd>Ctrl</Kbd>
          <Kbd>A</Kbd> selects every pin and section, even ones not loaded yet.
        </li>
      </ol>
      <button className="btn primary small" onClick={onDone}>
        Got it
      </button>
    </div>
  );
}

function LimitPrompt({ initial, onOk, onCancel }: { initial: number; onOk: (n: number) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <div className="limit" role="dialog" aria-label="How many search results">
      <label htmlFor="heist-limit">Search results never end. Select the first</label>
      <div className="limit-row">
        <input
          id="heist-limit"
          ref={ref}
          className="input"
          type="number"
          min={1}
          max={5000}
          defaultValue={initial}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOk(Number((e.target as HTMLInputElement).value));
            if (e.key === 'Escape') onCancel();
          }}
        />
        <span>results</span>
        <button className="btn primary small" onClick={() => onOk(Number(ref.current?.value))}>
          Select
        </button>
        <button className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
