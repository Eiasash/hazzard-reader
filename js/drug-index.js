/* Read-only navigation. Names/classes come from the book; no answer-store writes. */
window.HazzardDrugs = (() => {
  let pending;
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase().replace(/[‐‑–—−]/g, '-');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function load() {
    return pending ||= fetch('data/drug-index.json').then(response => {
      if (!response.ok) throw Error('Drug index unavailable. Reconnect and retry.');
      return response.json();
    }).catch(error => { pending = null; throw error; });
  }
  function passageURL(p) {
    return '?chapter=' + encodeURIComponent(p.chapter) + '#' + encodeURIComponent(p.anchor);
  }
  function locationLabel(p) {
    return 'Ch ' + p.chapter.replace(/s$/, '') + (p.kind === 'study' ? ' study' : '') +
      ' · ' + (/^p\d+$/.test(p.anchor) ? 'p' + p.anchor.slice(1) + ' · ' : '') + p.section;
  }
  async function mount(copy) {
    copy.classList.add('drug-index');
    const panel = el('section'); panel.dataset.readerMetadata = 'drugs';
    panel.innerHTML = '<p class="drug-intro">Find a drug or class across the book and study pages.</p>' +
      '<label for="drugSearch">Generic, book brand or class</label><input id="drugSearch" type="search" autocomplete="off" placeholder="e.g. metformin, Ventolin, SSRI">' +
      '<div class="drug-filters"><label for="drugKind">Show</label><select id="drugKind"><option value="all">Drugs + classes</option><option value="drug">Drugs</option><option value="class">Classes</option></select></div>' +
      '<p id="drugStatus" role="status" aria-live="polite">Loading drug index…</p>' +
      '<details class="drug-method"><summary>What is included?</summary><p>Names, class labels and brand aliases are sourced to Hazzard 8e. Book passages and study summaries are labelled separately. Open the source for context.</p>' +
      '<p>Official questions match a name in the stem or an accepted keyed option. Distractors, explanations, all-answer appeal options and reviewed incidental medication-list mentions are excluded. A class mention does not create a match for each member drug. Question labels do not reveal the answer.</p>' +
      '<p>Coverage is limited to sourced entries in the built chapters and study summaries, including checked drug-table images. Chapter 22 is not built. References and recall drills are excluded. No drug advice or current prescribing guidance is added.</p></details><div id="drugResults"></div>';
    copy.append(panel);
    const input = panel.querySelector('#drugSearch'), kind = panel.querySelector('#drugKind');
    const status = panel.querySelector('#drugStatus'), results = panel.querySelector('#drugResults');
    const params = new URL(location.href).searchParams;
    input.value = params.get('drugSearch') || '';
    kind.value = ['drug', 'class'].includes(params.get('drugKind')) ? params.get('drugKind') : 'all';
    function remember(id) {
      const url = new URL(location.href);
      for (const [key, value] of [['drugSearch', input.value.trim()], ['drugKind', kind.value === 'all' ? '' : kind.value], ['drug', id || '']]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      history.replaceState(history.state, '', url);
    }
    function detailsFor(entry, body) {
      if (entry.aliases.length) body.append(el('p', 'Book aliases: ' + entry.aliases.join(' · '), 'drug-aliases'));
      for (const [type, heading] of [['chapter', 'Book passages'], ['study', 'Study summaries']]) {
        const passages = entry.passages.filter(p => p.kind === type);
        if (!passages.length) continue;
        const group = el('details', '', 'drug-links'), summary = el('summary', heading + ' · ' + passages.length);
        group.append(summary); group.open = type === 'chapter';
        const list = el('ul');
        for (const p of passages) {
          const row = el('li'), link = el('a', locationLabel(p)); link.href = passageURL(p);
          row.append(link, el('p', (p.image ? 'Table name/class columns: ' : '') + p.excerpt, 'drug-excerpt')); list.append(row);
        }
        group.append(list); body.append(group);
      }
      const questions = el('details', '', 'drug-links');
      questions.append(el('summary', 'Official past questions · ' + entry.questions.length));
      if (!entry.questions.length) questions.append(el('p', 'No stem or keyed-option name match in the indexed official questions.'));
      else {
        const list = el('ul');
        for (const q of entry.questions) {
          const row = el('li'), link = el('a', q.sitting.replaceAll('-', ' ') + ' · Q' + q.number);
          link.href = HazzardEvidence.questionURL(q.id); row.append(link); list.append(row);
        }
        questions.append(list);
      }
      body.append(questions);
      const sources = el('details', '', 'drug-links drug-sources');
      sources.append(el('summary', 'Name / class sources'));
      for (const s of entry.sources) {
        const p = el('p'), link = el('a', 'Ch ' + s.chapter + ' · ' + (/^p\d+$/.test(s.anchor) ? s.anchor : 'section'));
        link.href = passageURL(s); p.append(link, el(s.image ? 'span' : 'q', (s.image ? 'Table name/class columns: ' : '') + s.quote)); sources.append(p);
      }
      body.append(sources);
    }
    async function render() {
      status.textContent = 'Loading drug index…';
      try {
        const data = await load();
        const words = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
        const classes = new Map(data.entries.filter(e => e.kind === 'class').map(e => [normalize(e.name), e.aliases.join(' ')]));
        const entries = data.entries.filter(e => (kind.value === 'all' || e.kind === kind.value) &&
          words.every(word => normalize([e.name, e.class, ...e.aliases,
            ...e.class.split(' / ').map(name => classes.get(normalize(name)) || '')].join(' ')).includes(word)));
        const fragment = document.createDocumentFragment();
        const selected = new URL(location.href).searchParams.get('drug');
        for (const entry of entries) {
          const row = el('details', '', 'drug-entry'); row.id = 'drug-' + entry.id;
          const summary = el('summary'), name = el('strong', entry.name), meta = el('span', entry.kind === 'class' ? 'Drug class' : entry.class, 'drug-class');
          summary.append(name, meta, el('small', entry.passages.length + ' passages · ' + entry.questions.length + ' questions'));
          const body = el('div', '', 'drug-body'); row.append(summary, body);
          let populated = false;
          row.addEventListener('toggle', () => {
            if (!row.isConnected) return;
            if (row.open && !populated) { detailsFor(entry, body); populated = true; }
            if (row.open) remember(entry.id);
            else if (new URL(location.href).searchParams.get('drug') === entry.id) remember('');
          });
          if (entry.id === selected) row.open = true;
          fragment.append(row);
        }
        if (!entries.length) fragment.append(el('p', 'No matching drug or class. Try a generic name or a shorter search.'));
        results.replaceChildren(fragment);
        status.textContent = entries.length + ' entries · ' + data.counts.drugs + ' drugs + ' + data.counts.classes + ' classes in the index';
      } catch (error) {
        status.textContent = error.message || 'Drug index could not be loaded.';
        const retry = el('button', 'Retry drug index'); retry.onclick = render;
        results.replaceChildren(retry);
      }
    }
    input.oninput = kind.onchange = () => { remember(''); render(); };
    await render();
  }
  return {mount};
})();
