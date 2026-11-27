/* One URL describes the visible surface. Browser history supplies Back and Forward. */
window.HazzardRouter=(()=>{
  let activate,leave,tail=Promise.resolve(),generation=0;
  function owns(url){
    const path=s=>s.replace(/\/index\.html$/,'/');
    return url.origin===location.origin&&path(url.pathname)===path(location.pathname);
  }
  function canonical(url){
    if(url.searchParams.get('review')==='1'&&(!url.searchParams.has('chapter')||url.searchParams.get('chapter')==='bank')){
      if(!url.searchParams.has('chapter')){const prior=new URLSearchParams(url.search);url.search='';url.searchParams.set('chapter','bank');for(const [key,value] of prior)url.searchParams.append(key,value);}
      if(url.searchParams.get('queue')==='today')url.searchParams.delete('queue');
    }
    return url;
  }
  function render(url,state,back=false,force=false){
    const request=++generation;
    tail=tail.catch(()=>{}).then(()=>{
      if(request===generation)return activate(url,state,back,()=>request===generation,force);
    }).catch(error=>{
      if(request!==generation)return;
      document.dispatchEvent(new CustomEvent('reader-route-error',{detail:error}));
    });
    return tail;
  }
  function go(href,{replace=false,state={},force=false}={}){
    const url=new URL(href,location.href);
    if(!owns(url)){location.assign(url.href);return;}
    canonical(url);
    if(!activate)return;
    if(!force&&url.href===location.href)return tail;
    if(url.href!==location.href){
      leave?.();
      history[replace?'replaceState':'pushState']({...state,hazzardPreviousURL:replace?history.state?.hazzardPreviousURL:location.href},'',url);
    }
    return render(url,history.state,false,force);
  }
  function start(onRoute,onLeave){
    activate=onRoute;leave=onLeave;
    addEventListener('popstate',()=>render(new URL(location.href),history.state,true));
    document.addEventListener('click',event=>{
      const link=event.target.closest?.('a[href]');
      if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||
         link.hasAttribute('download')||link.target&&link.target!=='_self')return;
      const url=new URL(link.href);
      if(!owns(url)||!url.search&&!url.hash)return;
      event.preventDefault();go(url);
    });
    return render(new URL(location.href),history.state);
  }
  return {go,start,settled:()=>tail,owns,canonical};
})();
