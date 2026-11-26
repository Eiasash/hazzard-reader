"""Package v324's reader for a separate test origin, without production auth."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(out):
    if out.exists() and any(out.iterdir()):
        raise ValueError("Choose an empty upload folder")
    out.mkdir(parents=True, exist_ok=True)
    source_list = json.loads((ROOT / "asset-list.json").read_text(encoding="utf-8"))
    paths = {entry["url"].removeprefix("./") for entry in source_list["files"]}
    paths.update({"js/reader-input.js", "data/mcq/all.json", "data/mark-unit-registry.json"})
    for name in sorted(paths):
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name not in {"index.html", "js/reader-cloud.js"}:
            shutil.copyfile(ROOT / name,target)

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = []
    def executable(match):
        attrs, body = match.groups()
        if 'type="application/json"' in attrs:
            return match.group()
        source = re.search(r'src="([^"]+)"', attrs)
        if source:
            name = source.group(1)
        else:
            name = f"preview-inline-{len(scripts)}.js"
            (out / name).write_text(body, encoding="utf-8", newline="\n")
            paths.add(name)
        scripts.append([name,'type="module"' in attrs])
        return ""
    html = re.sub(r"<script\b([^>]*)>(.*?)</script>", executable, html, flags=re.S)
    policy = """<meta http-equiv="Content-Security-Policy" content="connect-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'">"""
    html = html.replace("<head>", "<head>"+policy,1).replace("</body>", '<script src="js/preview-start.js"></script></body>')
    (out / "index.html").write_text(html,encoding="utf-8",newline="\n")
    bootstrap = """(async()=>{
 const host=location.hostname;
 if(!['localhost','127.0.0.1','[::1]'].includes(host)&&!host.endsWith('.netlify.app')&&!host.endsWith('.pages.dev')){
   document.body.textContent='Open the preview on its separate host.';return;
 }
 for(const [src,module] of SCRIPTS){
   await new Promise((resolve,reject)=>{
     const script=document.createElement('script');if(module)script.type='module';
     script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Unable to load '+src));document.head.append(script);
   });
 }
})().catch(e=>{document.body.textContent=e.message;});
"""
    (out/"js/preview-start.js").write_text(bootstrap.replace("SCRIPTS", json.dumps(scripts)), encoding="utf-8",newline="\n")
    paths.add("js/preview-start.js")
    # Keep the v324 account screen. Test-host credentials must never reach live RPCs.
    cloud = """window.HazzardCloud={signedIn:false,tick:false,paused:false,label:()=> 'Cloud sync is unavailable on this preview',
 start(){
   const controls=document.getElementById('cloudControls');
   document.getElementById('cloudStatus').textContent=this.label();
   controls.querySelectorAll('button,input').forEach(control=>control.disabled=true);
   dispatchEvent(new Event('hazzard-cloud-status'));
 }};
"""
    (out/"js/reader-cloud.js").write_text(cloud,encoding="utf-8",newline="\n")
    storage = out/"js/reader-storage.js"
    storage.write_text(storage.read_text(encoding="utf-8").replace("'hazzard-reader-snapshots-v1'","'reader-preview-snapshots-v1'"),encoding="utf-8",newline="\n")
    files = []
    for name in sorted(paths):
        raw = (out/name).read_bytes()
        files.append({"url":"./"+name,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)})
    manifest = json.dumps({"version":source_list["version"],"files":files},separators=(",",":"))
    (out/"asset-list.json").write_text(manifest,encoding="utf-8",newline="\n")
    worker = (ROOT/"sw.js").read_text(encoding="utf-8").replace("'hazzard-shell-' + CACHE_VERSION + '-sources'",repr("reader-preview-"+hashlib.sha256(manifest.encode()).hexdigest()[:16])).replace("startsWith('hazzard-')","startsWith('reader-preview-')")
    worker = worker.replace("event.data?.type === 'HAZZARD_APPLY_UPDATE'", "(event.data?.type === 'HAZZARD_APPLY_UPDATE' || event.data === 'update')")
    (out/"sw.js").write_text(worker,encoding="utf-8",newline="\n")
    print(out,source_list["version"],len(files),"verified assets")


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("destination",type=Path)
    build(parser.parse_args().destination.resolve())
