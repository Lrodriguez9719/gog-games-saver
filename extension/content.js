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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Dispatch a pointer/mouse event React will recognise (it delegates the
  // over/out variants to implement onMouseEnter/onMouseLeave).
  function fireMouse(el, type, bubbles) {
    const Evt =
      type.startsWith("pointer") && typeof PointerEvent === "function"
        ? PointerEvent
        : MouseEvent;
    el.dispatchEvent(
      new Evt(type, { bubbles, cancelable: true, view: window, pointerType: "mouse" })
    );
  }
  const hover = (el) =>
    ["pointerover", "pointerenter", "mouseover", "mouseenter"].forEach((t) =>
      fireMouse(el, t, t.endsWith("over"))
    );
  const unhover = (el) =>
    ["pointerout", "pointerleave", "mouseout", "mouseleave"].forEach((t) =>
      fireMouse(el, t, t.endsWith("out"))
    );

  // Current/Latest Version and Last Checked live in a popover the site mounts
  // when the status badge is clicked (and unmounts when the popover is left).
  // Click it open, read it, then close it again to restore the page.
  async function readVersionInfo(root) {
    const empty = { currentVersion: "", latestVersion: "", lastChecked: "" };

    // The popover shares the .shadow-lg.drop-shadow-lg class with the "More"
    // links menu, so identify it by the one containing the version labels.
    const findPanel = () =>
      [...document.querySelectorAll(".shadow-lg.drop-shadow-lg")].find((el) =>
        el.textContent.includes("Current Version")
      );

    // The clickable badge: among elements whose text starts with the status
    // word, the wrapper and the inner badge are identical, but the click
    // handler sits on the inner one. Prefer the element with cursor:pointer,
    // else the deepest (most nested) candidate.
    const depth = (el) => {
      let d = 0;
      for (let n = el; n; n = n.parentElement) d++;
      return d;
    };
    const candidates = [...root.querySelectorAll("div, span, button")].filter((n) =>
      /^(Up-to-date|Out-of-date)/.test(text(n))
    );
    const badge =
      candidates.find((n) => n.style && n.style.cursor === "pointer") ||
      candidates.sort((a, b) => depth(b) - depth(a))[0];
    if (!badge) return empty;

    let panel = findPanel();
    let openedByUs = false;

    if (!panel) {
      badge.click(); // open
      openedByUs = true;
      for (let i = 0; i < 25 && !(panel = findPanel()); i++) await sleep(30);
      if (!panel) {
        // Fallback: some badges may be hover-driven instead.
        [badge, badge.parentElement].filter(Boolean).forEach(hover);
        for (let i = 0; i < 15 && !(panel = findPanel()); i++) await sleep(30);
      }
    }
    if (!panel) return empty;

    // Each row: <div class="flex items-center"><span>Label</span><span>Value</span></div>
    const readRow = (label) => {
      const cell = [...panel.querySelectorAll("*")].find(
        (n) => n.children.length === 0 && text(n) === label
      );
      if (cell && cell.nextElementSibling) return text(cell.nextElementSibling);
      return "";
    };
    const info = {
      currentVersion: readRow("Current Version"),
      latestVersion: readRow("Latest Version"),
      lastChecked: readRow("Last Checked"),
    };

    // Close it again: the popover closes on mouse-leave, so dispatch that;
    // also click the badge once more in case it toggles.
    if (openedByUs) {
      unhover(panel);
      badge.click();
    }
    return info;
  }

  // The cover art is injected as a <style> rule for .game-info-bg-img that lives
  // inside THIS modal's wrapper (the parent of .game-info). We must read it from
  // that scoped <style> — not getComputedStyle — because the .game-info-bg-img
  // class is global and collides across games as you browse the SPA, so the
  // computed value would be some other game's cover.
  const COVER_RE = /\.game-info-bg-img\s*\{[^}]*background-image:\s*url\(["']?(.*?)["']?\)/i;
  function getCoverImage(root) {
    // Tightest ancestor that actually contains this game's background element.
    let scope = root.parentElement;
    for (let n = root.parentElement; n; n = n.parentElement) {
      if (n.querySelector(".game-info-bg-img")) {
        scope = n;
        break;
      }
    }
    if (scope) {
      // If the wrapper ever holds more than one matching block, the last one is
      // the most recently rendered (current game).
      const matches = [...scope.querySelectorAll("style")].filter((s) =>
        COVER_RE.test(s.textContent)
      );
      const styleEl = matches[matches.length - 1];
      const m = styleEl && styleEl.textContent.match(COVER_RE);
      if (m && m[1]) return m[1];
    }
    const og = document.querySelector('meta[property="og:image"]');
    return og && og.content ? og.content : "";
  }

  async function scrapeGame(root) {
    const downloadLinks = parseAccordion(sectionByHeading(root, "GAME DOWNLOAD LINKS"));
    const patchDownloadLinks = parseAccordion(sectionByHeading(root, "PATCH DOWNLOAD LINKS"));
    const extraDownloadLinks = parseAccordion(sectionByHeading(root, "EXTRA DOWNLOAD LINKS"));
    const installers = parseFileList(sectionByHeading(root, "GAME INSTALLERS"));
    const extras = parseFileList(sectionByHeading(root, "EXTRAS"));

    // Status badge text ("Out-of-date" / "Up-to-date") only appears in the badge.
    const statusMatch = root.textContent.match(/Out-of-date|Up-to-date/);
    const version = await readVersionInfo(root);

    const torrentEl = root.querySelector('a[href^="magnet:"]');
    const gogdbEl = root.querySelector('a[href*="gogdb.org"]');
    const gogEl = root.querySelector('a[href*="gog.com/game"]');

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
      currentVersion: version.currentVersion,
      latestVersion: version.latestVersion,
      lastChecked: version.lastChecked,
      gogUrl: gogEl ? gogEl.href : "",
      gogdbUrl: gogdbEl ? gogdbEl.href : "",
      torrent: torrentEl ? torrentEl.href : "",
      downloadLinks,
      patchDownloadLinks,
      extraDownloadLinks,
      installers,
      extras,
      coverImage: getCoverImage(root),
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

  // True once the extension has been reloaded/updated while this page stayed
  // open — the content script is orphaned and any chrome.* call throws
  // "Extension context invalidated". The only cure is reloading the page.
  function contextInvalidated(err) {
    if (err && /context invalidated|Extension context/i.test(err.message)) return true;
    try {
      return !ext.runtime || !ext.runtime.id;
    } catch (e) {
      return true;
    }
  }

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
        btn.textContent = "… saving";
        const game = await scrapeGame(root);
        const count = await saveGame(game);
        btn.textContent = `✓ Saved (${count} total)`;
        btn.classList.add("ggs-saved");
      } catch (err) {
        btn.classList.add("ggs-error");
        if (contextInvalidated(err)) {
          btn.textContent = "↻ Refresh page (extension updated)";
          btn.title = "The extension was reloaded; refresh this page (F5), then save.";
          btn.onclick = () => location.reload();
        } else {
          btn.textContent = "⚠ " + err.message;
        }
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
