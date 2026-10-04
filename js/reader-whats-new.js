/* Release notes are read-only; only the viewed release is device-local. */
(() => {
  const KEY = 'hazzard-whats-new-seen-v1';
  const button = document.getElementById('whatsNewButton');
  const pane = document.querySelector('[data-pane="whatsNew"]');
  const list = document.getElementById('whatsNewList');
  let releases, loading = false, renderedVersion = '', seen = '';
  try { seen = localStorage.getItem(KEY) || ''; } catch {}
  const version = () => window.HazzardRelease?.version || '';
  function dot() {
    button.textContent = version() + ' · What’s new';
    document.querySelector('#appTabs [data-tab="tools"]')?.classList.toggle('has-new-release', !!version() && seen !== version());
  }
  function markVisible() {
    requestAnimationFrame(() => {
      if (!pane.hidden && document.getElementById('panel').open && list.getClientRects().length && renderedVersion === version()) {
        seen = version();
        try { localStorage.setItem(KEY, seen); } catch {}
        dot();
      }
    });
  }
  async function show() {
    if (pane.hidden) return;
    if (releases) { markVisible(); return; }
    if (loading) return;
    loading = true; list.textContent = 'Loading release notes…';
    try {
      const response = await fetch('data/changelog.json');
      if (!response.ok) throw Error('Release notes unavailable');
      const data = await response.json();
      if (data.schema !== 1 || !Array.isArray(data.releases) || !data.releases.length || data.releases[0].version !== version()) throw Error('Release notes unavailable');
      const fragment = document.createDocumentFragment();
      for (const release of data.releases) {
        if (typeof release.version !== 'string' || typeof release.date !== 'string' || !Array.isArray(release.changes) || !release.changes.every(c => typeof c === 'string')) throw Error('Release notes unavailable');
        const section = document.createElement('section'), heading = document.createElement('h3'), ul = document.createElement('ul');
        section.className = 'release-entry';
        heading.textContent = release.version + (release.date ? ' · ' + release.date.split('-').reverse().join('.') : '');
        section.append(heading, ul);
        for (const change of release.changes) { const li = document.createElement('li'); li.textContent = change; ul.append(li); }
        fragment.append(section);
      }
      list.replaceChildren(fragment); releases = data.releases; renderedVersion = releases[0].version; markVisible();
    } catch {
      list.textContent = 'Release notes could not be loaded. ';
      const retry = document.createElement('button'); retry.textContent = 'Try again'; retry.onclick = show; list.append(retry);
    } finally { loading = false; }
  }
  new MutationObserver(show).observe(pane, {attributes: true, attributeFilter: ['hidden']});
  addEventListener('pageshow', () => { dot(); show(); });
  addEventListener('hazzard-reader-ready', dot);
  addEventListener('storage', event => { if (event.key === KEY) { seen = event.newValue || ''; dot(); } });
  dot();
})();
