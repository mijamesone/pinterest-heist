# Pinterest Heist

A Chromium extension (Chrome, Edge, Brave, Arc, Opera, Vivaldi) that downloads Pinterest pins at the largest size Pinterest stores: one pin, a hand-picked selection, or whole boards with every section in its own folder. It can also hand images to [PureRef](https://www.pureref.com/).

For personal use. Not affiliated with Pinterest.

## Install

1. Download `pinterest-heist-x.y.z-chrome.zip` from [Releases](../../releases).
2. Unzip it somewhere permanent.
3. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder.
4. Open Pinterest and click the extension's toolbar icon (or press **Alt + Shift + H**).

## What it does

- **Hover any pin** and click the circle to select it. `Shift`+click selects a range, `Ctrl`+drag draws a box, `S` turns on selection mode, `Ctrl`+`A` selects a whole board including pins not loaded yet.
- **A floating dock** holds Select mode, Select all, Deselect all, Download, Send to PureRef and Copy. It only appears while Pinterest Heist is on for that tab.
- **Download as files or a ZIP** into `Downloads\Pinterest Heist\<name>\`. Board sections become sub-folders. The name is suggested from the board or section and you can edit it, along with a file-name pattern such as `{board}_{section}_{index}`.
- **Full resolution**: the original file when Pinterest has one, falling back to 1200 px, then 736 px.
- **Carousels and Idea Pins** download as numbered sets (`_014a`, `_014b`).
- **Metadata** (`metadata.json` + `metadata.csv`) with each pin's link, source URL, title and pinner.
- **Skip duplicates**, including the same image saved as different pins.
- **Send to PureRef** saves the selection to a `_PureRef` folder and opens it in Explorer for you to drag onto the canvas. **Copy** puts one full-size image on the clipboard for `Ctrl`+`V`.

Docs: [User guide](docs/USER_GUIDE.md) · [Shortcuts](docs/SHORTCUTS.md)

## Status

Phase 1 of 4.

| Phase | Scope | State |
|---|---|---|
| 1 | Selection, dock, downloads (files/ZIP), sections, naming, metadata, duplicates, carousels, Idea Pins, PureRef folder handoff | Built, needs testing on live Pinterest |
| 2 | Side panel with queue and history, incremental board sync, resolution and aspect filters | Not started |
| 3 | Video downloads (MP4 and stream joining) | Not started |
| 4 | Windows helper for one-click sending to PureRef 2.1.4 | Not started |

Pinterest Heist talks to Pinterest's private web API (the same `/resource/…` endpoints pinterest.com uses). That API is undocumented and changes without notice. Phase 1 was written against its known request and response shapes and tested end to end against a local imitation of Pinterest, but not yet against the live site, so expect a round of fixes after the first real use.

## Development

```bash
npm install
npm run dev        # opens a Chromium with the extension loaded and hot reload
npm run build      # production build in .output/chrome-mv3
npm run zip        # the release ZIP
npm test           # unit tests (naming, page detection, pin parsing, download plans)
npx tsc --noEmit   # type check
```

End-to-end test against a local fake Pinterest (needs Python with Pillow, OpenSSL and Playwright):

```bash
npm run build
python3 tests/e2e/setup.py
python3 tests/e2e/server.py &
node tests/e2e/run.mjs
```

Releases: push a tag like `v0.1.1` and GitHub Actions attaches the ZIP to a release.

### Layout

| Path | What it is |
|---|---|
| `entrypoints/background.ts` | Toolbar toggle, downloads, ZIP hand-off |
| `entrypoints/content/index.tsx` | Content script: mounts the dock in a shadow root |
| `entrypoints/offscreen/` | Builds ZIP files (split into ~800 MB parts) and metadata files |
| `content/` | Selection model, pin scanner (circles), page controller, collecting pins via the API |
| `components/` | The dock, download sheet, toasts and shortcut sheet (React) |
| `lib/` | Pure logic: page detection, Pinterest API client, pin parsing, naming, download plans |
| `tests/` | Unit tests, plus `tests/e2e/` for the browser test |

The manifest carries a fixed public key, so the extension ID is always `mkbabhikjbjlgcchkjmilpbfnliogiin` and settings survive updates.
