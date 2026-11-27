function browserSelectsReaderText(){return document.documentElement.classList.contains('browser-text-selection');}
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
    if(browserSelectsReaderText()||isReaderControl(event.target))return;
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
  },true);
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  return cancel;
}

// Edit canonical character intervals once, before repainting any DOM fragments.
function planHighlightStroke(text,start,end,items){
  const hits=items.filter(m=>m.start<end&&m.end>start).sort((a,b)=>a.start-b.start||a.end-b.end);
  let cursor=start,covered=true;
  for(const hit of hits){
    if(hit.start>cursor&&text.slice(cursor,hit.start).trim())covered=false;
    cursor=Math.max(cursor,hit.end);
  }
  covered=covered&&cursor>=end;
  const pieces=[],consumed=[];
  for(const hit of hits){
    let kept=false;
    for(let [left,right] of [[hit.start,Math.min(hit.end,start)],[Math.max(hit.start,end),hit.end]]){
      while(left<right&&/\s/.test(text[left]))left++;
      while(left<right&&/\s/.test(text[right-1]))right--;
      if(left>=right||!/[\p{L}\p{N}\p{M}\p{S}]/u.test(text.slice(left,right)))continue;
      pieces.push({start:left,end:right,source:hit,inherit:!kept});kept=true;
    }
    if(!kept)consumed.push(hit);
  }
  return {hits,pieces,consumed,paint:!covered};
}

// Section identity is derived from the printed headings. Keep existing
// record IDs and use the shorter selection first when two start at the same word.
function chapterPointOrder(items){
  const order=new Map(),sections=new Map();
  for(const item of items.filter(i=>i.mark.number).sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id))){
    const group=item.group??null;
    const number=(sections.get(group)||0)+1;
    sections.set(group,number);order.set(item.id,number);
  }
  return order;
}
function numberPlacedPoints(items,stamp){
  const order=chapterPointOrder(items);
  let changed=false;
  for(const {id,mark} of items){
    const number=order.get(id);
    if(number&&mark.number!==number){mark.number=number;changed=true;if(stamp)mark[stamp]=Math.max(Date.now(),(mark[stamp]||0)+1);}
  }
  return changed;
}
function displayPointOrder(root){
  let number=0;
  for(const marker of root.querySelectorAll('[data-mark-key][data-point]'))marker.dataset.point=String(++number);
}
function installPointRail(main,openMark){
  const rails=new Map();let frame=0;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(layout);};
  const resized=new ResizeObserver(schedule);
  function layout(){
    frame=0;
    for(const [root] of rails)if(!root.isConnected){resized.unobserve(root);rails.delete(root);}
    for(const root of main.querySelectorAll('#copy,.mcq-explanation')){
      let rail=rails.get(root);
      // These lists carry their printed ordinals. The marked words still open their point editor.
      const markers=[...root.querySelectorAll('[data-mark-key][data-point]')].filter(marker=>!marker.closest('ol.clinical-point-list'));
      // Reserve space only on the starting side that actually carries point labels.
      const blocks=new Map(),styles=new Map(),sides=new Set();
      for(const marker of markers){
        const block=marker.closest('p,li,td,th,h1,h2,h3,h4,figcaption,blockquote')||root;
        blocks.set(marker,block);
        if(!styles.has(block))styles.set(block,getComputedStyle(block));
        sides.add(styles.get(block).direction==='rtl'?'right':'left');
      }
      const resizeRail=['left','right'].some(side=>root.classList.contains('points-'+side)!==sides.has(side));
      if(resizeRail){
        for(const side of ['left','right'])root.classList.toggle('points-'+side,sides.has(side));
        schedule();continue;
      }
      if(!markers.length&&!rail)continue;
      if(!rail){
        rail=document.createElement('div');rail.className='point-rail';rail.dataset.readerMetadata='point-labels';
        rail.addEventListener('click',event=>{const badge=event.target.closest('button[data-mark-id]');if(badge)openMark(badge.dataset.kind,badge.dataset.markId);});
        root.append(rail);rails.set(root,rail);resized.observe(root);
      }
      const origin=rail.getBoundingClientRect(),lines=[],seen=new Set();
      const scale=parseFloat(getComputedStyle(root).getPropertyValue('--fs'))||1;
      const size=44;
      for(const marker of markers){
        const id=marker.dataset.markKey,number=marker.dataset.point;
        if(seen.has(id)||marker.closest('[hidden]'))continue;
        // A closed details can retain layout rectangles. Only its summary is painted.
        let folded=false;
        for(let details=marker.closest('details:not([open])');details;details=details.parentElement?.closest('details:not([open])')){
          if(!details.querySelector(':scope > summary')?.contains(marker)){folded=true;break;}
        }
        if(folded)continue;
        const walker=document.createTreeWalker(marker,NodeFilter.SHOW_TEXT);
        let glyph;
        while(walker.nextNode()){
          const node=walker.currentNode,index=node.data.search(/\S/u);
          if(index<0||node.parentElement.closest('[hidden]'))continue;
          const first=document.createRange();first.setStart(node,index);first.setEnd(node,index+1);
          const rect=first.getBoundingClientRect();if(rect.height){glyph=rect;break;}
        }
        if(!glyph)continue;
        seen.add(id);
        const block=blocks.get(marker),style=styles.get(block),rtl=style.direction==='rtl';
        const rect=root.id==='copy'?origin:block.getBoundingClientRect();
        const edge=rtl?rect.right:rect.left;
        const middle=glyph.top-origin.top+glyph.height/2;
        let line=lines.at(-1);
        if(!line||line.block!==block||Math.abs(line.middle-middle)>3){
          line={block,middle,edge,rtl,buttons:[],height:size};
          lines.push(line);
        }
        const badge=document.createElement('button');badge.type='button';badge.className='point-badge';
        badge.dataset.number=number;const chip=document.createElement("span");chip.textContent=number;badge.append(chip);
        badge.dataset.markId=id;badge.dataset.kind=marker.dataset.answerHighlight?'answer':marker.dataset.recordKind||(marker.dataset.range?'ranges':'marks');
        const ink=marker.dataset.pointInk||marker.dataset.marked;
        badge.dataset.ink=ink;badge.dataset.side=rtl?'right':'left';
        badge.setAttribute('aria-label','Edit point '+number);badge.style.setProperty('--badge-ink','var(--hl-'+ink+')');
        line.buttons.push(badge);
      }
      const port=root.closest('#readerScroll,#mcqViewport')?.getBoundingClientRect();
      const view=window.visualViewport;
      const leftLimit=Math.max(port?.left??0,view?.offsetLeft??0)+2;
      const rightLimit=Math.min(port?.right??innerWidth,(view?.offsetLeft??0)+(view?.width??document.documentElement.clientWidth))-2;
      const fragment=document.createDocumentFragment();
      for(const line of lines){
        const group=document.createElement('div');group.className='point-badge-line';group.dir=line.rtl?'rtl':'ltr';
        const gap=3;
        const room=line.rtl?rightLimit-line.edge-gap:line.edge-leftLimit-gap;
        const digits=Math.max(...line.buttons.map(b=>b.textContent.length));
        const width=Math.max(1,Math.min(room,Math.max(size,(digits*8+6)*scale)));
        const x=line.rtl?line.edge+gap:line.edge-gap-width;
        group.style.width=width+'px';
        group.style.left=(Math.max(leftLimit,Math.min(x,rightLimit-width))-origin.left)+'px';
        group.style.setProperty('--point-height',line.height+'px');
        group.append(...line.buttons);fragment.append(group);line.element=group;
      }
      // Same-line points share a margin row. If a crowded row wraps, keep the
      // following labels clear without moving any of the chapter's text.
      const bottom={};
      for(const line of lines.sort((a,b)=>a.middle-b.middle)){
        const height=line.height*line.buttons.length+Math.max(0,line.buttons.length-1);
        const side=line.rtl?'right':'left',top=Math.max(0,line.middle-height/2,bottom[side]??-Infinity);
        line.element.style.top=top+'px';bottom[side]=top+height+1;
      }
      rail.replaceChildren(fragment);
    }
  }
  new MutationObserver(records=>{
    if(records.some(r=>!r.target.closest?.('.point-rail')&&
      (r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&!n.matches('.point-rail,.point-badge')))))schedule();
  }).observe(main,{subtree:true,childList:true,attributes:true,attributeFilter:['data-point','data-point-ink','data-marked','open','hidden']});
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
