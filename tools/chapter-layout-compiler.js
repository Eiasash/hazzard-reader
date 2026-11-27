/* Run in the build browser, before sentence units and personal marks exist. */
window.compileChapterLayout=function(root,chapter){
  const hebrew=/[\u0590-\u05ff]/u,letters=/\p{L}/u;
  const blocks='p,li,td,th,summary,h1,h2,h3,h4,h5,h6,figcaption,blockquote,div,section';
  const skip='bdi,script,style,textarea,input,option,svg,[data-reader-metadata],[data-bidi-edge]';
  const numeric=/\d+(?:[./]\d+)*(?:[ \t]*[–—−-][ \t]*\d+(?:[./]\d+)*)*[%‰]?/u;
  const latin=/\p{Script=Latin}[\p{Script=Latin}\p{M}\d]*(?:(?:[-–—−’'/_.:]|[ \t]+|,[ \t]+)[\p{Script=Latin}\d][\p{Script=Latin}\p{M}\d]*)*/u;
  const section=/§{1,2}[ \t]*\d+[\u05d0-\u05ea]{0,3}(?:\((?:\d+|[\u05d0-\u05ea]{1,3})\))*(?:[ \t]*[,/–—-][ \t]*(?:§{1,2}[ \t]*)?\d+[\u05d0-\u05ea]{0,3}(?:\((?:\d+|[\u05d0-\u05ea]{1,3})\))*)*/u;
  const date=/\d{1,2}\.\d{1,2}\.\d{4}(?:,[ \t]*[a-z]+(?:\.[a-z]+)+)?/u;
  const mixed=new RegExp(['\\((?:'+section.source+'|'+date.source+')\\)[.,]?',section.source,date.source,numeric.source,latin.source].join('|'),'gu');
  const simple=new RegExp(['\\('+section.source+'\\)',section.source,numeric.source].join('|'),'gu');
  const dir=[],runs=[],edits=new Map();
  const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const path=node=>{const indices=[];while(node!==root){const parent=node.parentNode;indices.unshift(Array.prototype.indexOf.call(parent.childNodes,node));node=parent;}return indices;};
  for(const block of root.querySelectorAll(blocks)){
    if(block.closest(skip))continue;
    const source=block.textContent,first=source.match(letters)?.[0],rtl=!!(first&&hebrew.test(first));
    if(rtl&&block.matches('p,li,td,th,summary,h1,h2,h3,h4,h5,h6,figcaption,blockquote'))dir.push([path(block),block.tagName]);
    if(!hebrew.test(source)&&!block.closest('[dir=rtl]')&&!/^laws?$/.test(chapter))continue;
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    let nodes=[],text='';
    function finish(){
      if(!text)return;
      const pattern=rtl||block.closest('[dir=rtl]')||/^laws?$/.test(chapter)?mixed:simple;
      for(const m of text.matchAll(pattern)){
        const from=m.index,to=from+m[0].length;
        for(const {node,start} of nodes){
          const lo=Math.max(start,from),hi=Math.min(start+node.length,to);
          if(lo>=hi)continue;
          const edge=lo===from&&hi===to?'both':lo===from?'start':hi===to?'end':'middle';
          let changes=edits.get(node);if(!changes)edits.set(node,changes=[]);
          changes.push([lo-start,hi-start,edge]);
        }
      }
      nodes=[];text='';
    }
    for(let n;n=walker.nextNode();){
      if(n.parentElement.closest(skip)||n.parentElement.closest(blocks)!==block){finish();continue;}
      nodes.push({node:n,start:text.length});text+=n.data;
    }
    finish();
  }
  for(const [node,changes] of edits){
    let html='',offset=0;
    for(const [start,end,edge] of changes){
      html+=escape(node.data.slice(offset,start))+'<span data-bidi-edge="'+edge+'">'+escape(node.data.slice(start,end))+'</span>';offset=end;
    }
    html+=escape(node.data.slice(offset));runs.push([path(node),HazzardChapterContent.textKey(node.data),html]);
  }
  return {dir,runs};
};
