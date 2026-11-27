/* The reader and search builder render the same canonical chapter files. */
window.HazzardChapterContent=(()=>{
function renderMarkdown(mdText,chapter,imageSizes={}){
  // marked v12 mis-pairs some **bold** runs (e.g. "cm²**, … **>"), leaving literal ** on screen. Pre-convert simple one-line bold.
  mdText=mdText.replace(/(?<![\\*])\*\*(?![\s*])([^*\n]*?\S)(?<![\\*])\*\*(?!\*)/g,(m,t)=>'<strong>'+t.replace(/~/g,'&#126;')+'</strong>');
  mdText=mdText.split('\n').map(line=>line.includes('<')&&line.includes('>')?line.replace(/(?<![\\*\w])\*(?![\s*])([^*\n]*?\S)(?<![\\*])\*(?!\*)/g,'<em>$1</em>'):line).join('\n');
  let html=marked.parse(mdText);
  if(['42','43','44','55','59','63','87'].includes(chapter)){
    html=html.replace(/(<h[1-6]>)([\s\S]*?)(<\/h[1-6]>)/g,(_,open,inner,close)=>{
      let first=true;
      inner=inner.split(/(<[^>]+>)/g).map(part=>part.startsWith('<')?part:part.replace(/[A-Za-z]+/g,word=>{
        const initial=first;first=false;
        if(!initial&&/^(?:A|An|And|As|At|By|For|From|In|Of|On|Or|The|To|With)$/.test(word))return '<span style="text-transform:lowercase">'+word+'</span>';
        if(word==='physical')return '<span style="text-transform:capitalize">'+word+'</span>';
        return word;
      })).join('');
      return open+inner+close;
    });
  }
  html=html.replace(/<table>/g,'<div class="table-wrap" tabindex="0" role="region" aria-label="Table" data-md="1"><table>');
  html=html.replace(/<\/table>/g,'</table></div>');
  html=html.replace(/<blockquote>\s*/g,'<div class="note">').replace(/\s*<\/blockquote>/g,'</div>');
  html=html.replace(/<p><img src="([^"\/]+\.(?:png|jpg|jpeg|gif|svg|webp))" alt="([^"]*)"><\/p>/g,(m,file,alt)=>`<figure><img src="chapters/${file}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`);
  html=html.replace(/<img src="([^"\/]+\.(?:png|jpg|jpeg|gif|svg|webp))" alt="([^"]*)">/g,(m,file,alt)=>`<img src="chapters/${file}" alt="${alt}">`);
  const usedIds=new Set();
  html=html.replace(/<h([123])>([\s\S]*?)<\/h\1>/g,(m,level,inner)=>{
    const text=inner.replace(/<[^>]+>/g,'');
    let slug=text.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'section';
    let unique=slug,i=2;while(usedIds.has(unique))unique=slug+'-'+(i++);usedIds.add(unique);
    return '<h'+level+' id="'+unique+'">'+inner+'</h'+level+'>';
  });
  html=html.replace(/<img\b[^>]*>/g,tag=>{
    const source=tag.match(/src="([^"]+)"/),dimensions=source&&imageSizes[source[1].split('/').pop()];
    return tag.slice(0,-1)+' loading="lazy" decoding="async"'+(dimensions?' width="'+dimensions[0]+'" height="'+dimensions[1]+'"':'')+'>';
  });
  return html;
}
function smoothPageMarkers(copy){
  for(const a of [...copy.querySelectorAll('a[id]')]){
    if(!/^p\d+$/.test(a.id))continue;
    let s=a.nextSibling;while(s&&s.nodeType===3&&!s.data.trim())s=s.nextSibling;
    const m=s&&s.nodeType===1&&s.tagName==='STRONG'&&s.textContent.trim().match(/^\[p\.\s*(\d+)\]$/);
    if(!m)continue;
    const flagNode=s.nextSibling,flag=flagNode?.textContent.match(/^\s*⟨2026[^⟩]*⟩/);
    if(flag){
      a.dataset.exam='2026';
      if(flagNode.nodeType===3){const badge=document.createElement('span');badge.className='exam-page-badge';badge.textContent=flag[0].trim();flagNode.before(document.createTextNode(flag[0].match(/^\s*/)[0]),badge);flagNode.data=flagNode.data.slice(flag[0].length)}
    }
    s.remove();a.className='pg';a.dataset.page=m[1];a.dataset.readerMetadata='page';a.setAttribute('role','note');a.setAttribute('aria-label','Page '+m[1]);
  }
  const sentenceEnd=/[.!?]["”’)\]]*$/;
  for(const a of [...copy.querySelectorAll('a.pg')]){
    const p=a.parentElement;if(!p||p.tagName!=='P')continue;
    const pre=document.createRange();pre.setStart(p,0);pre.setEndBefore(a);if(pre.toString().trim())continue;
    const prev=p.previousElementSibling;
    if(!prev||prev.tagName!=='P'||prev.querySelector('img')||!prev.textContent.trim()||sentenceEnd.test(prev.textContent.trim()))continue;
    const post=document.createRange();post.setStartAfter(a);post.setEnd(p,p.childNodes.length);
    if(p.querySelector('img'))continue;
    const rest=post.toString().replace(/⟨[^⟩]*⟩/g,'').trim();
    if(rest){prev.append(' ',...p.childNodes);p.remove();continue}
    const next=p.nextElementSibling;
    if(!next||next.tagName!=='P'||next.querySelector('img'))continue;
    prev.append(' ',...p.childNodes,' ',...next.childNodes);p.remove();next.remove();
  }
}

const searchText=node=>node.textContent.replace(/\s+/g,' ').trim();
function searchBlocks(root){return [...root.querySelectorAll('h1,h2,h3,h4,p,li,td,th,caption,figcaption,.book-caption,summary')].filter(n=>!n.closest('[data-reader-metadata]')&&!n.querySelector('p,li,td,th,details,h1,h2,h3,h4')&&searchText(n))}
// Only build-listed nodes are visited. Personal markup and user gestures never trigger a bidi scan.
function textKey(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);
  return (hash>>>0).toString(36);
}
function applyLayout(article,layout){
  if(!layout)return;
  const at=path=>path.reduce((node,index)=>node?.childNodes[index],article);
  const runs=layout.runs.map(([path,key,markup])=>[at(path),key,markup]);
  for(const [path,tag] of layout.dir){const el=at(path);if(el?.tagName===tag){el.dir='rtl';el.lang='he';}}
  const fragment=document.createElement('template');
  for(const [node,key,markup] of runs){
    if(node?.nodeType!==Node.TEXT_NODE||textKey(node.data)!==key)continue;
    fragment.innerHTML=markup;node.replaceWith(fragment.content);
  }
}
return {renderMarkdown,smoothPageMarkers,searchText,searchBlocks,textKey,applyLayout};
})();
