/* The outline follows the rendered edition, including the Study disclosures. */
window.HazzardSections = (() => {
  const headings = 'h1,h2,h3,h4,h5,h6';
  const cardTitles = '.law-cards > summary,.law-card > summary';
  let targets, land,refreshHeading=()=>{};

  function jump(id) {
    const heading = targets?.get(id);
    if (!heading) return false;
    land(heading);
    if (!heading.matches('summary,[tabindex]')) {
      heading.tabIndex = -1;
      heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), {once: true});
    }
    heading.focus({preventScroll: true});
    return true;
  }

  function sectionNodes(copy) {
    // Memory aids, provenance and grade controls have their own navigation.
    // The source cards are part of the Israeli law Study chapter itself.
    return [...copy.querySelectorAll(headings + ',' + cardTitles)].filter(node =>
      !node.closest('[data-reader-metadata]') || node.closest('.law-cards'));
  }

  function makeList(rows, existing = new Map()) {
    const list = document.createDocumentFragment();
    const chapterTitle=rows.find(row=>row.heading.tagName==='H1');
    for (const row of rows) {
      if(row===chapterTitle){existing.get(row.heading.id)?.remove();continue;}
      const item = existing.get(row.heading.id) || document.createElement('li');
      const button = item.querySelector('button') || document.createElement('button');
      const name = document.createElement('bdi'), count = document.createElement('span');
      name.textContent = row.title;
      count.className = 'section-exam-count';
      count.textContent = '…';
      count.setAttribute('aria-label', 'Loading official exam count');
      button.type = 'button';
      button.dir = 'ltr';
      button.dataset.jump = row.heading.id;
      button.className = 'reader-section-link';
      button.replaceChildren(name, count);
      item.className = row.level > 2 ? 'section-nested' : '';
      item.replaceChildren(button);
      list.append(item);
      row.counts.push(count);
    }
    return list;
  }

  async function officialCounts(copy, chapter, rows) {
    const base = chapter.replace(/s$/, '');
    const law = base === 'law';
    const [data, catalog, lawIds] = await Promise.all([
      HazzardEvidence.load(), HazzardQuestionData.catalog(),
      law ? HazzardMCQ.preload().then(([, , , collections]) => collections.israeliLawEthics.ids) : []
    ]);
    const official = new Set(catalog.filter(q => q.kind === 'past' && !q.retired && data.questions[q.id]).map(q => q.id));
    const members = new Set(law ? lawIds : HazzardEvidence.studyIds(data, base));
    const title = rows.find(row => row.heading.tagName === 'H1');
    const byHeading = new Map(rows.map(row => [row.heading, row]));
    const badges = new Map(), linked = new Map(), printed = new Map(), cited = new Map();
    const pages = new Map();
    for (const id of official) {
      const entry = data.questions[id];
      if (!law && entry.chapters.includes(base)) members.add(id);
      if (law || entry.status !== 'resolved' || Number(entry.sitting.slice(0, 4)) < 2023) continue;
      for (const source of entry.pages) {
        if (!source.available || String(source.readerChapter || source.chapter) !== base) continue;
        members.add(id);
        if (!pages.has(source.page)) pages.set(source.page, new Set());
        pages.get(source.page).add(id);
      }
    }

    const legacyStudy = chapter !== base && !law && !copy.querySelector('[data-exam-ids],[data-exam-page]');
    const scan = [headings, cardTitles, 'a[href*="q="]', 'a[id^="p"]'];
    if (legacyStudy) scan.push('p,li');
    let section = title;
    function record(map, id) {
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(section);
    }
    for (const node of copy.querySelectorAll(scan.join(','))) {
      const row = byHeading.get(node);
      if (row) { section = row; continue; }
      if (section && node.matches('a[href*="q="]') && node.closest('.chapter-exam-membership')) {
        const id = new URL(node.href).searchParams.get('q');
        if (members.has(id) && official.has(id)) section.ids.add(id);
        continue;
      }
      if (!section || (node.closest('[data-reader-metadata]') &&
          !node.closest('.exam-evidence,.law-cards') && !node.matches('a.pg'))) continue;
      if (node.matches('a[href*="q="]')) {
        const url = new URL(node.href);
        const id = url.searchParams.get('q');
        if (url.origin !== location.origin || url.searchParams.get('chapter') !== 'bank' || !official.has(id)) continue;
        // A bank link in a reference drawer or practice list is not an Asked chip.
        if (node.closest('.exam-evidence')) record(badges, id);
        else if (members.has(id)) record(linked, id);
      } else if (node.matches('a[id]') && /^p\d+$/.test(node.id)) {
        for (const id of pages.get(Number(node.id.slice(1))) || []) record(printed, id);
      } else if (legacyStudy && section !== title && node.matches('p,li')) {
        // Some older notes have inline printed references instead of page anchors.
        // Use the first section citing a page so a later recall exercise does not
        // duplicate the same reference. Match only pages cited for this chapter.
        for (const match of node.textContent.matchAll(/\b(?:pp?|pages?)\.?\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\b/gi)) {
          const first = Number(match[1]), last = Number(match[2] || match[1]);
          for (const page of pages.keys()) {
            if (page >= first && page <= last && !cited.has(page)) cited.set(page, section);
          }
        }
      }
    }
    const textSections = new Map();
    for (const [page, row] of cited) {
      for (const id of pages.get(page)) {
        if (!textSections.has(id)) textSections.set(id, new Set());
        textSections.get(id).add(row);
      }
    }
    // Explicit article badges take precedence over generic page breaks and
    // repeated links. A question genuinely cited in two sections belongs in both.
    for (const id of new Set([...members, ...badges.keys()])) {
      if (!official.has(id)) continue;
      const earlier = Number(data.questions[id].sitting.slice(0, 4)) < 2023;
      const located = !earlier && (badges.get(id) || printed.get(id) || textSections.get(id) || linked.get(id));
      for (const row of located || [title]) row?.ids.add(id);
    }
  }

  let loadCounts=()=>{};
  let release=()=>{};
  function mount({copy, scroll, landOnHeading}) {
    release();release=()=>{};targets=new Map();loadCounts=()=>{};refreshHeading=()=>{};
    document.body.classList.remove('with-section-outline');
    document.getElementById('readerSectionOutline')?.remove();
    document.querySelector('[data-pane="contents"] .section-picker-list')?.remove();
    const chapter = copy.dataset.chapterId;
    if (!/^(?:\d+s?|laws?)$/.test(chapter) || copy.dataset.notLoaded) return;
    const nodes = sectionNodes(copy);
    if (!nodes.length) return;
    land = landOnHeading;
    targets = new Map();
    const rows = nodes.map((heading, index) => {
      if (!heading.id) {
        let id = 'reader-heading-' + index;
        while (document.getElementById(id)) id += '-';
        heading.id = id;
      }
      targets.set(heading.id, heading);
      const name = heading.cloneNode(true);
      name.querySelectorAll('[data-reader-metadata]').forEach(node => node.remove());
      const level = heading.tagName === 'SUMMARY' ? (heading.parentElement.classList.contains('law-card') ? 3 : 2) : Number(heading.tagName.slice(1));
      return {heading, level, title: level===1?name.textContent.trim():HazzardChapterContent.headingLabel(name.textContent.trim(),chapter), ids: new Set(), counts: []};
    });
    const pane = document.querySelector('[data-pane="contents"]');
    pane.dataset.title = 'Sections';
    const list = pane.querySelector('.rows');
    const existing = new Map();
    for (const button of list.querySelectorAll('button[data-jump]')) {
      if (targets.has(button.dataset.jump)) existing.set(button.dataset.jump, button.closest('li'));
    }
    const picker = document.createElement('ul');
    picker.className = 'section-picker-list';
    picker.append(makeList(rows, existing));
    list.before(picker);
    const trigger = document.getElementById('chapterHeaderTitle');
    trigger.dataset.sections = 'Sections';
    trigger.setAttribute('aria-label', 'Sections, ' + trigger.textContent);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'panel');
    const reader = document.getElementById('reader');
    const disposers=[];
    // A separate strip occupies its own space only after the main chapter header scrolls away.
    const strip=document.createElement('button');strip.type='button';strip.id='readerSectionStrip';strip.dataset.panel='contents';
    strip.setAttribute('aria-controls','panel');strip.setAttribute('aria-haspopup','dialog');scroll.before(strip);
    const sections=rows.filter(row=>row.level>1);
    let frame=0;
    function update(){
      frame=0;if(!copy.isConnected||scroll.inert||!document.body.classList.contains('reader-section-mode'))return;
      const view=scroll.getBoundingClientRect(),lead=Math.min(96,view.height/4);
      let previous=null,leading=null;
      for(const row of sections){
        const h=row.heading,box=h.getBoundingClientRect();
        if(!box.width||!box.height||(h.checkVisibility&&!h.checkVisibility({visibilityProperty:true})))continue;
        if(box.bottom<=view.top){previous=row;continue;}
        // Prefer the heading already visible at the start of the reading area,
        // even before its top passes the strip. Otherwise stay with the prose.
        if(box.top<=view.top+lead)leading=row;
        break;
      }
      const selected=leading||previous,active=selected?selected.title:'In this chapter';
      const canonical=copy.dataset.canonicalTitle||copy.querySelector('h1')?.innerText||'Sections';
      const base=chapter.replace(/s$/,''),chapterLabel=(base==='law'?'':base+' · ')+canonical;
      if(trigger.textContent!==chapterLabel)trigger.textContent=chapterLabel;
      trigger.title=canonical;trigger.setAttribute('aria-label','Sections · '+chapterLabel+(selected?' · Current section: '+active:''));
      if(strip.textContent!==active)strip.textContent=active;
      strip.title=active;strip.setAttribute('aria-label','Sections · '+active);
    }
    function queue(){if(!frame)frame=requestAnimationFrame(update);}
    refreshHeading=queue;
    scroll.addEventListener('scroll',queue,{passive:true});copy.addEventListener('toggle',queue,true);copy.addEventListener('load',queue,true);
    const sizing=new ResizeObserver(queue);sizing.observe(copy);sizing.observe(scroll);
    disposers.push(()=>{sizing.disconnect();cancelAnimationFrame(frame);scroll.removeEventListener('scroll',queue);copy.removeEventListener('toggle',queue,true);copy.removeEventListener('load',queue,true);strip.remove();});
    queue();
    release=()=>{for(const dispose of disposers)dispose();};
    {
      const outline = document.createElement('nav'), label = document.createElement('h2'), links = document.createElement('ul');
      outline.id = 'readerSectionOutline';
      label.id = 'readerSectionOutlineTitle';
      label.textContent = 'Sections';
      outline.setAttribute('aria-labelledby', label.id);
      links.append(makeList(rows));
      outline.append(label, links);
      document.querySelector('main').append(outline);
      const desktop = matchMedia('(min-width: 1200px)');
      function layout() {
        const visible = desktop.matches && !reader.hidden && !scroll.inert;
        outline.hidden = !visible;
        document.body.classList.toggle('with-section-outline', visible);
      }
      const observer = new MutationObserver(layout);
      observer.observe(reader, {attributes: true, attributeFilter: ['hidden']});
      observer.observe(scroll, {attributes: true, attributeFilter: ['inert']});
      desktop.addEventListener('change', layout);
      disposers.push(()=>{observer.disconnect();desktop.removeEventListener('change',layout);});
      layout();
    }
    const desktopCounts=matchMedia('(min-width:1200px)');
    loadCounts=()=>{
      loadCounts=()=>{};desktopCounts.removeEventListener('change',visible);
      officialCounts(copy,chapter,rows).then(()=>updateCounts(true),()=>updateCounts(false));
    };
    function visible(){if(desktopCounts.matches||pane.closest('[open]')?.dataset.currentPane==='contents')loadCounts();}
    desktopCounts.addEventListener('change',visible);disposers.push(()=>desktopCounts.removeEventListener('change',visible));visible();
    function updateCounts(available) {
      for (const row of rows) {
        const n = row.ids.size;
        const description = available ? n + ' official exam question' + (n === 1 ? '' : 's') +
          (row.heading.tagName === 'H1' ? ' at the chapter heading' : ' in this section') : 'Official exam count unavailable';
        for (const badge of row.counts) {
          badge.textContent = available && n ? n + (n === 1 ? ' question' : ' questions') : '';
          badge.setAttribute('aria-label', description);
          badge.title = description;
        }
      }
    }
  }
  return {loadCounts:()=>loadCounts(),refresh:()=>refreshHeading(),mount,jump};
})();
