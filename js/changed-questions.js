/* Derived release collection. Reads answer timestamps; never writes storage. */
window.HazzardChanged = (() => {
  let data, loading;
  function pending(entries, answers) {
    const latest = new Map();
    for (const entry of entries) {
      const at = Date.parse(entry.changedAt);
      if (!Number.isFinite(at)) throw Error('Changed question date unavailable');
      if (!latest.has(entry.id) || at > latest.get(entry.id).at) latest.set(entry.id, {...entry, at});
    }
    return [...latest.values()].filter(q => {
      const answer = answers[q.id];
      return !(answer?.checked && Number.isInteger(answer.selected) && Number.isFinite(answer.at) && answer.at > q.at);
    });
  }
  async function load() {
    if (data) return data;
    return loading ||= fetch('data/changelog.json').then(async response => {
      if (!response.ok) throw Error('Changed questions unavailable');
      const value = await response.json();
      data = value.releases.filter(r => ['v72','v73'].includes(r.version)).flatMap(r => r.redoQuestions || []);
      if (!data.length) throw Error('Changed questions unavailable');
      return data;
    }).catch(error => { data = null; loading = null; throw error; });
  }
  async function refresh() {
    const host = document.getElementById('changedQuestions');
    if (!host) return;
    try {
      const entries = await load();
      await HazzardMCQ.loadAliases();
      const questions = pending(entries, answers()).sort((a,b)=>a.label.localeCompare(b.label,'en',{numeric:true}));
      const label = 'Changed questions: ' + questions.length + ' to redo';
      const tab = document.querySelector('#appTabs [data-tab="practice"]');
      let badge = tab?.querySelector('.changed-count');
      if (tab && !badge) { badge = document.createElement('small'); badge.className = 'changed-count'; tab.append(badge); }
      if (badge) { badge.textContent = questions.length ? questions.length + ' to redo' : ''; badge.hidden = !questions.length; }
      tab?.setAttribute('aria-label', questions.length ? 'Practice — ' + label : 'Practice');
      const details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = questions.length ? label : 'Changed questions — all done';
      details.className = 'changed-questions'; details.open = host.querySelector('details')?.open || false;
      details.append(summary);
      const note = document.createElement('p');
      note.textContent = 'Changed questions - redo. Answer each question again after its latest change to remove it from this list.';
      details.append(note);
      const list = document.createElement('ul'); list.className = 'rows';
      for (const q of questions) {
        const row = document.createElement('li'), link = document.createElement('a');
        link.href = '?chapter=bank&redo=1&q=' + encodeURIComponent(q.id);
        link.textContent = q.label + ' — redo this question'; row.append(link); list.append(row);
      }
      details.append(list); host.replaceChildren(details);
    } catch {
      host.textContent = 'Changed questions could not be read. ';
      const retry = document.createElement('button'); retry.textContent = 'Try again'; retry.onclick = refresh; host.append(retry);
    }
  }
  const pane = document.querySelector('[data-pane="practice"]');
  if (pane) {
    const host = document.createElement('div'); host.id = 'changedQuestions'; pane.prepend(host);
    new MutationObserver(() => { if (!pane.hidden) refresh(); }).observe(pane, {attributes:true,attributeFilter:['hidden']});
  }
  addEventListener('pageshow', refresh);
  addEventListener('hazzard-reader-ready', refresh);
  addEventListener('storage', event => { if (event.key === HazzardMCQ.KEY || event.key === null) refresh(); });
  addEventListener('hazzard-review-change', () => queueMicrotask(refresh));
  function answers() {
    const value = JSON.parse(localStorage.getItem(HazzardMCQ.KEY) || '{"answers":{}}');
    if (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) throw Error('Answers unavailable');
    const result = {};
    for (const [id, answer] of Object.entries(value.answers)) {
      const canonical = HazzardMCQ.currentId(id);
      if (!result[canonical] || (answer?.at ?? -1) > (result[canonical]?.at ?? -1)) result[canonical] = answer;
    }
    return result;
  }
  return {pending, load, answers, refresh};
})();
