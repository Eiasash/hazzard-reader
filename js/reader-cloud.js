/* Optional cloud copies use the same portable notebook as the download. */
window.HazzardCloud = (() => {
  const URL='https://krmlzwwelqvlfslwltol.supabase.co/rest/v1/rpc/';
  const APIKEY='sb_publishable_tUuqQQ8RKMvLDwTz5cKkOg_o_y-rHtw';
  const SESSION='hazzard-cloud-session-v1',STATE='hazzard-cloud-state-v1',INTERVAL=120000;
  const read=key=>{try{return JSON.parse(localStorage.getItem(key))||{};}catch{return {};}};
  let session=read(SESSION),state=read(STATE),bridge,timer,busy=false,checking=false,restoring=false,epoch=0;
  let current=null,previous=null,known=false,error='',notice='',expired=false,tick=false,lastUploaded=null;
  const $=id=>document.getElementById(id);
  const signed=()=>typeof session.session_token==='string'&&!!session.session_token&&typeof session.username==='string';
  const decided=()=>signed()&&state.username===session.username&&state.decided===true;
  // UI-only health: offline alone is never a paused cloud connection.
  const pauseAt=()=>state.dirty&&state.syncedAt?new Date(state.syncedAt).getTime()+86400000:NaN;
  const paused=()=>navigator.onLine&&!!(session.username||state.username)&&(expired||!signed()||Date.now()>pauseAt());
  function saveState(){localStorage.setItem(STATE,JSON.stringify(state));}
  const time=(at,date=false)=>{
    if(!at||!Number.isFinite(new Date(at).getTime()))return '';
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
    const part=name=>parts.find(p=>p.type===name).value;
    return (date?part('day')+'.'+part('month')+' ':'')+part('hour')+':'+part('minute');
  };
  function label(){return expired?'Cloud: sign in again':!signed()?'Cloud: not signed in':'Cloud: '+session.username+(state.syncedAt?' - last synced '+time(state.syncedAt):' - not synced yet');}
  function render(){
    if(!bridge)return;
    $('cloudStatus').textContent=label();
    $('cloudError').textContent=error||notice;
    $('cloudLogin').hidden=signed();$('cloudActions').hidden=!signed();
    $('cloudDecision').hidden=!signed()||decided()||!known;
    $('cloudDecisionText').textContent=current?.exists?'Choose which notebook to use on this phone.':'No cloud copy yet. Choose Start fresh to enable uploads.';
    $('cloudUseLocal').hidden=!bridge.hasData()||!current?.exists;
    $('cloudStartFresh').hidden=bridge.hasData()&&!!current?.exists;
    $('cloudRestore').disabled=busy||checking||!known||!current?.exists;
    $('cloudPrevious').disabled=busy||checking||!known||!previous?.exists;
    $('cloudRestore').textContent='Restore from cloud'+(current?.exists?' (saved '+time(current.updated_at,true)+')':'');
    $('cloudPrevious').textContent='Restore previous cloud copy'+(previous?.exists?' (saved '+time(previous.updated_at,true)+')':'');
    $('cloudSync').disabled=busy||checking||!decided();
    $('cloudUseLocal').disabled=busy||checking;$('cloudStartFresh').disabled=busy||checking;
    dispatchEvent(new Event('hazzard-cloud-status'));
  }
  function expire(){
    epoch++;session={};expired=true;tick=false;clearTimeout(timer);
    try{localStorage.removeItem(SESSION);}catch{}
    error='';render();
  }
  async function rpc(name,args,keepalive=false,token=session.session_token){
    const response=await fetch(URL+name,{method:'POST',headers:{apikey:APIKEY,'Content-Type':'application/json'},body:JSON.stringify(args),keepalive,signal:AbortSignal.timeout(20000)});
    const result=await response.json();
    if(result?.error==='not_signed_in'&&token===session.session_token){expire();throw Error('Cloud: sign in again');}
    if(!response.ok||result?.ok!==true)throw Error(result?.error==='locked'?'Account locked. Try again later.':result?.error==='invalid_credentials'?'Incorrect username or password.':'Cloud unavailable. Will retry later.');
    return result;
  }
  function schedule(){
    clearTimeout(timer);
    if(!signed()||!decided()||restoring)return;
    timer=setTimeout(()=>push(),Math.max(2000,INTERVAL-(Date.now()-(state.attemptAt||0))));
  }
  async function inspect(){
    if(!signed()||checking)return;
    checking=true;const generation=epoch,token=session.session_token;render();
    try{
      const a=await rpc('hazzard_cloud_get',{p_token:token,p_which:'current'},false,token);
      const b=await rpc('hazzard_cloud_get',{p_token:token,p_which:'prev'},false,token);
      if(generation!==epoch)return;
      current=a;previous=b;known=true;error='';
      if(!decided()&&bridge.hasData()&&!a.exists){state={username:session.username,decided:true,dirty:true};saveState();}
      if(decided())schedule();
    }catch(e){if(generation===epoch)error=e.message;}
    finally{checking=false;render();if(signed()&&!known){clearTimeout(timer);timer=setTimeout(inspect,INTERVAL);}}
  }
  async function push({manual=false,keepalive=false}={}){
    if(!signed()||!decided()||busy||restoring)return;
    if(!manual&&!state.dirty)return;
    if(!navigator.onLine){schedule();return;}
    if(!manual&&!keepalive&&Date.now()-(state.attemptAt||0)<INTERVAL){schedule();return;}
    busy=true;clearTimeout(timer);const generation=epoch,token=session.session_token;
    let payload;
    try{
      payload=bridge.capture();
      if(!manual&&JSON.stringify(payload.storage)===lastUploaded){state.dirty=false;saveState();return;}
      state.attemptAt=Date.now();saveState();render();
      const result=await rpc('hazzard_cloud_set',{p_token:token,p_data:payload,p_app_version:'v56-r2',p_device:navigator.userAgent},keepalive,token);
      if(generation!==epoch)return;
      lastUploaded=JSON.stringify(payload.storage);state.syncedAt=result.updated_at||new Date().toISOString();
      state.dirty=JSON.stringify(bridge.capture().storage)!==JSON.stringify(payload.storage);
      saveState();tick=true;error='';notice='';
      previous=current?.exists?current:previous;
      current={exists:true,updated_at:state.syncedAt,data:payload};
    }catch(e){if(generation===epoch){tick=false;error=expired?'':e.message;}}
    finally{busy=false;render();if(signed()&&state.dirty)schedule();}
  }
  function changed(){
    if(restoring||!decided())return;
    state.dirty=true;tick=false;
    try{saveState();}catch{error='Cloud settings could not be saved.';}
    render();schedule();
  }
  function choose(){
    try{state={username:session.username,decided:true,dirty:true};saveState();error='';render();push({manual:true});}
    catch{error='Cloud settings could not be saved.';render();}
  }
  async function restore(which){
    if(busy||restoring||!signed())return;
    busy=true;const generation=epoch,token=session.session_token;render();
    try{
      // Fetch at the tap: another device may have updated either copy.
      const copy=await rpc('hazzard_cloud_get',{p_token:token,p_which:which},false,token);
      if(generation!==epoch)return;
      if(!copy.exists)throw Error('No cloud copy is available.');
      if(!confirm('Restore '+(which==='prev'?'previous cloud copy':'from cloud')+' (saved '+time(copy.updated_at,true)+')? This replaces this phone’s notebook. A local snapshot is saved first.'))return;
      restoring=true;clearTimeout(timer);
      await bridge.restore(copy.data);
      if(generation!==epoch)return;
      state={username:session.username,decided:true,dirty:false};saveState();
      tick=false;error='';notice='Cloud copy restored. Local snapshot kept.';
      // Do not immediately re-upload a restore: retain the server's previous copy.
    }catch(e){if(generation===epoch)error=e.message||'Restore failed.';}
    finally{restoring=false;busy=false;render();}
  }
  function start(api){
    bridge=api;
    // Keep sign-in history without retaining a signed-out device's upload decision.
    if(!signed())state=state.username?{username:state.username}:{};
    if(signed()&&state.username!==session.username){
      state={username:session.username};
      try{saveState();}catch{error='Cloud settings could not be saved.';}
    }
    $('cloudLogin').addEventListener('submit',async event=>{
      event.preventDefault();const button=$('cloudSignIn');if(button.disabled)return;
      button.disabled=true;error='';notice='';render();const generation=++epoch;
      const username=$('cloudUsername').value.trim(),password=$('cloudPassword').value;
      try{
        const result=await rpc('auth_login_user',{p_username:username,p_password:password});
        if(generation!==epoch)return;
        if(typeof result.session_token!=='string'||!result.session_token||typeof result.username!=='string')throw Error('Sign-in response was incomplete.');
        const next={session_token:result.session_token,username:result.username};
        localStorage.setItem(SESSION,JSON.stringify(next));session=next;expired=false;tick=false;known=false;lastUploaded=null;
        if(state.username!==session.username){state={username:session.username};saveState();}
        await inspect();
      }catch(e){error=e.message;}
      finally{$('cloudPassword').value='';button.disabled=false;render();}
    });
    $('cloudUsername').value=session.username||state.username||'';
    $('cloudSignOut').onclick=()=>{
      try{localStorage.removeItem(SESSION);epoch++;session={};expired=false;tick=false;known=false;current=null;previous=null;clearTimeout(timer);error='';notice='';}
      catch{error='Sign out could not be saved.';}
      render();
    };
    $('cloudUseLocal').onclick=choose;$('cloudStartFresh').onclick=choose;
    $('cloudSync').onclick=()=>push({manual:true});
    $('cloudRestore').onclick=()=>restore('current');$('cloudPrevious').onclick=()=>restore('prev');
    addEventListener('hazzard-snapshot-saved',changed);
    addEventListener('online',()=>{if(!known)inspect();else schedule();});
    // Lifecycle flush bypasses the foreground debounce; failures retain dirty state.
    const leave=()=>{if(decided()&&!restoring){try{state.dirty=true;saveState();}catch{}push({keepalive:true});}};
    addEventListener('pagehide',leave);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)leave();else if(!known)inspect();});
    addEventListener('storage',event=>{if(event.key===SESSION||event.key===STATE){epoch++;session=read(SESSION);state=read(STATE);known=false;tick=false;render();if(signed())inspect();}});
    render();if(signed())inspect();
  }
  return {start,label,get tick(){return tick;},get paused(){return paused();},get pauseAt(){return pauseAt();}};
})();
