/* Isolated design preview. The session has no connector to reader or cloud storage. */
(() => {
  'use strict';
  const main=document.getElementById('main'),nav=document.getElementById('nav'),cache=new Map();
  const state={last:null,saved:new Set(),records:new Map(),review:[],reviewed:new Set(),selected:null,revision:0};
  let start,chapterMap,questionMap,drugRows,catalog,index;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const link=(href,text,cls='secondary')=>{const a=el('a',cls,text);a.href=href;return a;};
  const button=(name,fn,cls='secondary')=>{const b=el('button',cls,name);b.type='button';b.onclick=fn;return b;};
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function request(path,asText=false){
    if(!cache.has(path))cache.set(path,fetch(path,{credentials:'omit'}).then(r=>{if(!r.ok)throw Error('Could not load this passage.');return asText?r.text():r.json()}).catch(e=>{cache.delete(path);throw e}));
    return cache.get(path);
  }
  function path(view,id='',params={}){
    const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==''&&v!=null));
    return '#'+view+(id?'/'+encodeURIComponent(id):'')+(q.size?'?'+q:'');
  }
  function route(){
    const [parts,query='']=location.hash.slice(1).split('?'),[view='home',raw='']=parts.split('/');
    return {view:view||'home',id:decodeURIComponent(raw),params:new URLSearchParams(query)};
  }
  const icons={home:'M3 10l9-7 9 7 M6 9v11h12V9 M10 20v-6h4v6',library:'M3 5h4v15H3z M9 5h4v15H9z M15 6l4-1 3 14-4 1z',practice:'M5 4h14v16H5z M8 10l2 2 5-5 M8 16h6',notebook:'M6 3h13v18H6z M3 7h4 M3 12h4 M3 17h4 M10 8h6 M10 12h6'};
  function drawNav(view){
    const current=['read','study','questions','drug'].includes(view)?'library':['review','question','bank'].includes(view)?'practice':view;
    nav.replaceChildren(...Object.entries({home:'Home',library:'Chapters',practice:'Practice',notebook:'Notebook'}).map(([key,label])=>{
      const a=link(path(key),null,'');a.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="'+icons[key]+'"/></svg>';a.append(el('span','',label));if(key===current)a.setAttribute('aria-current','page');return a;}));
  }
  function panel(title,info){const x=el('section','panel');x.append(el('h2','',title));if(info)x.append(el('p','meta',info));return x;}
  function row(href,name,info){const a=link(href,null,'row'),left=el('span');left.append(el('span','name',name));if(info)left.append(el('span','meta',info));a.append(left,el('span','chev','›'));return a;}
  function scope(ch,id){return path('bank','',{chapter:ch.id,id});}
  function sitting(q){if(q.kind!=='past')return 'Practice question';
    const names={Jan:'January',Feb:'February',Mar:'March',Apr:'April',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Oct:'October',Nov:'November',Dec:'December'};
    const [year,season,track]=String(q.t||'').split('-');return [names[season]||(!['Basic','Subspec'].includes(season)?season:''),year,track==='Basic'||season==='Basic'?'Basic':'',q.examNumber?'Q'+q.examNumber:''].filter(Boolean).join(' ');
  }
  const rtl=s=>{const text=clean(s),he=(text.match(/[\u05d0-\u05ea]/g)||[]).length,latin=(text.match(/[A-Za-z]/g)||[]).length;return he>0&&(he>=latin/3||/^[^A-Za-z\u05d0-\u05ea]*[\u05d0-\u05ea]/u.test(text));};
  function bilingual(n,text){n.dir=rtl(text)?'rtl':'ltr';n.lang=n.dir==='rtl'?'he':'en';return n;}
  function markdown(value){const tmp=el('div');tmp.innerHTML=marked.parse(escape(String(value||'').replace(/\\n/g,'\n')));for(const a of tmp.querySelectorAll('a,img'))a.replaceWith(document.createTextNode(a.textContent||a.alt||''));return tmp;}
  function head(title,info){const d=el('div');d.append(el('h1','',title));if(info)d.append(el('p','meta',info));return d;}
  function due(){return state.review.filter(id=>!state.reviewed.has(id));}
  function home(){
    const recent=state.last||{id:'61',mode:'study'},c=chapterMap.get(recent.id)||chapterMap.get('61');const hero=el('section','hero');
    hero.append(el('p','context',(state.last?'Continue':'Start')+' · Chapter '+c.id),el('h2','',c.title));
    if(c.id==='61')hero.append(el('p','lead',start.orientation));
    const hActions=el('div','actions'),mode=recent.mode==='read'?'Read':'Study';
    hActions.append(link(path(recent.mode,c.id,recent.anchor?{at:recent.anchor}:{}),(state.last?'Resume ':'Open ')+mode,'primary'),link(path(mode==='Read'?'study':'read',c.id),mode==='Read'?'Study chapter':'Read chapter','hero-secondary'));hero.append(hActions);
    const queue=due(),review=panel('Daily review',queue.length+' '+(queue.length===1?'question':'questions')+' in this demo queue');const actions=el('div','actions');
    actions.append(link(path('review'),queue.length?'Begin review':'Review completed items','primary'));review.append(actions);
    const grid=el('div','home-grid');grid.append(hero,review);main.append(head('Study today'),grid);
    main.append(el('h2','section-title','Find a question or passage'),row(path('library'),'Search chapters and drugs','Open a chapter, figure, printed page or drug entry.'),row(path('bank'),'Question bank','Official past questions and practice cases.'));
    main.append(el('p','meta','Prototype answers and saved questions last only while this page is open.'));
  }
  function lookupInput(label,onChange){const i=el('input','lookup');i.type='search';i.placeholder=label;i.setAttribute('aria-label',label);i.autocomplete='off';i.oninput=()=>onChange(i.value);return i;}
  function chapterRow(c){
    const box=el('div','row chapter-row'),title=el('span','chapter-label');
    title.append(el('span','meta',c.id==='law'?'Israeli law':'Chapter '+c.id),el('strong','name',c.title));
    box.append(title);
    for(const [view,label] of [['read','Read'],['study','Study']]){
      const action=link(path(view,c.id),label,'secondary row-action');
      action.setAttribute('aria-label',label+' '+c.title);box.append(action);
    }
    return box;
  }
  async function library(r,key){const list=el('div'),stat=el('p','meta');let requestNo=0,shown=18,filter=r.params.get('find')||'';
    const search=lookupInput('Search by chapter, title or drug',v=>{filter=v;shown=18;draw()});search.value=filter;
    main.append(head('Chapters'),search,stat,list);
    async function draw(){const seq=++requestNo;const term=clean(filter).toLowerCase();const items=start.chapters.filter(c=>!term||c.id===term||c.title.toLowerCase().includes(term)).sort((a,b)=>Number(b.id===term)-Number(a.id===term)||Number(a.id)-Number(b.id));
      let drugs=[];if(term.length>=3){drugRows ||= await request('./drugs.json');drugs=drugRows.filter(d=>[d.name,...d.aliases].some(s=>String(s).toLowerCase().includes(term))).sort((a,b)=>Number(b.name.toLowerCase()===term)-Number(a.name.toLowerCase()===term)).slice(0,10);}
      if(seq!==requestNo||key!==state.revision)return;list.replaceChildren();stat.textContent=term&&!items.length&&!drugs.length?'No chapter or drug matches this search.':'';
      const exactDrug=drugs.find(d=>d.name.toLowerCase()===term);if(exactDrug)list.append(row(path('drug',exactDrug.id),exactDrug.name,exactDrug.class+' · '+exactDrug.passages+' passages · '+exactDrug.questions+' questions'));
      for(const c of items.slice(0,shown))list.append(chapterRow(c));for(const d of drugs.filter(d=>d!==exactDrug))list.append(row(path('drug',d.id),d.name,d.class+' · '+d.passages+' passages'));
      if(items.length>shown)list.append(button('Show more chapters',()=>{shown+=24;draw()}));
    }await draw();
  }
  async function drug(r,key){
    index ||= await request('../data/drug-index.json');if(key!==state.revision)return;const d=index.entries.find(n=>n.id===r.id);if(!d)return missing();
    main.append(link(path('library','', {find:d.name}),'‹ Chapters',''),head(d.name,d.class+' · '+d.passages.length+' passages · '+d.questions.length+' questions'));
    const l=el('div');for(const passage of d.passages){const ch=String(passage.chapter).replace(/s$/,''),mode=passage.kind==='study'?'study':'read';l.append(row(path(mode,ch,{at:passage.anchor||'p'+passage.page}),passage.section||'Chapter '+ch,(passage.page?'p'+passage.page+' · ':'')+(passage.target?.excerpt||passage.excerpt||'')));}
    main.append(el('h2','section-title','In the book'),l);
    if(d.questions.length){const first=d.questions[0],id=typeof first==='string'?first:first.id;if(id)main.append(link(path('question',id),'Open a linked question'));}
  }
  function chapterTabs(c,active){const tabs=el('nav','switch');tabs.setAttribute('aria-label','Chapter views');
    for(const [id,label] of [['read','Read'],['study','Study'],['questions','Questions']]){const a=link(path(id,c.id),label,'');if(id===active)a.setAttribute('aria-current','page');tabs.append(a);}return tabs;}
  function chapterURL(n,fallback){const cleanId=n.replace(/s$/,'');return chapterMap.has(cleanId)?cleanId:fallback;}
  function decorateChapter(prose,c,mode){
    if(mode==='read')HazzardChapterContent.formatReadEndMatter(prose,c.id);
    for(const tag of prose.querySelectorAll('script,iframe,style,object,embed,form,template,.chapter-nav,.eyebrow'))tag.remove();
    for(const x of prose.querySelectorAll('*'))for(const attr of [...x.attributes])if(attr.name.startsWith('on')||attr.name==='style')x.removeAttribute(attr.name);
    for(const h of [...prose.querySelectorAll('h1')])h.remove();
    for(const q of [...prose.querySelectorAll('details.study-self-check')])q.remove();
    if(mode==='study'){
      const test=[...prose.querySelectorAll('h2')].find(h=>clean(h.textContent)==='Test yourself');
      if(test){let n=test.nextElementSibling;while(n&&!n.matches('h2')){const following=n.nextElementSibling;n.remove();n=following;}
        const end=el('div','test-link');end.append(link(path('questions',c.id),'Practise chapter questions','primary'));test.replaceWith(end);}
      for(const q of [...prose.querySelectorAll('details')]){const label=q.querySelector('summary'),prev=q.previousElementSibling;
        if(label&&/^(?:answer|תשובה)$/i.test(clean(label.textContent))&&prev?.matches('p')&&/^\d+[.)]\s/.test(clean(prev.textContent))){prev.remove();q.remove();}}
    }
    for(const x of [...prose.querySelectorAll('p')])if(/^Study summary of Chapter|^The book and the full chapter|^Book images cited by past exams/i.test(clean(x.textContent)))x.remove();
    for(const a of [...prose.querySelectorAll('a[href]')]){
      const href=a.getAttribute('href');if(href.startsWith('#')){a.href=path(mode,c.id,{at:href.slice(1)});continue;}
      let u;try{u=new URL(href,new URL('../',location.href))}catch{a.removeAttribute('href');continue;}
      if(!['https:','http:'].includes(u.protocol)){a.removeAttribute('href');continue;}
      if(u.origin===location.origin&&u.searchParams.has('chapter')){const target=u.searchParams.get('chapter'),qid=u.searchParams.get('q');a.href=target==='bank'?(qid?path('question',qid):path('bank')):path(target.endsWith('s')?'study':'read',chapterURL(target,c.id),u.hash?{at:u.hash.slice(1)}:{});}
      else if(u.origin!==location.origin){a.target='_blank';a.rel='noopener noreferrer';}
    }
    for(const image of [...prose.querySelectorAll('img')]){const file=(image.getAttribute('data-src')||image.getAttribute('src')||'').split('/').pop();if(!/^[\w.%()+-]+\.(?:webp|png|jpe?g|gif)$/i.test(file)){image.remove();continue;}image.src='../chapters/'+file;const b=button('',()=>viewFigure(image),'media');b.setAttribute('aria-label','Enlarge '+(image.alt||'chapter figure'));image.before(b);b.append(image);}
    for(const table of prose.querySelectorAll('table')){const container=el('div','table-wrap');table.before(container);container.append(table);}
    for(const n of [...prose.querySelectorAll('blockquote,.note')]){
      const value=clean(n.textContent);if(!/^Current (?:practice|guidance)/i.test(value))continue;
      const prompt=n.querySelector('strong:first-child');const title=prompt&&/^Current (?:practice|guidance)/i.test(prompt.textContent)?prompt.textContent.replace(/\.$/,''):'Current practice';
      if(prompt&&/^Current (?:practice|guidance)/i.test(prompt.textContent))prompt.remove();
      else{const walk=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);if(walk.nextNode())walk.currentNode.data=walk.currentNode.data.replace(/^\s*Current (?:practice|guidance)\s*(?:\(not the book\))?\s*[:.]\s*/i,'');}
      const note=el('aside','practice-note');note.append(el('h3','',title));const sources=[...n.querySelectorAll('a[href]')].filter(a=>a.origin!==location.origin);
      if(sources.length){const refs=el('details');refs.append(el('summary','','Sources'));for(const a of sources){const copy=a.cloneNode(true);refs.append(copy,' ');a.remove();}for(const p of n.querySelectorAll('p'))if(!clean(p.textContent).replace(/[—–·,.; ]/g,''))p.remove();note.append(...n.childNodes,refs);}
      else note.append(...n.childNodes);n.replaceWith(note);
    }
    const headings=[...prose.querySelectorAll('h2,h3')];for(const h of headings){
      if(/^(Status|Source and method|Source status|Source notes|Build status)$/i.test(clean(h.textContent))){let n=h.nextElementSibling;while(n&&!n.matches('h1,h2,h3')){const next=n.nextElementSibling;n.remove();n=next;}h.remove();}
    }
    for(const n of prose.querySelectorAll('p,li,h2,h3,blockquote,td,th'))if(rtl(n.textContent)){n.dir='rtl';n.lang='he';}
  }
  async function chapter(r,key){const c=chapterMap.get(r.id);if(!c)return missing();main.className='reader';main.append(el('p','context',c.id==='law'?'Israeli law':'Chapter '+c.id),el('h1','',c.title),chapterTabs(c,r.view));
    if(r.view==='questions'){await questionList(r,key,c);return;}
    const md=await request('../chapters/'+encodeURIComponent(c[r.view]),true);if(key!==state.revision)return;const prose=el('article','prose');prose.innerHTML=HazzardChapterContent.renderMarkdown(md,c.id+(r.view==='study'?'s':''));HazzardChapterContent.smoothPageMarkers(prose);HazzardStudyPage.indexBookObjects(prose,c.id);
    decorateChapter(prose,c,r.view);state.last={id:c.id,mode:r.view,anchor:r.params.get('at')||''};
    const headers=[...prose.querySelectorAll('h2[id]')].filter(h=>!h.closest('.practice-note,details')&&clean(h.textContent));if(headers.length){const contents=el('details','outline'),list=el('ul');contents.append(el('summary','','Sections'));for(const h of headers){const li=el('li');li.append(link(path(r.view,c.id,{at:h.id}),h.textContent,''));list.append(li);}contents.append(list);main.append(contents);}
    main.append(prose);
    const id=r.params.get('at');if(id)requestAnimationFrame(()=>{prose.querySelector('#'+CSS.escape(id))?.scrollIntoView({block:'start'})});
  }
  async function allQuestions(){return catalog ||= await request('../data/mcq/catalog.json');}
  async function loadQuestion(id){if(questionMap.has(id))return questionMap.get(id);if(!/^mcq-[a-f0-9]{24}$/.test(id))return null;
    const part=await request('../data/mcq/chunks/'+id.slice(4,6)+'.json');for(const q of part)questionMap.set(q.id,q);return questionMap.get(id);}
  async function questionList(r,key,c=null){
    const rows=(await allQuestions()).filter(q=>!q.retired&&(!c||c.official.includes(q.id)||String(q.chapter)===c.id));if(key!==state.revision)return;
    if(!c)main.append(head('Question bank'));let filter=c?'past':(r.params.get('kind')||'past'),query='',limit=14;const list=el('div'),filters=el('div','filters'),status=el('p','meta');
    const input=lookupInput('Find a question or sitting',text=>{query=text;limit=14;draw()});
    for(const [k,label] of [['past','Official'],['practice','Practice'],['all','All']]){const b=button(label,()=>{filter=k;limit=14;draw()},'filter');b.dataset.kind=k;filters.append(b);}
    main.append(input,filters,status,list);
    function draw(){for(const x of filters.children)x.setAttribute('aria-pressed',String(x.dataset.kind===filter));
      const filtered=rows.filter(q=>(filter==='all'||q.kind===filter)&&(!query||[q.q,sitting(q),q.chapterTitle||''].some(s=>s.toLowerCase().includes(query.toLowerCase()))));status.textContent=filtered.length+' '+(filtered.length===1?'question':'questions');list.replaceChildren();
      for(const q of filtered.slice(0,limit)){const words=clean(q.q).split(/\s+/),t=words.slice(0,16).join(' ')+(words.length>16?'…':'');const a=row(path('question',q.id,{chapter:c?.id||''}),t,sitting(q));bilingual(a.querySelector('.name'),q.q);list.append(a);}
      if(filtered.length>limit)list.append(button('Show more questions',()=>{limit+=20;draw()}));}
    draw();
  }
  function practice(){main.append(head('Practice'),row(path('review'),'Daily review',due().length+' questions pending in this demo queue'),row(path('bank'),'Question bank','Browse official past questions and practice cases.'),row(path('questions','61'),'Chapter 61 questions','Parkinson disease and related disorders'));}
  function viewFigure(image){const dlg=document.getElementById('figure'),slot=dlg.querySelector('.figure-scroll'),copy=image.cloneNode(true);copy.removeAttribute('loading');slot.replaceChildren(copy);dlg.showModal();}
  async function question(r,key){
    const reviewing=r.view==='review',id=reviewing?(r.id||due()[0]):r.id;
    if(!id){main.append(head('Review complete'),el('p','empty','You checked every question in this session’s review queue.'),row(path('bank'),'Continue in the question bank','Choose another clinical topic.'));return;}
    const q=await loadQuestion(id);if(key!==state.revision)return;if(!q)return missing();
    const source=chapterMap.get(r.params.get('chapter')||String(q.chapter))||chapterMap.get('61');const heading=reviewing?'Daily review':'Question';main.append(link(reviewing?path('practice'):(r.params.has('chapter')?path('questions',source.id):path('bank')),reviewing?'‹ Practice':'‹ Questions',''),head(heading));
    const questionArea=el('section','question');main.append(questionArea);
    function draw(){
      const he=rtl(q.q),letters=he?'אבגדה':'ABCDE',record=state.records.get(id),checked=!!record,selected=record?record.choice:state.selected;
      questionArea.replaceChildren();const n=clean(sitting(q))+(reviewing?' · '+(state.review.indexOf(id)+1)+' of '+state.review.length:'');
      questionArea.append(el('p','context',n));const stem=bilingual(el('div','stem'),q.q);stem.append(...markdown(q.q).childNodes);questionArea.append(stem);
      for(const src of q.images||[]){if(!/^[\w.-]+\/[\w./%-]+$/.test(src))continue;const img=el('img');img.src='../'+src;img.alt='Question figure';img.style='max-width:100%;height:auto';const b=button('',()=>viewFigure(img),'media');b.append(img);questionArea.append(b);}
      const opts=el('div','options');opts.dir=he?'rtl':'ltr';opts.lang=he?'he':'en';opts.setAttribute('role','group');opts.setAttribute('aria-label',he?'אפשרויות תשובה':'Answer options');const accepted=q.accepted||[q.c];
      q.o.forEach((option,i)=>{const b=button('',()=>{state.selected=i;draw()},'option'+(checked&&accepted.includes(i)?' correct':checked&&selected===i?' wrong':''));b.disabled=checked;b.setAttribute('aria-pressed',String(selected===i));b.append(el('span','letter',letters[i]),bilingual(el('span','',clean(option)),option));opts.append(b);});questionArea.append(opts);
      if(checked){const correct=accepted.includes(selected);const fb=el('div','feedback'+(correct?'':' wrong'));fb.append(el('strong','',correct?'Correct':'Accepted answer'+(accepted.length>1?'s':'')+' · '+accepted.map(i=>letters[i]).join(', ')));const detail=el('details','reason');detail.append(el('summary','','Explanation'),bilingual(markdown(q.explanation),q.explanation));fb.append(detail);questionArea.append(fb);}
      const controls=el('div','actions');
      if(!checked){const submit=button('Check answer',()=>{if(state.selected===null)return;state.records.set(id,{choice:state.selected});if(!accepted.includes(state.selected)&&!state.review.includes(id))state.review.push(id);if(reviewing)state.reviewed.add(id);draw()},'primary');submit.disabled=selected==null;controls.append(submit);}
      else if(reviewing){controls.append(button('Next review question',()=>{state.reviewed.add(id);location.hash=path('review',due()[0]||'');if(!due().length)render()},'primary'));}
      else controls.append(link(r.params.has('chapter')?path('questions',source.id):path('bank'),'Choose another question','primary'));
      controls.append(button(state.saved.has(id)?'Remove from Notebook':'Save to Notebook',()=>{if(state.saved.has(id))state.saved.delete(id);else state.saved.add(id);draw()}));questionArea.append(controls);
      if(checked&&q.ref){const ref=el('details','outline');ref.append(el('summary','','Source'),bilingual(el('p','meta',q.ref),q.ref));const pg=q.ref.match(/\bpp?\.?\s*(\d+)/i);if(pg&&chapterMap.has(String(q.chapter)))ref.append(link(path('read',String(q.chapter),{at:'p'+pg[1]}),'Open printed passage',''));questionArea.append(ref);}
    }draw();
  }
  async function notebook(r,key){main.append(head('Notebook'));if(!state.saved.size){main.append(el('p','empty','Questions you save in this prototype appear here until you reload the page.'),row(path('bank'),'Find a question','Open the question bank.'));return;}const saved=await Promise.all([...state.saved].map(loadQuestion));if(key!==state.revision)return;for(const q of saved.filter(Boolean)){const a=row(path('question',q.id),q.q,sitting(q));bilingual(a.querySelector('.name'),q.q);main.append(a);}}
  function missing(){main.append(head('Page not found'),link(path('home'),'Go to Home'));}
  async function render(){const key=++state.revision,r=route();state.selected=null;document.body.classList.remove('bars-hidden');main.className='';main.replaceChildren();window.scrollTo(0,0);drawNav(r.view);try{
    if(r.view==='home')home();else if(r.view==='library')await library(r,key);else if(['study','read','questions'].includes(r.view))await chapter(r,key);else if(r.view==='drug')await drug(r,key);else if(r.view==='practice')practice();else if(r.view==='bank')await questionList(r,key);else if(r.view==='question'||r.view==='review')await question(r,key);else if(r.view==='notebook')await notebook(r,key);else missing();
    if(key===state.revision){main.dataset.view=r.view;document.title=(main.querySelector('h1')?.textContent||'Study')+' · Hazzard Reader prototype';}
  }catch(e){if(key===state.revision){main.replaceChildren(head('Content unavailable'),el('p','empty',e.message),button('Try again',render));main.dataset.view='error';}}}
  const themeButton=document.getElementById('theme');
  function theme(dark){document.documentElement.dataset.theme=dark?'dark':'light';themeButton.setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');themeButton.title=themeButton.getAttribute('aria-label');}
  theme(matchMedia('(prefers-color-scheme:dark)').matches);themeButton.onclick=()=>theme(document.documentElement.dataset.theme!=='dark');
  document.getElementById('close-figure').onclick=()=>document.getElementById('figure').close();
  let lastScroll=0;addEventListener('scroll',()=>{const y=scrollY,view=route().view;if(['read','study'].includes(view)&&y>lastScroll+4&&y>70)document.body.classList.add('bars-hidden');else if(y<lastScroll||y<50)document.body.classList.remove('bars-hidden');lastScroll=y;
    if(state.last&&view===state.last.mode&&main.dataset.view===view){
      const headings=[...main.querySelectorAll('.prose h2[id],.prose h3[id]')];
      const nearest=headings.filter(n=>n.getBoundingClientRect().top<=100).at(-1);state.last.anchor=nearest?.id||'';
    }},{passive:true});
  request('./start.json').then(data=>{start=data;chapterMap=new Map(data.chapters.map(c=>[c.id,c]));questionMap=new Map(data.answers.map(q=>[q.id,q]));state.review=[...data.sample];addEventListener('hashchange',render);render()}).catch(()=>{main.replaceChildren(head('Could not open the prototype'),button('Reload',()=>location.reload()));});
})();
