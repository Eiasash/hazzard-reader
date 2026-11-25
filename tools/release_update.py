"""Exercise a real reader update, or compare stored snapshots from a release run.

Browser mode uses Playwright Chromium and requests. Raw changes are reported for
diagnosis. Only changes to personal study data affect the storage verdict.
"""
import argparse
import hashlib
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit, unquote


BOOKKEEPING = {
    'hazzard-cloud-state-v1', 'hazzard-cloud-session-v1', 'hazzard-place-v1',
    'hazzard-practice-place-v1', 'hazzard-mcq-view-v1', 'hazzard-debug-log-v1',
    'hazzard-last-backup-v1', 'hazzard-whats-new-seen-v1', 'hazzard-mcq-id-aliases-v53-r1',
}


def user_data(snapshot):
    result = {}
    for key, raw in snapshot.items():
        if key in BOOKKEEPING or not key.startswith(('hazzard-', 'stage-a-')):
            continue
        # Preserve unreadable personal data verbatim so corruption or loss is visible.
        try:
            value = json.loads(raw)
        except (ValueError, TypeError):
            result[key] = ('raw', raw)
            continue
        if key.startswith('stage-a-highlights-v1:') and isinstance(value, dict):
            if value.get('ranges') == {}:
                del value['ranges']
            if value.get('history') == []:
                del value['history']
            if value == {'version': 1, 'chapterId': key.partition(':')[2], 'marks': {}}:
                continue
        if key == 'hazzard-bookmarks-v1' and value == []:
            continue
        if key == 'hazzard-mcq-papers-v1' and isinstance(value, dict) and isinstance(value.get('paper'), dict):
            value['paper'].pop('position', None)
        if key == 'hazzard-exam-simulation-v1' and isinstance(value, dict) and isinstance(value.get('session'), dict):
            value['session'].pop('position', None)
        if key == 'hazzard-reading-progress-v1' and isinstance(value, dict) and isinstance(value.get('chapters'), dict):
            # A scroll-only visit may create a chapter record. Keep explicit completion
            # and unfamiliar fields, including any future user-authored annotations.
            chapters = {}
            for chapter, entry in value['chapters'].items():
                if isinstance(entry, dict):
                    entry = {k:v for k,v in entry.items() if k not in ('ratio', 'at') and not (k == 'read' and v is False)}
                if entry != {}:
                    chapters[chapter] = entry
            value['chapters'] = chapters
            if value == {'chapters': {}}:
                continue
        if key == 'hazzard-mcq-review-v1' and isinstance(value, dict):
            value.pop('seed', None)
            value.pop('batchAt', None)
            batch = value.get('batch')
            if isinstance(batch, dict):
                # The generated daily queue and its cursor can move; its answers are personal.
                value['batch'] = {k:v for k,v in batch.items() if k not in ('ids', 'day', 'position')}
            if value.get('batch') in (None, {'answers': {}}):
                value.pop('batch', None)
        result[key] = ('json', json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    return result


def diff(old, new):
    return {
        'lost': sorted(old.keys() - new.keys()),
        'added': sorted(new.keys() - old.keys()),
        'changed': sorted(key for key in old.keys() & new.keys() if old[key] != new[key]),
    }


def user_data_diff(before, after):
    return diff(user_data(before), user_data(after))


def run_update(args):
    import requests
    from playwright.sync_api import sync_playwright
    ROOT = Path(__file__).resolve().parents[1]
    OUT = args.evidence
    OUT.mkdir(parents=True, exist_ok=True)
    width,height,theme=360,800,'light'
    LIVE='https://eiasash.github.io/hazzard-reader/'
    QID=args.question
    Q='bank&q='+QID
    CH=args.chapter
    CHKEY='stage-a-highlights-v1:'
    AKEY='hazzard-answer-highlights-v1'
    BASE=args.baseline or ROOT
    def sha(b):return hashlib.sha256(b).hexdigest()
    def log(s):print(s,flush=True)
    def download(name):
        res=requests.get(LIVE+name,headers={'Cache-Control':'no-cache'},timeout=35)
        res.raise_for_status()
        return res.content
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    if head != args.head:
        raise ValueError(f'Checked-out HEAD {head} differs from requested test head {args.head}')
    shell={name:download(name) for name in ('sw.js','index.html','asset-list.json')}
    manifest=json.loads(shell['asset-list.json'])
    old_version = manifest['version']
    assert f"CACHE_VERSION = '{old_version}'".encode() in shell['sw.js']
    candidate_manifest=json.loads((ROOT/'asset-list.json').read_text(encoding='utf-8'))
    new_version = candidate_manifest['version']
    if old_version == new_version:
        raise ValueError('Live and candidate versions are identical')
    hashes={f['url'][2:]:f['sha256'] for f in manifest['files']}
    candidate=False
    served=set()
    server_errors=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            name=unquote(urlsplit(self.path).path).removeprefix('/hazzard-reader/').lstrip('/') or 'index.html'
            if '..' in Path(name).parts:
                self.send_error(404)
                return
            is_candidate=candidate
            path=(ROOT if is_candidate else BASE)/name
            try:
                if not is_candidate and name in shell:
                    data=shell[name]
                elif path.is_file():
                    data=path.read_bytes()
                    if path.suffix in {'.html','.md','.json','.js','.css','.webmanifest'}:data=data.replace(b'\r\n',b'\n')
                elif not is_candidate and name in hashes:data=download(name)
                else:
                    self.send_error(404)
                    return
                if not is_candidate and name in hashes:
                    if sha(data)!=hashes[name]:data=download(name)
                    if sha(data)!=hashes[name]:raise ValueError('Live hash mismatch '+name)
                    served.add(name)
                self.send_response(200)
                self.send_header('Content-Type',mimetypes.guess_type(name)[0] or 'application/octet-stream')
                self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length',str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (ConnectionAbortedError,ConnectionResetError,BrokenPipeError):pass
            except Exception as exc:
                server_errors.append(str(exc))
                self.send_error(502)
    class Server(ThreadingHTTPServer): request_queue_size=64
    server=Server(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/hazzard-reader/'
    def point(element,needle=None):
        return element.evaluate("""async(root,needle)=>{
          const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
          let n,start,token;
          while(n=walk.nextNode()){
            if(needle){start=n.data.toLowerCase().indexOf(needle.toLowerCase()); token=needle}
            else{token=n.data.match(/\\S{3,}/)?.[0]; start=token?n.data.indexOf(token):-1;}
            if(start>=0 && n.parentElement.getClientRects().length)break;
          }
          if(!n)throw Error('No visible text for '+needle+' in '+root.textContent.slice(0,150));
          n.parentElement.scrollIntoView({block:'center',behavior:'instant'});
          const range=new Range();range.setStart(n,start);range.setEnd(n,start+Math.min(token.length,4));
          const scroller=root.closest('#mcqViewport,#readerScroll');
          if(scroller){const box=range.getBoundingClientRect(),view=scroller.getBoundingClientRect();
            scroller.scrollBy({top:box.top-view.top-view.height/2,behavior:'instant'});}
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const box=range.getClientRects()[0],x=box.x+box.width/2,y=box.y+box.height/2;
          const hit=document.elementFromPoint(x,y);
          if(!n.parentElement.contains(hit))throw Error('Target '+root.outerHTML.slice(0,160)+' at '+x+','+y+' obscured by '+hit?.outerHTML.slice(0,160));
          return {x,y};
        }""",needle)
    def tap_text(element,needle=None):
        p=point(element,needle)
        if width==360:pg.touchscreen.tap(p['x'],p['y'])
        else:pg.mouse.click(p['x'],p['y'])
    def go(ch):
        pg.goto(url+'?chapter='+ch)
        pg.wait_for_function('!!window.HazzardPrepareUpdate')
        if ch==Q:
            pg.locator('.mcq-stem').wait_for()
            if not pg.locator('.mcq-explanation').is_visible():pg.locator('.mcq-option').first.click()
            pg.locator('.mcq-explanation').wait_for()
        else:pg.locator('#copy p span[data-unit]').first.wait_for(state='attached')
    def storage():return pg.evaluate('({...localStorage})')
    def marks(ch):
        raw=pg.evaluate('k=>localStorage.getItem(k)',AKEY if ch==Q else CHKEY+ch)
        value=json.loads(raw or '{}')
        return {i:m for i,m in value.get('items' if ch==Q else 'marks',{}).items() if not m.get('removed')}
    def start():
        pg.locator('#markToggle').click()
        pg.locator('#markDone').wait_for()
    def done():pg.locator('#markDone').click()
    def colour(label):
        button=pg.locator('#markColour')
        for i in range(3):
            if button.get_attribute('aria-label').startswith('Highlight colour: '+label+'.'):
                return
            button.click()
        assert button.get_attribute('aria-label').startswith('Highlight colour: '+label+'.')
    def worker():
        return pg.evaluate("""async()=>{const channel=new MessageChannel();
          const v=new Promise(resolve=>channel.port1.onmessage=e=>{resolve(e.data.version);channel.port1.close()});
          navigator.serviceWorker.controller.postMessage({type:'HAZZARD_VERSION'},[channel.port2]);return v}""")
    def painted(ch,i):
        return pg.locator('.mcq-explanation [data-answer-highlight="'+i+'"]' if ch==Q else '#copy [data-unit="'+i+'"][data-marked]')
    def assert_style(locator,stored):
        styles=locator.evaluate_all("""es=>es.map(e=>{const s=getComputedStyle(e);return [s.textDecorationLine,s.textDecorationColor,s.backgroundColor,s.textDecorationThickness]})""")
        assert styles
        for line,_color,fill,_thickness in styles:
            if stored=='green':
                assert 'underline' in line,styles
            else:
                assert fill not in ('transparent','rgba(0, 0, 0, 0)'),styles
    def digest(values):return {k:sha(v.encode('utf-8')) for k,v in sorted(values.items())}

    result={'head':head,'from':old_version,'to':new_version,'status':'IN PROGRESS','live_shell_sha256':{k:sha(b) for k,b in shell.items()}}
    def save():
        f=OUT/'update-result.json'
        v=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
        f.write_text(v,encoding='utf-8',newline='\n')
        assert f.read_text(encoding='utf-8')==v
    def go_baseline():
        go(CH)
        start()
        targets=pg.locator('#copy p span[data-unit]')
        units=targets.evaluate_all("""es=>{
          const ids=[...new Set(es.filter(e=>e.getClientRects().length && e.textContent.trim().length>24).map(e=>e.dataset.unit))];
          const start=Math.max(0,Math.min(ids.length-2,Math.floor(ids.length/3)));
          return ids.slice(start,start+2)
        }""")
        assert len(units)==2, 'Baseline chapter needs two visible highlightable units'
        for uid,hue in zip(units,('yellow','Underline')):
            colour(hue)
            elt=pg.locator('#copy p span[data-unit="'+uid+'"]').first
            tap_text(elt)
            saved='green' if hue=='Underline' else hue
            assert marks(CH)[uid]['colour']==saved
            assert_style(painted(CH,uid),saved)
        assert pg.locator('#bookmark').get_attribute('aria-pressed')=='false'
        pg.locator('#bookmark').click()
        done()
        pg.wait_for_function("ch=>JSON.parse(localStorage.getItem('hazzard-reading-progress-v1')||'{}').chapters?.[ch]?.ratio>0",arg=CH)
        go(Q)
        # A saved checked answer suffices for this comparison. Also use the public Save control.
        pg.locator('.mcq-docked-actions [data-revision=questions]').click()
        pg.wait_for_function("v=>!!navigator.serviceWorker.controller && HazzardRelease.version===v",arg=old_version,timeout=240000)
        pg.wait_for_function("async v=>!!await(await caches.open('hazzard-shell-'+v+'-sources')).match('./.offline-ready')",arg=old_version,timeout=240000)
        assert worker()==old_version
    def baseline_evidence(snapshot):
        entries=json.loads(snapshot[CHKEY+CH])['marks']
        bookmarks=json.loads(snapshot['hazzard-bookmarks-v1'])
        progress=json.loads(snapshot['hazzard-reading-progress-v1'])['chapters'][CH]
        answer=json.loads(snapshot['hazzard-mcq-v1'])['answers'][QID]
        assert {v['colour'] for v in entries.values()}=={'green','yellow'}
        assert any(e['chapter']==CH for e in bookmarks)
        assert progress['ratio']>0 and answer['checked'] is True
        assert set(hashes)==served,(sorted(set(hashes)-served)[:20],sorted(served-set(hashes)))
        return {'chapter':CH,'mark_ids_and_colours':{uid:v['colour'] for uid,v in entries.items()},
                'baseline_mark_styles_verified':True,'chapter_bookmarks':len([e for e in bookmarks if e['chapter']==CH]),
                'reading_ratio':progress['ratio'],'checked_question':QID,'selected':answer['selected'],
                'manifest_assets_verified':len(served),'missing_manifest_assets':sorted(set(hashes)-served)}
    try:
        with tempfile.TemporaryDirectory(prefix='reader-update-',ignore_cleanup_errors=True) as profile, sync_playwright() as pw:
            ctx=pw.chromium.launch_persistent_context(profile,executable_path=args.chromium,headless=True,
                viewport={'width':width,'height':height},color_scheme=theme,has_touch=True)
            pg=ctx.pages[0];pg.set_default_timeout(20000)
            go_baseline()
            result['baseline_ui']=baseline_evidence(storage());log(f'Installed live {old_version} and verified populated baseline')
            candidate=True
            pg.evaluate("async()=>await(await navigator.serviceWorker.getRegistration()).update()")
            button=pg.locator('#readerUpdateButton')
            button.wait_for(state='visible',timeout=240000)
            captured=[]
            pg.expose_function('captureReleaseStorage',lambda snapshot:captured.append(snapshot))
            pg.evaluate("""window.addEventListener('click', e=>{
              if(e.target.closest('#readerUpdateButton'))window.captureReleaseStorage({...localStorage})
            },{once:true,capture:true})""")
            button.click()
            pg.wait_for_function("v=>window.HazzardRelease?.version===v && !!window.HazzardPrepareUpdate",arg=new_version,timeout=240000)
            pg.locator('.mcq-stem').wait_for();pg.locator('.mcq-explanation').wait_for();pg.wait_for_timeout(800)
            assert len(captured)==1 and worker()==new_version
            before=captured[0];after=storage()
            result['baseline_ui']=baseline_evidence(before)
            ctx.set_offline(True);pg.reload()
            pg.wait_for_function("v=>window.HazzardRelease?.version===v && !!window.HazzardPrepareUpdate",arg=new_version)
            pg.locator('.mcq-stem').wait_for();pg.locator('.mcq-explanation').wait_for();pg.wait_for_timeout(800)
            assert not pg.evaluate('navigator.onLine') and worker()==new_version
            offline=storage()
            result.update({'before':digest(before),'after':digest(after),'offline':digest(offline),
              'after_update_diff':user_data_diff(before,after),'offline_diff':user_data_diff(before,offline),
              'raw_after_update_diff':diff(before,after),'raw_offline_diff':diff(before,offline),
              'capture':'Window capture phase of the actual Update button click, before the button handler.',
              'offline_browser':True,'worker_after':new_version,'worker_offline':new_version})
            if any(result['after_update_diff'].values()) or any(result['offline_diff'].values()):
                raise ValueError('Personal study data changed during update or offline reload')
            assert not server_errors,server_errors
            result['status']='PASS';save()
            log('PASS: personal study data matches after Update and offline reload')
            ctx.close()
    except Exception as exc:
        result.update({'status':'FAIL','error':type(exc).__name__+': '+str(exc),'server_errors':server_errors})
        save()
        raise
    finally:server.shutdown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    browser = sub.add_parser('update')
    browser.add_argument('--head', required=True)
    browser.add_argument('--evidence', type=Path, required=True)
    browser.add_argument('--baseline', type=Path, help='Local baseline asset cache; always verified against the live manifest')
    browser.add_argument('--chromium', help='Optional Chromium executable path')
    browser.add_argument('--chapter', default='22', help='Baseline reading chapter used to create marks and a bookmark')
    browser.add_argument('--question', default='mcq-95f642a729895dc17239d748', help='Baseline question to answer and save')
    compare = sub.add_parser('compare')
    compare.add_argument('before', type=Path)
    compare.add_argument('after', type=Path)
    args = parser.parse_args()
    if args.mode == 'update':
        run_update(args)
        return 0
    before, after = (json.loads(p.read_text(encoding='utf-8')) for p in (args.before, args.after))
    if not user_data(before) and not user_data(after):
        print('NOT RUN: snapshots contain no personal study data')
        return 2
    changes = user_data_diff(before, after)
    print(json.dumps({'user_data': changes, 'raw_storage': diff(before, after)}, indent=2))
    return int(any(changes.values()))


if __name__ == '__main__':
    raise SystemExit(main())
