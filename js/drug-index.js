/* Read-only navigation. Names/classes come from the book; no answer-store writes. */
window.HazzardDrugs = (() => {
  let pending;
  const buckets = new Map();
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase().replace(/[‐‑–—−]/g, '-');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function counts(passages,questions){
    return passages+(passages===1?' passage':' passages')+' · '+questions+(questions===1?' question':' questions');
  }
  function load() {
    if(pending)return pending;
    const path='data/drug-lookup.json';
    const early=window.HazzardEarlyFetch?.get(path);window.HazzardEarlyFetch?.delete(path);
    return pending=(early||fetch(path)).then(response => {
      if (!response.ok) throw Error('Drug index unavailable. Reconnect and retry.');
      return response.json();
    }).then(data => ({entries:data})).catch(error => { pending = null; throw error; });
  }
  async function loadEntry(entry){
    const file=entry.detailFile;
    if(!buckets.has(file)){
      const request=fetch(file).then(response=>{
        if(!response.ok)throw Error('Drug references unavailable. Reconnect and retry.');
        return response.json();
      }).catch(error=>{buckets.delete(file);throw error;});
      buckets.set(file,request);
    }
    const item=(await buckets.get(file))[entry.id];
    if(!item)throw Error('Drug references unavailable.');
    return item;
  }
  function passageURL(p) {
    const anchor=p.target?'search-'+encodeURIComponent(JSON.stringify({excerpt:p.excerpt,...p.target})):encodeURIComponent(p.anchor);
    return '?chapter='+encodeURIComponent(p.chapter)+(anchor?'#'+anchor:'');
  }
  function locationLabel(p) {
    return 'Ch '+String(p.chapter).replace(/s$/,'')+(p.kind==='study'?' Study':'')+' · p'+p.page+(p.section?' · '+p.section:'')+(p.sourceType==='bibliography'?' · Bibliography':'');
  }

  function routeKey(params){return JSON.stringify(['drug','drugSearch','drugKind'].map(name=>params.get(name)||''));}
  async function mount(copy) {
    copy.classList.add('drug-index');
    const panel = el('section'); panel.dataset.readerMetadata = 'drugs';
    panel.innerHTML = '<input id="drugSearch" type="search" aria-label="Search drugs and classes" autocomplete="off" placeholder="Search drugs or classes">' +
      '<div id="drugKind" class="choice-chips" role="group" aria-label="Show entries"><button type="button" data-kind="all">All</button><button type="button" data-kind="drug">Drugs</button><button type="button" data-kind="class">Classes</button></div>' +
      '<nav id="drugLetters" aria-label="Jump to a letter"></nav><p id="drugStatus" role="status" aria-live="polite">Loading drug index…</p><div id="drugResults"></div>';
    copy.append(panel);
    const input = panel.querySelector('#drugSearch'), kind = panel.querySelector('#drugKind');
    const status = panel.querySelector('#drugStatus'), results = panel.querySelector('#drugResults');
    const params = new URL(location.href).searchParams;
    copy.dataset.drugRoute=routeKey(params);
    input.value = params.get('drugSearch') || '';
    let selectedKind = ['drug', 'class'].includes(params.get('drugKind')) ? params.get('drugKind') : 'all';
    function remember(id) {
      const url = new URL(location.href);
      for (const [key, value] of [['drugSearch', input.value.trim()], ['drugKind', selectedKind === 'all' ? '' : selectedKind], ['drug', id || '']]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      copy.dataset.drugRoute=routeKey(url.searchParams);
      history.replaceState(history.state, '', url);
    }
    function detailsFor(entry, body) {
      if(entry.kind==='drug'){
        const cls=data.entries.find(item=>item.kind==='class' && item.name===entry.class);
        if(cls){
          const link=el('a','Open class: '+cls.name);
          link.href='?chapter=drugs&drug='+encodeURIComponent(cls.id);body.append(link);
        }
      }else{
        const members=data.entries.filter(item=>item.kind==='drug' && item.class===entry.name);
        if(members.length){
          const panel=el('details','','drug-links'),list=el('ul');panel.open=true;
          panel.append(el('summary','Drugs in this class · '+members.length),list);
          for(const member of members){
            const row=el('li'),link=el('a',member.name);
            link.href='?chapter=drugs&drug='+encodeURIComponent(member.id);row.append(link);list.append(row);
          }
          body.append(panel);
        }
      }
      function brandRows(brands){
        const list=el('ul');
        for(const brand of brands){
          const row=el('li'),link=el('a',brand.name);link.href=brand.sourceUrl;
          if(brand.hebrewName)link.append(' · ',el('bdi',brand.hebrewName));
          row.append(link);
          if(brand.registrations?.length>1){
            const details=el('details'),registrations=el('ul');
            details.append(el('summary','Registrations ('+brand.registrations.length+')'),registrations);
            for(const reg of brand.registrations){
              const li=el('li'),source=el('a',[reg.registrationNumber,reg.form,...reg.routes].filter(Boolean).join(' · '));
              source.href=reg.sourceUrl;li.append(source);registrations.append(li);
            }
            row.append(details);
          }
          list.append(row);
        }
        return list;
      }
      if(entry.israeliBrands?.length){
        const panel=el('details','','drug-links drug-brands');
        panel.append(el('summary','Israeli brands · '+entry.israeliBrands.length),brandRows(entry.israeliBrands));body.append(panel);
      }
      if(entry.israeliCombinations?.length){
        const panel=el('details','','drug-links drug-brands');
        panel.append(el('summary','Israeli combination products'));
        for(const product of entry.israeliCombinations){
          panel.append(el('strong',product.ingredients.join(' + ')),brandRows(product.brands));
        }
        body.append(panel);
      }
      for (const [type, heading] of [['chapter', 'Book passages'], ['study', 'Study summaries']]) {
        const passages = entry.passages.filter(p => p.kind === type);
        if (!passages.length) continue;
        const group = el('details', '', 'drug-links'), summary = el('summary', heading + ' · ' + passages.length);
        group.append(summary); group.open = type === 'chapter';
        const list = el('ul');
        for (const p of passages) {
          const row = el('li'), link = el('a', locationLabel(p)); link.href = passageURL(p);
          row.append(link);
          if(p.sourceLocator){
            if(p.excerpt)row.append(el('p',p.excerpt,'drug-excerpt'));
            else row.append(el('small',p.pageArt?.length?'Printed page with tables or figures':'Mention on the printed page'));
            for(const asset of p.pageArt||[]){
              const named=asset.match(/_(table|figure)-?(\d+[-.][\da-z]+)(?:[-_.])/i);
              const label=named?named[1][0].toUpperCase()+named[1].slice(1)+' '+named[2].replace('.','-'):'Page image';
              const imageLink=el('a','Open '+label);
              imageLink.href='chapters/'+encodeURIComponent(asset);row.append(imageLink);
            }
          }else row.append(el('p', (p.image ? 'Table entry · ' : '') + p.excerpt, 'drug-excerpt'));
          list.append(row);
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
          link.href = HazzardEvidence.questionURL(q.id); row.append(link); if(q.match==='class'||q.match==='member')row.append(el('small',q.match==='class'?'Drug class':'Drug in this class')); list.append(row);
        }
        questions.append(list);
      }
      body.append(questions);
      const sources = el('details', '', 'drug-links drug-sources');
      sources.append(el('summary', 'References'));
      if(entry.classSource){
        const link=el('a',entry.classSource.label);
        link.href=entry.classSource.url;
        sources.append(link);
      }
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
      const passages=entry.passages,questions=entry.questions;
      const caption=el('span','','drug-row-caption');
      const amount=el('small',passages+(passages===1?' passage':' passages')+' · '+questions+(questions===1?' Q':' Qs'));
      amount.setAttribute('aria-label',counts(passages,questions));
      caption.append(meta,amount);summary.append(name,caption);
      const body = el('div', '', 'drug-body'); row.append(summary, body);
      let populated = false;
      row.addEventListener('toggle', async () => {
        if (!row.isConnected) return;
        if (row.open) remember(entry.id);
        else if (new URL(location.href).searchParams.get('drug') === entry.id) remember('');
        if(row.open&&!populated){populated=true;body.textContent='Loading references…';try{const item=await loadEntry(entry);body.replaceChildren();detailsFor(item,body);}catch(error){populated=false;body.textContent=error.message;}}
      });
      if (entry.id === selected || (entry.previousId && entry.previousId === selected)) row.open = true;
      return row;
    }

    const letters=panel.querySelector('#drugLetters');
    let data,searchIndex;
    const initial=name=>(normalize(name).replace(/^α/,'alpha').replace(/^β/,'beta').replace(/^μ/,'mu').match(/^[a-z]/)?.[0]||'#').toUpperCase();
    letters.addEventListener('click',event=>{
      const button=event.target.closest('[data-letter]');if(!button)return;
      const heading=document.getElementById('drug-letter-'+button.dataset.letter);
      if(heading){heading.scrollIntoView({block:'start'});heading.focus({preventScroll:true});}
    });

    function terms(){
      if(searchIndex)return searchIndex;
      const classes=new Map(data.entries.filter(e=>e.kind==='class').map(e=>[normalize(e.name),e.aliases.join(' ')]));
      searchIndex=new Map(data.entries.map(e=>{
        const brands=e.brandNames||e.israeliBrands?.flatMap(b=>[b.name,b.hebrewName].filter(Boolean))||[];
        const classAliases=(e.class||'').split(' / ').map(name=>classes.get(normalize(name))||'');
        return [e.id,HazzardSearchTerms.prepare([e.name,e.class||'',...e.aliases,...brands,...classAliases].join(' '))];
      }));
      return searchIndex;
    }
    function render(){
      if(!data)return;
      const query=HazzardSearchTerms.compile(input.value),index=query.text?terms():null;
      const matches=data.entries.filter(e=>(selectedKind==='all'||selectedKind===e.kind)&&(!index||query.test(index.get(e.id))));
      const selectedID=new URL(location.href).searchParams.get('drug');
      const groups=new Map(),fragment=document.createDocumentFragment(),jumps=document.createDocumentFragment();
      let selected=null;
      for(const entry of matches){
        const letter=initial(entry.name);if(!groups.has(letter))groups.set(letter,[]);
        groups.get(letter).push(entry);
      }
      for(const letter of [...groups.keys()].sort()){
        const heading=el('h2',letter,'drug-letter-heading');heading.id='drug-letter-'+letter;heading.tabIndex=-1;
        fragment.append(heading);
        const jump=el('button',letter);jump.type='button';jump.dataset.letter=letter;jump.setAttribute('aria-label','Jump to '+letter);jumps.append(jump);
        for(const entry of groups.get(letter)){
          const row=entryRow(entry,selectedID);fragment.append(row);if(entry.id===selectedID||entry.previousId===selectedID)selected=row;
        }
      }
      letters.style.setProperty('--drug-columns',String(groups.size>13?Math.ceil(groups.size/2):Math.max(1,groups.size)));
      letters.replaceChildren(jumps);letters.hidden=groups.size<2;
      results.replaceChildren(fragment);
      if(!matches.length)results.append(el('p','No matching drug or class.'));
      status.textContent=matches.length+(matches.length===1?' entry':' entries');
      if(selected)requestAnimationFrame(()=>{if(selected.isConnected)selected.scrollIntoView({block:'start'});});
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
  let lookupNames;
  async function search(query){
    const match=HazzardSearchTerms.compile(query),{entries}=await load();
    lookupNames ||= entries.map(entry=>({entry,names:[entry.name,...entry.aliases].map(HazzardSearchTerms.prepare)}));
    return lookupNames.map(({entry,names})=>({entry,rank:Math.min(...names.map(match.rank)),nameRank:match.rank(names[0])}))
      .filter(hit=>Number.isFinite(hit.rank)).sort((a,b)=>a.rank-b.rank||a.nameRank-b.nameRank).slice(0,10).map(hit=>hit.entry);
  }
  return {mount,search,counts,routeKey};
})();
