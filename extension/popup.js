/* GOG Games Saver — popup: list saved games, export to CSV/JSON, clear. */
(() => {
  "use strict";

  const ext = globalThis.browser ?? globalThis.chrome;
  const store = ext.storage.local;

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const countEl = document.getElementById("count");
  const csvBtn = document.getElementById("export-csv");
  const jsonBtn = document.getElementById("export-json");
  const clearBtn = document.getElementById("clear");

  const getGames = async () => (await store.get("games")).games || {};

  // ---- rendering -------------------------------------------------------------

  function render(games) {
    const entries = Object.entries(games);
    countEl.textContent = `${entries.length} saved`;
    const disabled = entries.length === 0;
    csvBtn.disabled = jsonBtn.disabled = clearBtn.disabled = disabled;
    emptyEl.classList.toggle("hidden", !disabled);

    // Newest first.
    entries.sort((a, b) => (b[1].savedAt || "").localeCompare(a[1].savedAt || ""));

    listEl.replaceChildren();
    for (const [key, g] of entries) {
      const li = document.createElement("li");

      const title = document.createElement("span");
      title.className = "game-title";
      title.textContent = g.title || key;
      title.title = g.title || key;

      const meta = document.createElement("span");
      meta.className = "game-meta";
      const extra = g.extraDownloadLinks?.length ? ` +${g.extraDownloadLinks.length} extra` : "";
      meta.textContent = `${g.downloadLinks?.length || 0} hosts${extra}`;

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "✕";
      remove.title = "Remove";
      remove.addEventListener("click", async () => {
        const all = await getGames();
        delete all[key];
        await store.set({ games: all });
      });

      li.append(title, meta, remove);
      listEl.appendChild(li);
    }
  }

  // ---- export ----------------------------------------------------------------

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  function csvCell(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const flattenLinks = (arr) =>
    (arr || [])
      .map((d) => `${d.label || d.host}: ${d.links.map((l) => l.url).join(" | ")}`)
      .join(" || ");
  const flattenFiles = (arr) =>
    (arr || []).map((i) => `${i.filename} (${i.size})`).join("; ");

  function toCsv(games) {
    const cols = [
      "title", "slug", "url", "rating", "releaseDate", "ranking",
      "developer", "publisher", "genres", "tags", "status",
      "currentVersion", "latestVersion", "lastChecked", "gogUrl", "gogdbUrl", "torrent",
      "downloadLinks", "patchDownloadLinks", "extraDownloadLinks",
      "installers", "extras", "coverImage", "savedAt",
    ];
    const rows = [cols.join(",")];
    for (const g of Object.values(games)) {
      const row = {
        ...g,
        genres: (g.genres || []).join("; "),
        tags: (g.tags || []).join("; "),
        downloadLinks: flattenLinks(g.downloadLinks),
        patchDownloadLinks: flattenLinks(g.patchDownloadLinks),
        extraDownloadLinks: flattenLinks(g.extraDownloadLinks),
        installers: flattenFiles(g.installers),
        extras: flattenFiles(g.extras),
      };
      rows.push(cols.map((c) => csvCell(row[c])).join(","));
    }
    return "﻿" + rows.join("\r\n"); // BOM for Excel
  }

  csvBtn.addEventListener("click", async () => {
    const games = await getGames();
    download(`gog-games-${stamp()}.csv`, toCsv(games), "text/csv;charset=utf-8");
  });

  jsonBtn.addEventListener("click", async () => {
    const games = await getGames();
    download(
      `gog-games-${stamp()}.json`,
      JSON.stringify(Object.values(games), null, 2),
      "application/json"
    );
  });

  // Two-click confirm instead of window.confirm() — the native dialog gets
  // clipped inside the narrow popup window and is awkward to click.
  let clearArmed = false;
  let clearTimer;
  function resetClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    clearBtn.textContent = "Clear all";
    clearBtn.classList.remove("armed");
  }
  clearBtn.addEventListener("click", async () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = "Click again to confirm";
      clearBtn.classList.add("armed");
      clearTimer = setTimeout(resetClear, 3000);
      return;
    }
    resetClear();
    await store.set({ games: {} });
  });

  // ---- live updates ----------------------------------------------------------

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.games) render(changes.games.newValue || {});
  });

  getGames().then(render);
})();
