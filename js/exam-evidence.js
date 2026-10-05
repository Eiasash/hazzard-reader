/* Citation metadata is separate from imported questions and answer stores. */
window.HazzardEvidence = (() => {
  let promise;
  function load() {
    return promise ||= fetch('data/mcq/exam-references.json').then(r => {
      if (!r.ok) throw Error('Exam references unavailable. Reconnect and reload.');
      return r.json();
    }).catch(e => { promise = null; throw e; });
  }
  const sittingLabel = sitting => {const [year,month]=sitting.split('-');const months={Jan:'January',Feb:'February',Mar:'March',Apr:'April',May:'May',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Oct:'October',Nov:'November',Dec:'December'};return (months[month]?months[month]+' ':'')+year;};
  const label = entry => sittingLabel(entry.sitting) + ' Q' + entry.number;
  // Reuse the exact v55 Study membership, including its labelled legacy fallback.
  function studyIds(data, chapter) {
    if (data.study[chapter]) return data.study[chapter].ids;
    // Read-only chapters reuse resolved citation membership without changing the sidecar.
    return /^\d+$/.test(chapter) ? Object.entries(data.questions).filter(([,entry]) => entry.status === 'resolved' && entry.chapters.includes(String(chapter))).map(([id]) => id) : [];
  }
  function counts(data, chapter) {
    const totals = new Map();
    for (const id of new Set(studyIds(data, chapter))) {
      const entry = data.questions[id];
      if (entry) totals.set(entry.sitting, (totals.get(entry.sitting) || 0) + 1);
    }
    const month = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const date = sitting => Number(sitting.slice(0,4))*100+(month[sitting.split('-')[1]]||0);
    return [...totals].sort((a,b) => date(b[0])-date(a[0]));
  }
  async function citationLine(chapter, open) {
    const data = await load(), entries = counts(data, chapter);
    if (!entries.length) return null;
    const link = document.createElement('a');
    link.className = 'chapter-exams'; link.href = '?chapter='+chapter+(data.study[chapter]?'s':'')+'&view=questions&source=past';
    link.append('Exams: ');
    for (const [i, [sitting, count]] of entries.entries()) {
      if (i) link.append(' · ');
      const span = document.createElement('span'), [year, month] = sitting.split('-');
      span.textContent = (['2024','2021'].includes(year) && month ? month+' ' : '')+year+(count>1?' ×'+count:'');
      if (year === '2026') span.className = 'chapter-exams-latest';
      link.append(span);
    }
    if (open) link.onclick = event => {event.preventDefault();open();};
    return link;
  }
  const questionURL = id => '?chapter=bank&q=' + encodeURIComponent(HazzardMCQ.currentId(id));
  function openPage(page, view) {
    // The source history entry holds its own view, including Study/mock context.
    // A browser Back never writes an answer or changes a saved paper's identity.
    history.replaceState({...history.state, mcqView: view}, '');
    const url = new URL(location.href);
    url.search = ''; url.searchParams.set('chapter', page.readerChapter || page.chapter);
    url.searchParams.set('examBack', '1'); url.hash = 'p' + page.page;
    location.assign(url);
  }
  async function decorate(copy, chapter) {
    const data = await load(), byPage = new Map();
    for (const [id, entry] of Object.entries(data.questions)) {
      if (entry.status !== 'resolved') continue;
      for (const p of entry.pages) {
        if ((p.readerChapter || p.chapter) !== chapter || !p.available) continue;
        if (!byPage.has(p.page)) byPage.set(p.page, []);
        byPage.get(p.page).push([id, entry]);
      }
    }
    for (const marker of copy.querySelectorAll('a.pg')) {
      const entries = byPage.get(Number(marker.dataset.page));
      if (!entries?.length) continue;
      const badge = document.createElement('span');
      badge.className = 'exam-evidence'; badge.dataset.readerMetadata = 'exam';
      badge.setAttribute('aria-label', 'Asked here, page ' + marker.dataset.page);
      for (const [id, entry] of entries) {
        const link = document.createElement('a');
        link.href = questionURL(id); link.textContent = 'Asked: ' + label(entry);
        badge.append(link);
      }
      marker.classList.add('exam-page-marker');marker.after(badge);
    }
  }
  function backControl(viewport) {
    if (new URL(location.href).searchParams.get('examBack') !== '1') return;
    const bar = document.createElement('div');bar.className = 'exam-return';
    const button = document.createElement('button');button.textContent = 'Back to question';
    button.onclick = () => history.back();bar.append(button);viewport.append(bar);viewport.classList.add('has-exam-return');
  }
  return {sittingLabel,load, label, questionURL, openPage, decorate, backControl,studyIds,counts,citationLine};
})();
