/* Finger strokes use Android's touch stream. A swipe before the hold belongs
   to the browser. Once the hold wins, preview and save share the same Range. */
function bindReaderInput({state, main, begin, wordAt, paint, commit, edit, close}) {
  let timer;
  function cancel(){
    clearTimeout(timer);state.stroke=null;paint(null);
  }
  function start(event,point,type){
    cancel();
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
    if(s.selecting)commit(s);
    else if(!s.moved&&s.hit)edit(...s.hit);
  }
  // Dismissal owns the whole contact, including the compatibility click.
  // Let the browser pan on touchmove; a tap must not fall through to a link,
  // another mark, or a destination tab after the footer changes underneath it.
  let dismissedContact=false;
  const outside=target=>(state.mark||state.bar.undo)&&!target.closest?.('#markBar');
  document.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    dismissedContact=false;
    if(!outside(event.target))return;
    dismissedContact=true;close();
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  document.addEventListener('touchstart',event=>{
    if(event.touches.length===1&&outside(event.target)){dismissedContact=true;close();}
    if(dismissedContact)event.stopImmediatePropagation();
  },{capture:true,passive:true});
  document.addEventListener('touchend',event=>{
    if(!dismissedContact)return;
    if(event.cancelable)event.preventDefault();
    event.stopImmediatePropagation();
  },{capture:true,passive:false});
  document.addEventListener('click',event=>{
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
    if(!state.stroke&&(state.mark||state.bar.undo))close();
  },true);
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  return cancel;
}
