/* GOG Games Saver — content script
 * Injects a "Save game" button into each game detail modal on gog-games.to,
 * scrapes the visible game data and stores it (deduped by slug) in extension storage.
 */
(() => {
  "use strict";

  // Cross-browser storage handle (Firefox: browser.*, Chrome: chrome.*).
  const ext = globalThis.browser ?? globalThis.chrome;
  const store = ext.storage.local;

  const BTN_ID = "ggs-save-btn";

  // ---- helpers ---------------------------------------------------------------

  const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, " ") : "");

  // Read a labelled value like <div title="Rating"><span>3.2/5</span></div>
  const byTitle = (root, title, sel = "span") => {
    const host = root.querySelector(`[title="${title}"]`);
    return host ? text(host.querySelector(sel) || host) : "";
  };

  const listByTitle = (root, title) =>
    [...root.querySelectorAll(`[title="${title}"] a`)]
      .map((a) => text(a))
      .filter(Boolean);

  const slugFromUrl = () => {
    const m = location.pathname.match(/\/game\/([^/?#]+)/);
    return m ? m[1] : "";
  };

  // ---- scraping --------------------------------------------------------------

  // Find a section wrapper by its visible heading ("GAME DOWNLOAD LINKS",
  // "EXTRA DOWNLOAD LINKS", "GAME INSTALLERS", "EXTRAS"). Anchoring on the
  // heading text is more robust than the hashed/guessed wrapper class names.
  function sectionByHeading(root, heading) {
    const target = heading.toUpperCase();
    const p = [...root.querySelectorAll("p")].find(
      (el) => text(el).toUpperCase() === target
    );
    if (!p) return null;
    // <section><div.border-b><p>HEADING</p></div> ...items... </section>
    return p.closest('[class*="game-section-with-"]') || p.parentElement?.parentElement || null;
  }

  // Parse an accordion download-links section: one <details ... item-accordion-<host>> per host.
  function parseAccordion(section) {
    if (!section) return [];
    return [...section.querySelectorAll('details[class*="item-accordion-"]')].map((d) => {
      const hostLabel = text(d.querySelector("summary p"));
      const cls = [...d.classList].find((c) => c.startsWith("item-accordion-")) || "";
      const host = cls.replace("item-accordion-", "");
      const links = [...d.querySelectorAll("a[href]")].map((a) => ({
        url: a.href,
        filename: a.getAttribute("title") || text(a),
      }));
      return { host: host || hostLabel, label: hostLabel, links };
    });
  }

  // Parse a file-list section (installers / extras): rows of name + size spans.
  function parseFileList(section) {
    if (!section) return [];
    return [...section.querySelectorAll("div.flex.justify-between")].map((row) => {
      const spans = row.querySelectorAll("span");
      return {
        filename: spans[0] ? spans[0].getAttribute("title") || text(spans[0]) : "",
        size: spans[1] ? spans[1].getAttribute("title") || text(spans[1]) : "",
      };
    });
  }

  function scrapeGame(root) {
    const downloadLinks = parseAccordion(sectionByHeading(root, "GAME DOWNLOAD LINKS"));
    const extraDownloadLinks = parseAccordion(sectionByHeading(root, "EXTRA DOWNLOAD LINKS"));
    const installers = parseFileList(sectionByHeading(root, "GAME INSTALLERS"));
    const extras = parseFileList(sectionByHeading(root, "EXTRAS"));

    // Status badge text ("Out-of-date" / "Up-to-date") only appears in the badge.
    const statusMatch = root.textContent.match(/Out-of-date|Up-to-date/);

    const torrentEl = root.querySelector('a[href^="magnet:"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const metaDesc = document.querySelector('meta[name="description"]');

    return {
      slug: slugFromUrl(),
      url: location.origin + location.pathname,
      title: text(root.querySelector(".game-info-title.text-3xl")),
      rating: byTitle(root, "Rating"),
      releaseDate: byTitle(root, "Release Date"),
      ranking: byTitle(root, "Popularity Ranking"),
      developer: byTitle(root, "Developer", "a"),
      publisher: byTitle(root, "Publisher", "a"),
      genres: listByTitle(root, "Genres"),
      tags: listByTitle(root, "Tags"),
      status: statusMatch ? statusMatch[0] : "",
      torrent: torrentEl ? torrentEl.href : "",
      downloadLinks,
      extraDownloadLinks,
      installers,
      extras,
      coverImage: ogImage ? ogImage.content : "",
      description: metaDesc ? metaDesc.content : "",
      savedAt: new Date().toISOString(),
    };
  }

  // ---- persistence -----------------------------------------------------------

  async function saveGame(game) {
    if (!game.slug && !game.title) throw new Error("Could not read game data");
    const key = game.slug || game.title;
    const { games = {} } = await store.get("games");
    games[key] = game;
    await store.set({ games });
    return Object.keys(games).length;
  }

  async function isSaved(slug) {
    if (!slug) return false;
    const { games = {} } = await store.get("games");
    return Boolean(games[slug]);
  }

  // ---- button ----------------------------------------------------------------

  function makeButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "ggs-save-btn";
    btn.textContent = "💾 Save game";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const root = document.querySelector(".game-info");
      if (!root) return;
      try {
        const game = scrapeGame(root);
        const count = await saveGame(game);
        btn.textContent = `✓ Saved (${count} total)`;
        btn.classList.add("ggs-saved");
      } catch (err) {
        btn.textContent = "⚠ " + err.message;
        btn.classList.add("ggs-error");
      }
    });
    return btn;
  }

  function injectInto(root) {
    if (root.querySelector("#" + BTN_ID)) return; // already injected
    const btn = makeButton();

    // Insert synchronously (no await before this) so rapid MutationObserver
    // fires can't slip past the guard above and create duplicate buttons.
    // Placement, most to least preferred:
    //   1. the action-button row (holds Torrent and/or "Vote for re-upload")
    //   2. right after the Up-to-date/Out-of-date status badge (always present)
    //   3. after the title (last resort)
    const actionRow = root.querySelector(".flex.flex-wrap.gap-4");
    const statusBadge = [...root.querySelectorAll("div")].find((d) =>
      /^(Up-to-date|Out-of-date)/.test(text(d))
    );
    if (actionRow) {
      actionRow.appendChild(btn);
    } else if (statusBadge) {
      btn.style.marginLeft = "0";
      btn.style.marginTop = "12px";
      statusBadge.insertAdjacentElement("afterend", btn);
    } else {
      const title = root.querySelector(".game-info-title.text-3xl");
      (title || root).insertAdjacentElement("afterend", btn);
    }

    // Then reflect "already in collection" state asynchronously.
    isSaved(slugFromUrl()).then((saved) => {
      if (saved && !btn.classList.contains("ggs-saved")) {
        btn.textContent = "✓ Saved (click to update)";
        btn.classList.add("ggs-saved");
      }
    });
  }

  // ---- observe SPA navigation (modal opens/closes without full reload) --------

  function scan() {
    const root = document.querySelector(".game-info");
    if (root) injectInto(root);
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
})();
