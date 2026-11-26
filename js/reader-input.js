/* Finger strokes use Android's touch stream. A swipe before the hold belongs
   to the browser. Once the hold wins, preview and save share the same Range. */
function isReaderControl(target){
  return !!target?.closest?.('input,textarea,select,option,button,a[href],label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"]:not([data-mark-key]),[role="link"],dialog,[role="dialog"],#panel');
}
function bindReaderInput({state, main, begin, wordAt, paint, commit, edit, close}) {
  let timer;
  function cancel(){
    clearTimeout(timer);state.stroke=null;paint(null);
  }
  function start(event,point,type){
    cancel();
    if(isReaderControl(event.target))return;
    const stroke=begin({target:event.target,button:type==='touch'?0:event.button,
      clientX:point.clientX,clientY:point.clientY,pointerId:point.identifier??event.pointerId,
      preventDefault:()=>event.preventDefault()});
    if(!stroke)return;
    stroke.type=type;state.stroke=stroke;
    if(type!=='touch'){event.preventDefault();event.target.setPointerCapture(event.pointerId);}
    if(stroke.word)timer=setTimeout(()=>{
      if(state.stroke!==stroke||stroke.moved)return;
      stroke.selecting=true;paint(stroke.range);
    },450);
  }
  function extend(s,x,y){
    const end=wordAt(x,y);
    if(!end||!s.root.contains(end.commonAncestorContainer))return;
    const range=s.word.cloneRange();
    if(end.compareBoundaryPoints(Range.START_TO_START,range)<0)range.setStart(end.startContainer,end.startOffset);
    else range.setEnd(end.endContainer,end.endOffset);
    s.range=range;paint(range);
  }
  function move(event,point){
    const s=state.stroke;
    if(!s)return;
    const dx=point.clientX-s.x,dy=point.clientY-s.y;
    if(s.selecting){
      if(s.type==='touch'){
        if(!event.cancelable){cancel();return;}
        event.preventDefault();
      }
      extend(s,point.clientX,point.clientY);return;
    }
    if(Math.hypot(dx,dy)<8)return;
    clearTimeout(timer);s.moved=true;
    if(s.type!=='touch'){s.scroller.scrollTop=s.scroll-dy;if(s.table)s.table.scrollLeft=s.left-dx;}
  }
  function finish(event,point){
    const s=state.stroke;
    if(!s)return;
    if(s.selecting){
      extend(s,point.clientX,point.clientY);
      if(event.cancelable)event.preventDefault();
    }
    cancel();
    if(s.selecting){
      // Chrome still clicks after mouse/pen release. That click belongs to
      // the saved stroke and must not open the editor.
      strokeClick=s.type!=='touch';commit(s);
    }
    else if(!s.moved&&s.hit){
      if(event.cancelable)event.preventDefault();
      openerTarget=event.target;edit(...s.hit);
    }
  }
  // Dismissal owns the whole contact, including the compatibility click.
  // Let the browser pan on touchmove; a tap must not fall through to a link,
  // another mark, or a destination tab after the footer changes underneath it.
  let dismissedContact=false,strokeClick=false,openerTarget=null;
  const outside=target=>state.mark&&!target.closest?.('#markBar');
  document.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    dismissedContact=false;strokeClick=false;openerTarget=null;
    if(!outside(event.target))return;
    if(isReaderControl(event.target)){close();return;}
    dismissedContact=true;close();
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  document.addEventListener('touchstart',event=>{
    if(event.touches.length===1&&outside(event.target)){if(isReaderControl(event.target)){close();return;}dismissedContact=true;close();}
    if(dismissedContact)event.stopImmediatePropagation();
  },{capture:true,passive:true});
  document.addEventListener('touchend',event=>{
    if(!dismissedContact)return;
    if(event.cancelable)event.preventDefault();
    event.stopImmediatePropagation();
  },{capture:true,passive:false});
  document.addEventListener('click',event=>{
    if(isReaderControl(event.target)){dismissedContact=false;openerTarget=null;strokeClick=false;if(outside(event.target))close();return;}
    if(strokeClick&&event.detail!==0){
      strokeClick=false;event.preventDefault();event.stopImmediatePropagation();return;
    }
    if(openerTarget&&event.detail!==0&&(openerTarget===event.target||openerTarget.contains?.(event.target))){
      openerTarget=null;event.preventDefault();event.stopImmediatePropagation();return;
    }
    if(!(dismissedContact&&event.detail!==0)&&!outside(event.target))return;
    dismissedContact=false;close();event.preventDefault();event.stopImmediatePropagation();
  },true);
  document.addEventListener('wheel',event=>{if(outside(event.target))close();},{capture:true,passive:true});
  main.addEventListener('touchstart',event=>{
    if(event.touches.length!==1){cancel();return;}
    start(event,event.changedTouches[0],'touch');
  },{passive:false});
  const finger=event=>Array.from(event.changedTouches).find(point=>point.identifier===state.stroke?.id);
  main.addEventListener('touchmove',event=>{const point=finger(event);if(point&&state.stroke.type==='touch')move(event,point);},{passive:false});
  main.addEventListener('touchend',event=>{const point=finger(event);if(point&&state.stroke.type==='touch')finish(event,point);},{passive:false});
  main.addEventListener('touchcancel',cancel);
  main.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch'&&event.isPrimary&&event.button===0)start(event,event,event.pointerType);
  });
  function ownsPointer(event){return event.pointerType!=='touch'&&state.stroke?.id===event.pointerId;}
  main.addEventListener('pointermove',event=>{if(ownsPointer(event))move(event,event);});
  main.addEventListener('pointerup',event=>{if(ownsPointer(event))finish(event,event);});
  for(const type of ['pointercancel','lostpointercapture'])main.addEventListener(type,event=>{if(ownsPointer(event))cancel();});
  main.addEventListener('scroll',event=>{
    if(!event.target.closest?.('#readerScroll,#pairedStudy,#mcqViewport'))return;
    if(state.stroke?.type==='touch'&&!state.stroke.selecting)cancel();
    if(!state.stroke&&state.mark)close();
  },true);
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  return cancel;
}

// Number labels belong to a separate absolute rail. In a wrapped inline span
// the static position of ::before can be on the line *before* its first word.
function installPointRail(main){
  const rails=new Map();let frame=0;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(layout);};
  const resized=new ResizeObserver(schedule);
  function layout(){
    frame=0;
    for(const [root,rail] of rails)if(!root.isConnected){resized.unobserve(root);rails.delete(root);}
    for(const root of main.querySelectorAll('#copy,.mcq-explanation')){
      let rail=rails.get(root);
      const markers=root.querySelectorAll('[data-point]');
      if(!markers.length&&!rail)continue;
      if(!rail){rail=document.createElement('div');rail.className='point-rail';rail.dataset.readerMetadata='point-labels';
        rail.setAttribute('aria-hidden','true');root.append(rail);rails.set(root,rail);resized.observe(root);}
      const origin=rail.getBoundingClientRect(), labels=document.createDocumentFragment();
      for(const marker of markers){
        const walker=document.createTreeWalker(marker,NodeFilter.SHOW_TEXT);
        let node,index=-1;
        while(node=walker.nextNode()){index=node.data.search(/\S/u);if(index>=0)break;}
        if(!node)continue;
        const first=document.createRange();first.setStart(node,index);first.setEnd(node,index+1);
        const glyph=first.getBoundingClientRect();if(!glyph.height)continue;
        const block=marker.closest('p,li,td,th,h1,h2,h3,h4,figcaption,blockquote')||root;
        const rect=block.getBoundingClientRect(),rtl=getComputedStyle(block).direction==='rtl';
        const badge=document.createElement('span');badge.className='point-badge';badge.dataset.number=marker.dataset.point;
        badge.dataset.ink=marker.dataset.marked||'yellow';badge.dataset.side=rtl?'right':'left';
        badge.style.setProperty('--badge-ink','var(--hl-'+badge.dataset.ink+',var(--hl-yellow))');
        badge.style.left=(rtl?rect.right-origin.left+5:rect.left-origin.left-5)+'px';
        badge.style.top=(glyph.top+glyph.height/2-origin.top)+'px';labels.append(badge);
      }
      rail.replaceChildren(labels);
    }
  }
  new MutationObserver(records=>{
    if(records.some(r=>!r.target.closest?.('.point-rail')&&
      (r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&!n.matches('.point-rail,.point-badge')))))schedule();
  }).observe(main,{subtree:true,childList:true,attributes:true,attributeFilter:['data-point','data-marked','open','hidden']});
  addEventListener('resize',schedule);document.fonts?.ready.then(schedule);schedule();
}

// DOM markers remain the tap targets. Paint the whole saved range once so
// whitespace between sentence units and inline elements gets the same ink.
function installSavedHighlightPaint(main){
  if(!window.CSS?.highlights||typeof Highlight!=='function')return;
  const colours=['yellow','green','blue','pink','purple'];
  const marker='[data-marked]';
  let scheduled=false;
  function paint(){
    scheduled=false;
    const byColour=new Map(colours.map(colour=>[colour,[]]));
    for(const root of main.querySelectorAll('#copy,.mcq-explanation')){
      const marks=new Map();
      for(const part of root.querySelectorAll(marker)){
        if(part.matches('img,svg')||part.closest('[data-reader-metadata]'))continue;
        const id=part.dataset.answerHighlight||part.dataset.range||part.dataset.unit;
        if(!id||!byColour.has(part.dataset.marked))continue;
        const text=document.createTreeWalker(part,NodeFilter.SHOW_TEXT);
        let first=null,last=null,node;
        while(node=text.nextNode()){
          if(!node.length||node.parentElement.closest('[data-reader-metadata]'))continue;
          if(!first)first=node;last=node;
        }
        if(!first)continue;
        const record=marks.get(id);
        if(record)record.last=last;
        else marks.set(id,{first,last,colour:part.dataset.marked});
      }
      for(const {first,last,colour} of marks.values()){
        const range=document.createRange();range.setStart(first,0);range.setEnd(last,last.length);
        byColour.get(colour).push(range);
      }
    }
    for(const [colour,ranges] of byColour){
      const name='reader-'+colour;
      if(ranges.length){const ink=new Highlight(...ranges);ink.priority=-1;CSS.highlights.set(name,ink);}
      else CSS.highlights.delete(name);
    }
  }
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(paint);}}
  new MutationObserver(records=>{
    if(records.some(r=>r.type==='attributes'||r.target.closest?.(marker)||
      [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches(marker)||n.querySelector(marker)))))schedule();
  }).observe(main,{subtree:true,childList:true,attributes:true,attributeFilter:['data-marked','data-range','data-answer-highlight']});
  document.documentElement.classList.add('reader-range-paint');paint();
}
