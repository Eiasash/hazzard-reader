/* Read-only navigation. Names/classes come from the book; no answer-store writes. */
window.HazzardDrugs = (() => {
  let pending, full;
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase().replace(/[‐‑–—−]/g, '-');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function load() {
    if(pending)return pending;
    const path=window.HazzardDrugSummary||'data/drug-index.json';
    const early=window.HazzardEarlyFetch?.get(path);window.HazzardEarlyFetch?.delete(path);
    return pending=(early||fetch(path)).then(response => {
      if (!response.ok) throw Error('Drug index unavailable. Reconnect and retry.');
      return response.json();
    }).catch(error => { pending = null; throw error; });
  }
  async function loadEntry(entry){
    if(!entry.part)return entry;
    if(navigator.onLine){
      try{const res=await fetch(entry.part);if(res.ok)return await res.json();}catch{}
    }
    full ||= fetch('data/drug-index.json').then(async res=>{
      if(!res.ok)throw Error('Drug references unavailable.');
      const data=await res.json();return new Map(data.entries.map(row=>[row.id,row]));
    }).catch(error=>{full=null;throw error;});
    const item=(await full).get(entry.id);if(!item)throw Error('Drug references unavailable.');return item;
  }
  function passageURL(p) {
    const anchor=p.target?'search-'+encodeURIComponent(JSON.stringify({excerpt:p.excerpt,...p.target})):encodeURIComponent(p.anchor);
    return '?chapter='+encodeURIComponent(p.chapter)+(anchor?'#'+anchor:'');
  }
  function locationLabel(p) {
    return 'Ch '+String(p.chapter).replace(/s$/,'')+(p.kind==='study'?' Study':'')+' · p'+p.page+(p.section?' · '+p.section:'')+(p.sourceType==='bibliography'?' · Bibliography':'');
  }

  async function mount(copy) {
    copy.classList.add('drug-index');
    const panel = el('section'); panel.dataset.readerMetadata = 'drugs';
    panel.innerHTML = '<input id="drugSearch" type="search" aria-label="Search drugs and classes" autocomplete="off" placeholder="Search drugs and classes">' +
      '<div id="drugKind" class="choice-chips" role="group" aria-label="Show entries"><button type="button" data-kind="all">All</button><button type="button" data-kind="drug">Drugs</button><button type="button" data-kind="class">Classes</button></div>' +
      '<p id="drugStatus" role="status" aria-live="polite">Loading drug index…</p><div id="drugResults"></div>';
    copy.append(panel);
    const input = panel.querySelector('#drugSearch'), kind = panel.querySelector('#drugKind');
    const status = panel.querySelector('#drugStatus'), results = panel.querySelector('#drugResults');
    const params = new URL(location.href).searchParams;
    input.value = params.get('drugSearch') || '';
    let selectedKind = ['drug', 'class'].includes(params.get('drugKind')) ? params.get('drugKind') : 'all';
    function remember(id) {
      const url = new URL(location.href);
      for (const [key, value] of [['drugSearch', input.value.trim()], ['drugKind', selectedKind === 'all' ? '' : selectedKind], ['drug', id || '']]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      history.replaceState(history.state, '', url);
    }
    function detailsFor(entry, body) {
      const brands=(entry.israeliBrands||[]).filter(brand=>brand.name&&brand.sourceUrl);
      if(brands.length){
        const group=el('details','','drug-links drug-brands'),list=el('ul');
        group.append(el('summary','Israeli brands · '+brands.length),list);
        for(const brand of brands){
          const row=el('li'),source=el('a',brand.name);source.href=brand.sourceUrl;
          if(brand.hebrewName){source.append(' · ',el('bdi',brand.hebrewName));}
          row.append(source);list.append(row);
        }
        body.append(group);
      }
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
      questions.append(el('summary', 'Questions · ' + entry.questions.length));
      if (!entry.questions.length) questions.append(el('p', 'No matching question in this bank.'));
      else {
        const list = el('ul');
        for (const q of entry.questions) {
          const row = el('li'), link = el('a', q.sitting&&q.number?HazzardEvidence.label(q):(q.label||'Practice question'));
          link.href = HazzardEvidence.questionURL(q.id); row.append(link); if(q.match==='class'||q.match==='member')row.append(el('small',q.match==='class'?'Class match':'Member drug')); list.append(row);
        }
        questions.append(list);
      }
      body.append(questions);
      const sources = el('details', '', 'drug-links drug-sources');
      sources.append(el('summary', 'Name / class sources'));
      for (const s of entry.sources) {
        const page=s.page||(/^p\d+$/.test(s.anchor)?Number(s.anchor.slice(1)):null);
        if(!page)continue;
        const p=el('p'),link=el('a','Ch '+s.chapter+' · p'+page);
        link.href=passageURL(s);p.append(link,el('q',s.quote));sources.append(p);
      }
      if(sources.children.length>1)body.append(sources);
    }
    function entryRow(entry,selected){
      const row = el('details', '', 'drug-entry'); row.id = 'drug-' + entry.id;
      const summary = el('summary'), name = el('strong', entry.name), meta = el('span', entry.kind === 'class' ? 'Drug class' : entry.class || (entry.bankOnly?'Question bank only':''), 'drug-class');
      const passages=entry.passageCount??entry.passages.length,questions=entry.questionCount??entry.questions.length;
      summary.append(name,meta,el('small',passages+(passages===1?' passage':' passages')+' · '+questions+(questions===1?' question':' questions')));
      const body = el('div', '', 'drug-body'); row.append(summary, body);
      let populated = false;
      row.addEventListener('toggle', async () => {
        if (!row.isConnected) return;
        if (row.open) remember(entry.id);
        else if (new URL(location.href).searchParams.get('drug') === entry.id) remember('');
        if(row.open&&!populated){populated=true;body.textContent='Loading references…';try{const item=await loadEntry(entry);body.replaceChildren();detailsFor(item,body);}catch(error){populated=false;body.textContent=error.message;}}
      });
      if (entry.id === selected) row.open = true;
      return row;
    }

    const batchSize=32;
    const more=el('button','Show more entries','drug-more');more.type='button';
    let data, matches=[], visibleCount=0, selectedID=null, searchIndex;
    function nextBatch(){
      const batch=matches.slice(visibleCount,visibleCount+batchSize);
      const fragment=document.createDocumentFragment();
      for(const entry of batch)fragment.append(entryRow(entry,selectedID));
      visibleCount+=batch.length;
      results.insertBefore(fragment,more);
      more.hidden=visibleCount===matches.length;
    }
    more.onclick=nextBatch;

    function terms(){
      if(searchIndex)return searchIndex;
      const classes=new Map(data.entries.filter(e=>e.kind==='class').map(e=>[normalize(e.name),e.aliases.join(' ')]));
      searchIndex=new Map(data.entries.map(e=>{
        const brands=e.brandNames||e.israeliBrands?.flatMap(b=>[b.name,b.hebrewName].filter(Boolean))||[];
        const classAliases=(e.class||'').split(' / ').map(name=>classes.get(normalize(name))||'');
        return [e.id,normalize([e.name,e.class||'',...e.aliases,...brands,...classAliases].join(' '))];
      }));
      return searchIndex;
    }
    function render(){
      if(!data)return;
      const words=normalize(input.value.trim()).split(/\s+/).filter(Boolean);
      const index=words.length?terms():null;
      matches=data.entries.filter(e=>(selectedKind==='all'||selectedKind===e.kind)&&words.every(word=>index.get(e.id).includes(word)));
      // A saved deep link opens immediately, even for the last name in the catalogue.
      selectedID=new URL(location.href).searchParams.get('drug');
      const selected=selectedID&&matches.find(e=>e.id===selectedID);
      if(selected)matches=[selected,...matches.filter(e=>e!==selected)];
      visibleCount=0;
      results.replaceChildren(more);
      nextBatch();
      if(!matches.length)results.prepend(el('p','No matching drug or class. Try a generic name or a shorter search.'));
      status.textContent=matches.length+(matches.length===1?' entry':' entries')+' · '+data.counts.drugs+' drugs + '+data.counts.classes+' classes in the index';
    }
    async function open(){
      status.textContent='Loading drug index…';
      try{data=await load();render();}
      catch(error){
        status.textContent=error.message||'Drug index could not be loaded.';
        const retry=el('button','Retry drug index');retry.onclick=open;results.replaceChildren(retry);
      }
    }
    function paintFilter(){for(const chip of kind.querySelectorAll('[data-kind]'))chip.setAttribute('aria-pressed',String(chip.dataset.kind===selectedKind));}
    kind.onclick=event=>{const chip=event.target.closest('[data-kind]');if(!chip||chip.dataset.kind===selectedKind)return;selectedKind=chip.dataset.kind;paintFilter();remember('');render();};
    input.oninput=()=>{remember('');render();};paintFilter();
    await open();
  }
  return {mount};
})();
