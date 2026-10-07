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
      for (const card of [...data.cards, ...(data.articles?.cards || [])].filter(c => (c.imaItem || c.articleItem || c.citedInPastPapers || c.questions.some(q => q.id === id && q.showBasis)) && c.questions.some(q => q.id === id))) {
        const link = document.createElement('a'); link.dir = 'auto';
        link.href = '?chapter=laws&lawCard=' + encodeURIComponent(card.id) + '#law-card-' + encodeURIComponent(card.id);
        link.textContent = (card.articleItem ? 'IMA article ' + card.articleItem : card.imaItem ? 'IMA ' + card.imaItem : 'Cited source') + ' · ' + card.title;
        const question=card.questions.find(q=>q.id===id);
        if(question.note)link.textContent+=' · '+question.note;
        links.append(link);
      }
      if (links.childElementCount) (host.querySelector('.mcq-citations') || host).append(links);
    } catch { /* The question remains usable if optional card metadata is unavailable. */ }
  }
  async function decorate(copy) {
    if (copy.dataset.chapterId !== 'laws' || copy.querySelector('.law-cards')) return;
    await decoratePanel(copy, false);
    await decoratePanel(copy, true);
  }
  async function decoratePanel(copy, articles) {
    const panel = document.createElement('details');
    panel.className = 'law-cards' + (articles ? ' article-cards' : ''); panel.dataset.readerMetadata = articles ? 'article-cards' : 'law-cards';
    const summary = document.createElement('summary'); summary.textContent = articles ? 'Required articles (IMA P005-2026)' : 'Law cards · IMA required reading';
    const body = document.createElement('div'); body.className = 'law-cards-body';
    panel.append(summary, body);
    if (articles) copy.querySelector('.law-cards').after(panel);
    else copy.prepend(panel);
    async function load() {
      body.textContent = articles ? 'Loading required articles…' : 'Loading law cards…';
      try {
        const data = await read();
        const fragment = document.createDocumentFragment();
        if (articles ? data.articles : data.requiredReading) {
          const note = document.createElement('p'); note.className = 'law-card-source';
          note.textContent = articles ? data.articles.note : data.requiredReading.document + ' · pp. 2–3. ' + data.requiredReading.note;
          fragment.append(note);
        }
        let pastPaperHeading = false;
        for (const card of [...(articles ? data.articles.cards : data.cards)].sort((a,b) => (a.imaItem || a.articleItem || 100) - (b.imaItem || b.articleItem || 100))) {
          if (articles && card.citedInPastPapers && !pastPaperHeading) {
            const heading = document.createElement('h2'); heading.dir = 'ltr';
            heading.textContent = 'Also cited in past papers (not on P005-2026)';
            fragment.append(heading); pastPaperHeading = true;
          }
          const numbered = card.imaItem || card.articleItem;
          const collapsible=numbered || card.requiredBook || card.citedInPastPapers;
          const section = document.createElement(collapsible ? 'details' : 'section'); section.className = 'law-card';
          section.id = 'law-card-' + card.id;
          if (collapsible) section.dir = card.direction || 'rtl';
          const heading = document.createElement(collapsible ? 'summary' : 'h2');
          heading.textContent = (numbered ? numbered + '. ' : '') + card.title + (card.coverage ? ' · ' + card.coverage : '');
          const list = document.createElement('ul');
          for (const text of card.bullets) {
            const line = document.createElement('li'); line.textContent = text; list.append(line);
          }
          section.append(heading);
          if (card.editionNotice) {
            const notice = document.createElement('p'); notice.className = 'law-card-gap';
            notice.dir = 'ltr'; notice.textContent = card.editionNotice; section.append(notice);
          }
          section.append(list);
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
            link.textContent = 'Asked: ' + HazzardEvidence.label(question);
            if(question.note)link.textContent+=' · '+question.note;
            link.title = question.reference;
            links.append(link);
            if (question.showBasis && question.basis) {
              const basis = document.createElement('p'); basis.className = 'law-card-source';
              basis.dir = 'ltr'; basis.textContent = 'Basis: ' + question.basis; links.append(basis);
            }
            if (question.editionComparison) {
              const comparison = document.createElement('p'); comparison.className = 'law-card-source';
              comparison.dir = 'ltr'; comparison.textContent = question.editionComparison; links.append(comparison);
            }
          }
          if (card.questions.length) section.append(links);
          else if (!card.requiredBook) {
            const note = document.createElement('p'); note.className = 'law-card-source';
            note.textContent = 'No matching official question identified for this item.';
            section.append(note);
          }
          fragment.append(section);
        }
        if (articles) for (const entry of data.articles.entries) {
          const row = document.createElement('section'); row.className = 'law-card';
          const heading = document.createElement('h2'); heading.textContent = entry.title + ' — ' + entry.status;
          const source = document.createElement('p'); source.className = 'law-card-source'; source.textContent = entry.provenance;
          row.append(heading, source); fragment.append(row);
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
        message.textContent = error.message || 'Required reading could not be loaded.';
        const retry = document.createElement('button'); retry.textContent = articles ? 'Retry required articles' : 'Retry law cards';
        retry.onclick = load; body.replaceChildren(message, retry);
      }
    }
    await load();
  }
  return {decorate, questionLinks};
})();
