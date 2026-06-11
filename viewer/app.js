/* GOG Games — Saved Library viewer.
 * Pure static client: load an exported JSON (drag/drop, file picker, auto-fetch
 * of database.json, or last-loaded from localStorage), then browse/search it.
 * No build step, no server required.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "ggs-viewer-data";
  const $ = (sel) => document.querySelector(sel);

  // Tiny DOM builder that sets text/attrs safely (no innerHTML with data).
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const els = {
    count: $("#count"),
    search: $("#search"),
    status: $("#status-filter"),
    sort: $("#sort"),
    grid: $("#grid"),
    empty: $("#empty"),
    noResults: $("#no-results"),
    modal: $("#modal"),
    modalBody: $(".modal-body"),
    drop: $("#drop-overlay"),
    toast: $("#toast"),
    fileInput: $("#file-input"),
    clearBtn: $("#clear-btn"),
  };

  let games = [];

  // ---- loading ---------------------------------------------------------------

  function normalize(data) {
    const arr = Array.isArray(data) ? data : Object.values(data || {});
    return arr.filter((g) => g && (g.title || g.slug));
  }

  function setData(data, { persist = true } = {}) {
    games = normalize(data);
    if (!games.length) {
      toast("That file has no saved games.");
      return;
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
      } catch (e) {
        /* quota or disabled — fine, just won't remember next time */
      }
    }
    els.empty.hidden = true;
    els.clearBtn.hidden = false;
    render();
    toast(`Loaded ${games.length} game${games.length === 1 ? "" : "s"}.`);
  }

  function clearData() {
    games = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    els.grid.replaceChildren();
    els.grid.hidden = true;
    els.noResults.hidden = true;
    els.empty.hidden = false;
    els.clearBtn.hidden = true;
    els.count.textContent = "no games loaded";
    els.search.value = "";
    toast("Cleared. Drop a JSON to load again.");
  }

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setData(JSON.parse(reader.result));
      } catch (e) {
        toast("Could not parse that file as JSON.");
      }
    };
    reader.onerror = () => toast("Could not read that file.");
    reader.readAsText(file);
  }

  async function tryAutoLoad() {
    // 1) last loaded (works offline, file://)
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        setData(JSON.parse(cached), { persist: false });
        return;
      }
    } catch (e) {
      /* ignore */
    }
    // 2) database.json next to this page (only when served over http/https)
    if (location.protocol.startsWith("http")) {
      try {
        const res = await fetch("database.json", { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch (e) {
        /* not present — stay on empty state */
      }
    }
  }

  // ---- filtering / sorting ---------------------------------------------------

  const ratingNum = (g) => parseFloat(g.rating) || 0;
  const releaseTime = (g) => {
    const t = Date.parse(g.releaseDate);
    return Number.isNaN(t) ? 0 : t;
  };

  function currentView() {
    const q = els.search.value.trim().toLowerCase();
    const status = els.status.value;
    let list = games.filter((g) => {
      if (status && g.status !== status) return false;
      if (!q) return true;
      const hay = [
        g.title,
        g.developer,
        g.publisher,
        (g.genres || []).join(" "),
        (g.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const [key, dir] = (els.sort.value || "saved-desc").split("-");
    const sorters = {
      title: (a, b) => (a.title || "").localeCompare(b.title || ""),
      rating: (a, b) => ratingNum(a) - ratingNum(b),
      release: (a, b) => releaseTime(a) - releaseTime(b),
      saved: (a, b) => (a.savedAt || "").localeCompare(b.savedAt || ""),
    };
    list.sort(sorters[key] || sorters.saved);
    if (dir === "desc") list.reverse();
    return list;
  }

  // ---- rendering -------------------------------------------------------------

  function statusBadge(status) {
    if (!status) return null;
    const out = /out/i.test(status);
    return el("span", { class: `badge ${out ? "out" : "up"}`, text: status });
  }

  function card(g) {
    const cover = el("div", {
      class: "card-cover",
      style: g.coverImage ? `background-image:url("${CSS.escape(g.coverImage)}")` : "",
    });
    if (!g.coverImage) {
      cover.append(el("span", { class: "initial", text: (g.title || "?")[0].toUpperCase() }));
    }

    const tags = (g.tags || []).slice(0, 4).map((t) => el("span", { class: "chip", text: t }));
    const hostCount = (g.downloadLinks || []).length;
    const extraCount = (g.extraDownloadLinks || []).length + (g.patchDownloadLinks || []).length;

    return el("article", { class: "card", onclick: () => openModal(g) }, [
      cover,
      el("div", { class: "card-body" }, [
        el("div", { class: "card-title", text: g.title || g.slug }),
        el("div", { class: "card-sub" }, [
          statusBadge(g.status),
          g.rating && el("span", { text: `★ ${g.rating}` }),
          g.releaseDate && el("span", { text: g.releaseDate }),
        ]),
        tags.length ? el("div", { class: "chips" }, tags) : null,
        el("div", { class: "card-foot" }, [
          el("span", { text: `${hostCount} host${hostCount === 1 ? "" : "s"}` }),
          extraCount ? el("span", { text: `+${extraCount} patch/extra` }) : null,
          (g.installers || []).length
            ? el("span", { text: `${g.installers.length} installer files` })
            : null,
        ]),
      ]),
    ]);
  }

  function render() {
    const list = currentView();
    els.count.textContent = `${games.length} saved · ${list.length} shown`;
    els.grid.replaceChildren(...list.map(card));
    els.grid.hidden = list.length === 0;
    els.noResults.hidden = !(games.length && list.length === 0);
  }

  // ---- modal -----------------------------------------------------------------

  function linkGroups(title, groups) {
    if (!groups || !groups.length) return null;
    const body = groups.map((d) =>
      el("div", { class: "host-group" }, [
        el("div", { class: "host-name", text: d.label || d.host }),
        ...d.links.map((l) =>
          el("div", { class: "linkrow" }, [
            el("a", { href: l.url, target: "_blank", rel: "noreferrer", text: l.filename || l.url }),
            copyBtn(l.url),
          ])
        ),
      ])
    );
    return section(title, body);
  }

  function fileList(title, files) {
    if (!files || !files.length) return null;
    return section(
      `${title} (${files.length})`,
      files.map((f) =>
        el("div", { class: "filerow" }, [
          el("span", { class: "fname", text: f.filename }),
          el("span", { class: "size", text: f.size }),
        ])
      )
    );
  }

  function section(title, children) {
    return el("div", { class: "section" }, [el("h3", { text: title }), ...[].concat(children)]);
  }

  function copyBtn(value) {
    return el("button", { class: "copy", text: "Copy", onclick: () => copy(value) });
  }

  function openModal(g) {
    const meta1 = el("div", { class: "meta-line" }, [
      statusBadge(g.status),
      g.rating && el("span", { text: `★ ${g.rating}` }),
      g.releaseDate && el("span", { text: `📅 ${g.releaseDate}` }),
      g.ranking && el("span", { text: `🔥 ${g.ranking}` }),
    ]);
    const meta2 = el("div", { class: "meta-line" }, [
      g.developer && el("span", { text: `⚙ ${g.developer}` }),
      g.publisher && el("span", { text: `📖 ${g.publisher}` }),
    ]);

    const versionLine =
      g.currentVersion || g.latestVersion || g.lastChecked
        ? el("div", { class: "meta-line" }, [
            g.currentVersion && el("span", { text: `Current: ${g.currentVersion}` }),
            g.latestVersion && el("span", { text: `Latest: ${g.latestVersion}` }),
            g.lastChecked && el("span", { text: `Checked: ${g.lastChecked}` }),
          ])
        : null;

    const links = el("div", { class: "linkbtns" }, [
      g.url && el("a", { class: "pill", href: g.url, target: "_blank", rel: "noreferrer", text: "gog-games page" }),
      g.gogUrl && el("a", { class: "pill", href: g.gogUrl, target: "_blank", rel: "noreferrer", text: "GOG.com" }),
      g.gogdbUrl && el("a", { class: "pill", href: g.gogdbUrl, target: "_blank", rel: "noreferrer", text: "GOGDB" }),
      g.torrent && el("a", { class: "pill torrent", href: g.torrent, text: "🧲 Torrent" }),
      g.torrent && copyBtn(g.torrent),
    ]);

    const genresTags = el("div", { class: "meta-line" }, [
      (g.genres || []).length && el("span", { text: `Genres: ${(g.genres || []).join(", ")}` }),
    ]);
    const tagChips = (g.tags || []).length
      ? el("div", { class: "chips" }, g.tags.map((t) => el("span", { class: "chip", text: t })))
      : null;

    const body = el("div", {}, [
      el("button", { class: "modal-close", text: "✕", "data-close": "1" }),
      el("h2", { class: "modal-title", text: g.title || g.slug }),
      meta1,
      meta2,
      versionLine,
      links,
      genresTags,
      tagChips,
      g.description ? section("Description", el("p", { text: g.description })) : null,
      linkGroups("Game download links", g.downloadLinks),
      linkGroups("Patch download links", g.patchDownloadLinks),
      linkGroups("Extra download links", g.extraDownloadLinks),
      fileList("Game installers", g.installers),
      fileList("Extras", g.extras),
      g.savedAt
        ? el("p", { class: "muted", style: "margin-top:20px;font-size:12px",
            text: `Saved ${new Date(g.savedAt).toLocaleString()}` })
        : null,
    ]);

    els.modalBody.replaceChildren(...[...body.childNodes]);
    els.modal.hidden = false;
  }

  function closeModal() {
    els.modal.hidden = true;
  }

  // ---- clipboard + toast -----------------------------------------------------

  function copy(text) {
    const done = () => toast("Copied to clipboard");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = el("textarea", { style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      toast("Copy failed — select and copy manually.");
    }
    ta.remove();
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 2200);
  }

  // ---- events ----------------------------------------------------------------

  els.search.addEventListener("input", render);
  els.status.addEventListener("change", render);
  els.sort.addEventListener("change", render);

  $("#load-btn").addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));
  els.clearBtn.addEventListener("click", clearData);

  els.modal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Drag & drop anywhere.
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    els.drop.hidden = false;
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) els.drop.hidden = true;
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.drop.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  tryAutoLoad();
})();
