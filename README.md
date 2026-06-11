# GOG Games Saver

A small browser extension that archives game info from **gog-games.to** before the site
goes offline. It adds a **💾 Save game** button to each game's detail view; clicking it
scrapes everything visible and stores it in the extension. A toolbar popup lets you review
your collection and export it to **CSV** or **JSON** anytime.

## What it saves

For each game: title, slug, page URL, rating, release date, popularity ranking, developer,
publisher, genres, tags, up-to-date/out-of-date status, version details (current version,
latest version, last checked) and the GOGDB link, the torrent magnet link, the game / patch /
extra download-host links (FileQ, Transfer.it, FileDitch, 1fichier, …) with filenames, the
installer files with sizes, the extra files with sizes, the cover image URL, and a saved-at
timestamp.

Download links are split into separate fields by the site's own sections —
`downloadLinks` (GAME DOWNLOAD LINKS), `patchDownloadLinks` (PATCH DOWNLOAD LINKS),
`extraDownloadLinks` (EXTRA DOWNLOAD LINKS) — and likewise `installers` (GAME INSTALLERS) vs.
`extras` (EXTRAS).

The version panel (current/latest version, last checked) is only rendered by the site when its
status badge is clicked, so the Save button briefly expands that badge to read it, then collapses
it again. This adds a fraction of a second to each save.

Games are deduplicated by their URL slug — re-saving a game updates its entry.

## Files

```
extension/
  manifest.json   # MV3, works in Chrome & Firefox
  content.js      # injects the Save button + scrapes the page
  content.css     # button styling
  popup.html/.css/.js  # collection list + CSV/JSON export
viewer/           # standalone offline viewer for your exported JSON
  index.html
  styles.css
  app.js
```

## Install

### Chrome / Chromium (Brave, Edge, Opera)
1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Pin the extension so its popup is easy to reach

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `extension/manifest.json`

   (Temporary add-ons are removed when Firefox restarts — just re-load it. To install it
   permanently you'd need to sign it via addons.mozilla.org.)

## Usage
1. Open a game on https://gog-games.to/ (either the modal or a `/game/<slug>` page).
2. Click **💾 Save game** (next to the Torrent button). It turns green and shows the total
   saved count. Games already saved show "✓ Saved (click to update)".
3. Click the extension's toolbar icon to open the popup: review/remove entries, or hit
   **Export CSV** / **Export JSON**. Clearing the list asks for confirmation first.

## Viewer (browse your saved JSON)

`viewer/` is a tiny standalone web page — no install, no server, no Node/Python — for browsing
a collection you exported as JSON. Open `viewer/index.html` in your browser, then **drag your
exported JSON onto the page** (or click *Load JSON…* and pick it). You get a searchable,
filterable, sortable grid of cards; click any game for the full details (all download/patch/extra
links with copy buttons, installers, extras, torrent, and GOG/GOGDB links).

- Works fully offline by just opening the file. Browsers block local-file `fetch()`, so the
  drag/pick method is how you load data from disk — no renaming required.
- The last file you loaded is remembered (via `localStorage`), so reopening the page restores it.
- If you instead **serve** the folder over HTTP (e.g. GitHub Pages), a file named
  `database.json` next to `index.html` loads automatically.

## Notes
- CSV is flattened for spreadsheets (lists joined with `;`, download links as
  `Host: url || Host: url`). JSON keeps the full nested structure — use it if you want every
  individual link/installer cleanly. Exporting both is recommended. The viewer uses JSON.
- The only permission used is `storage`. Exports are generated locally in the browser; no
  data is sent anywhere.
- Selectors were validated against a real saved page; if the site markup changes the
  scraper may need updating (it won't, since the site is closing).
