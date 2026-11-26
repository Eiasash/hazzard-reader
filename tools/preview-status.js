/* Preview updates activate on load. The worker fills its offline cache afterwards. */
(() => {
  const version = __RELEASE__;
  window.HazzardRelease = Object.freeze({version});
  function start() {
    const chip=document.getElementById('readerStatusChip'),detail=document.getElementById('releaseStatus');
    const legacy=document.getElementById('offlineReady'),sw=navigator.serviceWorker;
    let complete=false,percent=0;
    function render() {
      const offline=complete?'Offline ready':navigator.onLine?'Saving offline copy · '+percent+'%':'Offline copy incomplete';
      chip.dataset.readiness=complete?'ready':'incomplete';
      chip.dataset.status=navigator.onLine?'online':'offline';
      chip.setAttribute('aria-label',version+' · '+offline);
      chip.closest('button').title='Text & appearance · '+offline;
      detail.textContent=version+' · '+offline;
      if(legacy){legacy.textContent=offline;legacy.hidden=false;}
      document.querySelectorAll('[data-chapter-update]').forEach(button=>{button.hidden=true;});
    }
    function refresh() {
      const worker=sw?.controller;
      worker?.postMessage({type:'HAZZARD_OFFLINE_STATUS'});
      if(navigator.onLine)worker?.postMessage({type:'PREVIEW_BACKGROUND'});
      render();
    }
    sw?.addEventListener('message',event=>{
      if(event.source!==sw.controller || event.data?.type!=='HAZZARD_OFFLINE_STATUS' || event.data.version!==version)return;
      percent=event.data.progress||0;complete=event.data.complete===true;render();
    });
    sw?.addEventListener('controllerchange',refresh);
    sw?.register('sw.js',{updateViaCache:'none'}).then(reg=>{
      // Check even when reopening a previously installed tab on the same day.
      reg.update().catch(()=>{});
      return sw.ready;
    }).then(refresh).catch(render);
    addEventListener('online',refresh);addEventListener('offline',render);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    render();
  }
  if(window.HazzardPrepareUpdate)start();
  else addEventListener('hazzard-reader-ready',start,{once:true});
})();
