/* Preview updates activate on load. The worker fills its offline cache afterwards. */
(() => {
  const version = __RELEASE__;
  window.HazzardRelease = Object.freeze({version});
  function start() {
    const chip=document.getElementById('readerStatusChip'),detail=document.getElementById('releaseStatus');
    const legacy=document.getElementById('offlineReady'),sw=navigator.serviceWorker;
    const action=document.getElementById('downloadOffline'),summary=document.getElementById('appearanceSummary');
    let complete=false,percent=0,running=false,requested=false,failed=false,registrationFailed=false;
    function render() {
      const unavailable=!sw||registrationFailed;
      const offline=complete?'Offline ready':unavailable?'Offline storage unavailable':!navigator.onLine?'Offline copy incomplete':
        failed?'Offline download interrupted':running||requested?'Saving offline copy · '+percent+'%':sw.controller?'Offline copy incomplete':'Preparing offline storage';
      chip.dataset.readiness=complete?'ready':'incomplete';
      chip.dataset.status=navigator.onLine?'online':'offline';
      chip.setAttribute('aria-label',version+' · '+offline);
      chip.closest('button').title='Settings · '+offline;
      detail.textContent=version+' · '+offline;
      if(summary){summary.textContent=version+' · '+offline;summary.title='Storage and offline details';}
      if(action){
        const reason=complete?'The offline copy is already saved.':unavailable?'This browser could not start offline storage.':
          !navigator.onLine?'Reconnect to download the offline copy.':!sw.controller?'Preparing offline storage…':
          running||requested?'Downloading · '+percent+'%':'';
        action.textContent=complete?'Offline ready':failed?'Retry offline download':'Download for offline';
        setButtonUnavailable(action,reason);
      }
      if(legacy){legacy.textContent=offline;legacy.hidden=false;}
      document.querySelectorAll('[data-chapter-update]').forEach(button=>{button.hidden=true;});
    }
    function download(){
      const worker=sw?.controller;
      if(!worker||complete||!navigator.onLine)return;
      requested=true;failed=false;render();
      worker.postMessage({type:'PREVIEW_BACKGROUND'});
    }
    if(action)action.onclick=download;
    function refresh() {
      const worker=sw?.controller;
      worker?.postMessage({type:'HAZZARD_OFFLINE_STATUS'});
      if(worker&&navigator.onLine&&!complete)download();
      render();
    }
    sw?.addEventListener('message',event=>{
      if(event.source!==sw.controller || event.data?.type!=='HAZZARD_OFFLINE_STATUS' || event.data.version!==version)return;
      percent=event.data.progress||0;complete=event.data.complete===true;running=event.data.downloading===true;failed=event.data.interrupted===true;requested=false;render();
    });
    sw?.addEventListener('controllerchange',()=>{complete=running=requested=failed=false;percent=0;refresh();});
    sw?.register('sw.js',{updateViaCache:'none'}).then(reg=>{
      // Check even when reopening a previously installed tab on the same day.
      reg.update().catch(()=>{});
      return sw.ready;
    }).then(refresh).catch(()=>{registrationFailed=true;render();});
    addEventListener('online',refresh);addEventListener('offline',render);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    render();
  }
  if(window.HazzardPrepareUpdate)start();
  else addEventListener('hazzard-reader-ready',start,{once:true});
})();
