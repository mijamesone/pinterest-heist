# Pinterest Heist — User Guide

Pinterest Heist downloads Pinterest pins at the largest size Pinterest stores. It handles single pins, a hand-picked selection, or whole boards with their sections, and it can hand images to PureRef. Everything runs in your browser with your own Pinterest login, and nothing is sent anywhere except Pinterest itself.

**Phase 1** is described here. The side panel, incremental sync and filters (phase 2), video files (phase 3) and the one-click PureRef helper (phase 4) are not built yet.

---

## 1. Install (Chrome, Edge, Brave, Arc, Opera, Vivaldi)

1. Go to the repo's **Releases** page and download the latest `pinterest-heist-x.y.z-chrome.zip`.
2. Unzip it somewhere permanent, for example `Documents\Pinterest Heist\`. Don't delete this folder, because the browser runs the extension from it.
3. Open your browser's extensions page:
   - Chrome, Brave, Arc: `chrome://extensions`
   - Edge: `edge://extensions`
4. Turn on **Developer mode** (top right in Chrome, left sidebar in Edge).
5. Click **Load unpacked** and choose the unzipped folder (the one that contains `manifest.json`).
6. Pin the extension to your toolbar.

> Edge may sometimes ask whether to turn off developer-mode extensions. Choose **Keep**.

## 2. Update

1. Download the new release ZIP.
2. Unzip it over the old folder, replacing its files.
3. On the extensions page, click the ↻ reload icon on Pinterest Heist, then reload your Pinterest tabs.

Your settings survive updates because the extension has a fixed ID (`mkbabhikjbjlgcchkjmilpbfnliogiin`).

## 3. Turn it on

Pinterest Heist stays out of the way until you ask for it.

- **Click the toolbar icon** on a Pinterest tab, or press **Alt + Shift + H**. The icon shows a red **ON** badge, the dock slides up at the bottom of the page, and pins get their select circles.
- Click the icon again, press **Alt + Shift + H**, or click **✕** on the dock to turn it off. Everything disappears and Pinterest is back to normal.
- It stays on for that tab while you browse Pinterest, including after a reload, until you turn it off or close the tab.

## 4. The dock

`H · Select mode S · Select all · Deselect all | 12 selected · Download · Send to PureRef · Copy | ⌨ · ✕`

| Button | What it does |
|---|---|
| **Select mode** | A plain click selects pins. Same as pressing `S` |
| **Select all** | Every pin on this board, section or profile, including pins not loaded yet. Same as `Ctrl` + `A` |
| **Deselect all** | Clears the selection. Same as `Esc` |
| **Download** | Opens the download sheet (section 6) |
| **Send to PureRef** | See section 8 |
| **Copy** | Copies the image so you can paste it with `Ctrl` + `V`. Works when exactly one pin is selected |
| **⌨** | The shortcut sheet. Same as `?` |
| **✕** | Turns Pinterest Heist off for this tab |

On narrow windows the labels hide and only icons remain.

## 5. Selecting pins

- **One pin:** hover it and click the circle at its bottom left. It turns red with a check and the pin gets a red outline.
- **A range:** select one pin, then `Shift` + click another pin's circle. Everything between them is selected.
- **A group:** hold `Ctrl` and drag a box across the pins.
- **Everything:** `Ctrl` + `A` or **Select all**. On a board this includes every section. The counter shows the real total once Pinterest reports it.
- **Lots of picking:** press `S` for selection mode. Every pin shows its circle and a plain click selects. Press `S` again to go back to normal browsing.
- **Whole sections:** on a board page, the section cards at the top have circles too.

Pins you pick one by one stay selected while you browse to other boards, so you can collect from several places and download once. **Select all** applies to the page you are on and is cleared when you leave it.

## 6. The download sheet

| Setting | What it does |
|---|---|
| **Saves to** | Where the files go, e.g. `Downloads\Pinterest Heist\Interior Refs\` |
| **Name** | Suggested from the page, e.g. `Interior Refs`, `Interior Refs – Kitchens`, `Search – brutalist stairs – 2026-11-19`. Edit it freely. It becomes the folder or ZIP name |
| **Format** | **Files** (each image saved separately) or **ZIP** (one archive). Your last choice is remembered |
| **File names** | A pattern, default `{board}_{section}_{index}`. Click a token to add it |
| **Sections** | On a whole-board download: untick sections you don't want, including "Pins not in a section" |
| **Group inside a "Pinterest Heist" folder** | On by default. Off saves straight into `Downloads\<name>\` |
| **Include metadata** | Adds `metadata.json` and `metadata.csv` |
| **Skip duplicates** | Skips the same pin twice, and the same image saved as different pins |

**File name tokens**

| Token | Example |
|---|---|
| `{board}` | `Interior Refs` |
| `{section}` | `Kitchens` (empty when the pin isn't in a section) |
| `{index}` | `001`, `002`… |
| `{pinId}` | `8392018471923` |
| `{title}` | `Concrete spiral stair` (shortened to 60 characters) |
| `{pinner}` | `studio.archive` |
| `{date}` | `2026-11-19` |
| `{query}` | Your search words, on search pages |

Characters Windows doesn't allow are removed automatically, and long names are shortened so paths stay under Windows' 260-character limit.

The **metadata** files list each image's file name, pin link, original source URL, title, description, pinner, board, section and size, plus anything that was skipped or failed.

## 7. Boards, sections and folders

Files and ZIPs use the same layout:

```
Downloads\
  Pinterest Heist\
    Interior Refs\
      Interior Refs_001.jpg        ← pins not in any section
      Kitchens\
        Interior Refs_Kitchens_001.jpg
      Lighting\
        Interior Refs_Lighting_001.jpg
      metadata.json
      metadata.csv
```

A ZIP is saved as `Downloads\Pinterest Heist\Interior Refs.zip` with the same folders inside. Very large ZIPs are split into parts of about 800 MB, e.g. `Interior Refs (part 1).zip`, so the browser doesn't run out of memory.

**Carousels and Idea Pins** download as numbered sets that sort together: `…_014a.jpg`, `…_014b.jpg`.

**Videos** are not downloaded yet (phase 3). Video pins save their cover image, marked `video-cover` in the metadata.

## 8. PureRef (2.1.4)

| Method | How |
|---|---|
| **Send to PureRef** | Saves your selection at full size to `Downloads\Pinterest Heist\_PureRef\<name>\` and opens that folder in Explorer. Drag the folder (or the highlighted files) onto your PureRef canvas |
| **Drag** | Drag a pin straight from Pinterest onto the PureRef canvas. This gives the size Pinterest is showing, not always the original |
| **Copy** | Select one pin, click **Copy**, then press `Ctrl` + `V` in PureRef. This copies the full-size original |

One-click sending, without the folder step, comes in phase 4 with a small Windows helper app.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| Clicking the icon does nothing | Make sure the tab is on pinterest.com. On other sites the icon briefly shows **PIN** |
| No circles appear on pins | Reload the Pinterest tab. If it still fails, Pinterest may have changed its page layout: open an issue with a screenshot |
| A "Save as" window opens for every file | Turn off **Settings → Downloads → Ask where to save each file** in your browser |
| Some images are smaller than expected | Pinterest had no original for those pins, so the largest available size was used. `metadata.json` records each image's size |
| A board shows 412 pins but fewer downloaded | Pinterest counts pins that were deleted or hidden. Skipped and failed pins are listed in `metadata.json` |
| "Couldn't finish the download" with a Pinterest error | Pinterest changed its private API. Open an issue with the message and a screenshot of the console (F12 → Console) |
| Copy fails | Click anywhere on the page once, then try again. The browser only lets a focused page write to the clipboard |

## 10. Privacy

The extension only talks to Pinterest (`pinterest.com` and its country domains) and its image servers (`*.pinimg.com`). It has no analytics, no tracking and no servers of its own. Settings stay in your browser's extension storage.
