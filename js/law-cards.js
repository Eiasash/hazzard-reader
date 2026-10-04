/* Source-cited study metadata; deliberately outside saved highlight/drill units. */
window.HazzardLawCards = (() => {
  let promise;
  function read() {
    return promise ||= fetch('data/law-cards.json').then(response => {
      if (!response.ok) throw Error('Law cards unavailable. Reconnect and retry.');
      return response.json();
    }).catch(error => { promise = null; throw error; });
  }
  async function questionLinks(host, id) {
    try {
      const data = await read();
      if (host.dataset.bankId !== id || host.querySelector('.law-question-links')) return;
      const links = document.createElement('div'); links.className = 'exam-evidence law-question-links';
      for (const card of data.cards.filter(c => c.imaItem && c.questions.some(q => q.id === id))) {
        const link = document.createElement('a'); link.dir = 'auto';
        link.href = '?chapter=laws&lawCard=' + encodeURIComponent(card.id) + '#law-card-' + encodeURIComponent(card.id);
        link.textContent = 'IMA ' + card.imaItem + ' · ' + card.title;
        links.append(link);
      }
      if (links.childElementCount) host.querySelector('.mcq-source').before(links);
    } catch { /* The question remains usable if optional card metadata is unavailable. */ }
  }
  async function decorate(copy) {
    if (copy.dataset.chapterId !== 'laws' || copy.querySelector('.law-cards')) return;
    const panel = document.createElement('details');
    panel.className = 'law-cards'; panel.dataset.readerMetadata = 'law-cards';
    const summary = document.createElement('summary'); summary.textContent = 'Law cards · IMA required reading';
    const body = document.createElement('div'); body.className = 'law-cards-body';
    panel.append(summary, body); copy.prepend(panel);
    async function load() {
      body.textContent = 'Loading law cards…';
      try {
        const data = await read();
        const fragment = document.createDocumentFragment();
        if (data.requiredReading) {
          const note = document.createElement('p'); note.className = 'law-card-source';
          note.textContent = data.requiredReading.document + ' · pp. 2–3. ' + data.requiredReading.note;
          fragment.append(note);
        }
        for (const card of [...data.cards].sort((a,b) => (a.imaItem || 100) - (b.imaItem || 100))) {
          const section = document.createElement(card.imaItem ? 'details' : 'section'); section.className = 'law-card';
          section.id = 'law-card-' + card.id;
          if (card.imaItem) section.dir = 'rtl';
          const heading = document.createElement(card.imaItem ? 'summary' : 'h2');
          heading.textContent = (card.imaItem ? card.imaItem + '. ' : '') + card.title;
          const list = document.createElement('ul');
          for (const text of card.bullets) {
            const line = document.createElement('li'); line.textContent = text; list.append(line);
          }
          section.append(heading, list);
          if (card.provenance) {
            const provenance = document.createElement('p'); provenance.className = 'law-card-source';
            provenance.dir = 'ltr'; provenance.textContent = card.provenance; section.append(provenance);
          }
          if (card.gap) {
            const gap = document.createElement('p'); gap.className = 'law-card-gap'; gap.textContent = card.gap;
            section.append(gap);
          }
          for (const source of card.sources) {
            const line = document.createElement('p'); line.className = 'law-card-source';
            line.textContent = 'Source: ' + source.document + ' — ' + source.locator;
            section.append(line);
          }
          const links = document.createElement('div'); links.className = 'exam-evidence';
          for (const question of card.questions) {
            const link = document.createElement('a');
            link.href = HazzardEvidence.questionURL(question.id);
            link.textContent = 'Examined: ' + HazzardEvidence.label(question);
            link.title = question.reference;
            links.append(link);
          }
          if (card.questions.length) section.append(links);
          else {
            const note = document.createElement('p'); note.className = 'law-card-source';
            note.textContent = 'No matching official question identified for this item.';
            section.append(note);
          }
          fragment.append(section);
        }
        body.replaceChildren(fragment);
        const selected = new URL(location.href).searchParams.get('lawCard');
        const target = selected && [...body.children].find(e => e.id === 'law-card-' + selected);
        if (target) {
          panel.open = true;
          if (target.tagName === 'DETAILS') target.open = true;
          requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
        }
      } catch (error) {
        const message = document.createElement('p'); message.setAttribute('role', 'alert');
        message.textContent = error.message || 'Law cards could not be loaded.';
        const retry = document.createElement('button'); retry.textContent = 'Retry law cards';
        retry.onclick = load; body.replaceChildren(message, retry);
      }
    }
    await load();
  }
  return {decorate, questionLinks};
})();
