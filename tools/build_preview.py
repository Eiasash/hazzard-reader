"""Package v324's reader for a separate test origin, without production auth."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path

from preview_search import build as build_search

ROOT = Path(__file__).resolve().parents[1]


def write_package(out):
    out.mkdir(parents=True, exist_ok=True)
    source_list = json.loads((ROOT / "asset-list.json").read_text(encoding="utf-8"))
    paths = {entry["url"].removeprefix("./") for entry in source_list["files"]}
    paths.update({"js/reader-input.js", "data/mcq/all.json", "data/mark-unit-registry.json", "js/passage-worker.js"})
    for name in sorted(paths):
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name not in {"index.html", "js/reader-cloud.js"}:
            shutil.copyfile(ROOT / name,target)

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    # A static preview never needs credential fields, including before its scripts run.
    message = "Sign-in and cloud sync work on the live site; on this preview use Back up / Restore"
    html, count = re.subn(r'<section id="cloudControls"[^>]*>.*?</section>',
                          '<p id="cloudStatus" class="meta">' + message + '</p>', html, flags=re.S)
    if count != 1:
        raise ValueError("Expected one live cloud account section")
    html = html.replace("meanwhile cloud sync and the existing backup download are the safety net.",
                        "use Back up to keep a separate copy of your notebook.")
    from generate_startup_data import generate as generate_startup_data
    generate_startup_data(out, paths)
    drug_source = (ROOT / "data/drug-index.json").read_bytes().replace(b"\r\n", b"\n")
    drugs = json.loads(drug_source)
    drug_root = "drug-content/" + hashlib.sha256(drug_source).hexdigest()[:16]
    (out / drug_root).mkdir(parents=True)
    brief = []
    for number, entry in enumerate(drugs["entries"]):
        name = f"{drug_root}/{number}.json"
        (out / name).write_text(json.dumps(entry, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
        summary = {key: entry[key] for key in ("id","name","kind","class","aliases")}
        summary["brandNames"] = sorted({value for brand in entry.get("israeliBrands", []) for value in (brand.get("name"),brand.get("hebrewName")) if value})
        summary.update(part=name, bankOnly=entry.get("bankOnly", False), passageCount=len(entry["passages"]), questionCount=len(entry["questions"]))
        brief.append(summary)
    drug_summary = "data/drug-summary.json"
    (out / drug_summary).write_text(json.dumps({"entries":brief,"counts":drugs["counts"]},ensure_ascii=False,separators=(",",":")),encoding="utf-8",newline="\n")
    paths.add(drug_summary)
    scripts = []
    def executable(match):
        attrs, body = match.groups()
        if 'type="application/json"' in attrs:
            return match.group()
        module = 'type="module"' in attrs
        if module and body.strip() == "if(!window.frameElement?.hasAttribute('data-reading-companion'))await import('./js/reader-status.js');":
            # The preview status implementation is a self-contained classic script.
            # Keep its frame guard without a serial module fetch on every navigation.
            status = (ROOT / "tools/preview-status.js").read_text(encoding="utf-8")
            status = status.replace("__RELEASE__", json.dumps(source_list["version"]))
            body = "if(!window.frameElement?.hasAttribute('data-reading-companion')){" + status + "}"
            module = False
        source = re.search(r'src="([^"]+)"', attrs)
        if source:
            name = source.group(1)
            if name not in paths:
                raise ValueError(f"Missing shell script in asset list: {name}")
        else:
            name = f"preview-inline-{len(scripts)}.js"
            (out / name).write_text(body, encoding="utf-8", newline="\n")
            paths.add(name)
        scripts.append([name,module])
        return ""
    html = re.sub(r"<script\b([^>]*)>(.*?)</script>", executable, html, flags=re.S)
    cloud = """window.HazzardCloud={available:false,signedIn:false,tick:false,paused:false,
 label:()=> 'Preview · local backups',start(){}};
"""
    (out/"js/reader-cloud.js").write_text(cloud,encoding="utf-8",newline="\n")
    storage = out/"js/reader-storage.js"
    storage.write_text(storage.read_text(encoding="utf-8").replace("'hazzard-reader-snapshots-v1'","'reader-preview-snapshots-v1'"),encoding="utf-8",newline="\n")
    version = source_list["version"]
    notes = json.loads((out / "data/changelog.json").read_text(encoding="utf-8"))
    if notes.get("schema") != 1 or notes["releases"][0]["version"] != version:
        raise ValueError("Preview release notes do not match the displayed release")
    status = (ROOT / "tools/preview-status.js").read_text(encoding="utf-8")
    (out / "js/reader-status.js").write_text(status.replace("__RELEASE__", json.dumps(version)), encoding="utf-8", newline="\n")
    # Keep the module boundary. Classic scripts execute in their original order,
    # with the preview cloud stub and isolated snapshot store already substituted.
    grouped = []
    pending = []
    def flush_scripts():
        if not pending:
            return
        name = f"js/preview-shell-{len(grouped)}.js"
        code = "\n;\n".join((out / src).read_text(encoding="utf-8") for src in pending)
        (out / name).write_text(code, encoding="utf-8", newline="\n")
        paths.add(name)
        grouped.append([name, False])
        pending.clear()
    for src, module in scripts:
        if module:
            flush_scripts()
            grouped.append([src, True])
        else:
            pending.append(src)
    flush_scripts()
    scripts = grouped

    def inline_style(match):
        css = (out / match[1]).read_text(encoding="utf-8")
        if "url(" in css or "@import" in css:
            return match[0]
        return "<style>\n" + css + "\n</style>"
    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_style, html)
    policy = """<meta http-equiv="Content-Security-Policy" content="connect-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'">"""
    # Preserve the parser's parallel fetching while authorizing execution
    # only after the preview-origin check.
    preload = "".join(f'<link rel="modulepreload" href="{src}">' if module else
                      f'<link rel="preload" as="script" href="{src}">' for src,module in scripts)
    # Start the two mandatory small reads while Chrome parses the shell.
    early = """<script>(()=>{const host=location.hostname;
if(!['localhost','127.0.0.1','[::1]'].includes(host)&&!host.endsWith('.netlify.app')&&!host.endsWith('.pages.dev'))return;
const urls=['manifest.json','data/mcq/id-aliases.json'];
const params=new URLSearchParams(location.search);if(['home','practice','review','simulation'].some(key=>params.get(key)==='1')||(!location.search&&!location.hash))urls.push('data/home-question-summary.json');
if(params.get('chapter')==='drugs')urls.push('data/drug-summary.json');
window.HazzardEarlyFetch=new Map(urls.map(url=>{const request=fetch(url);request.catch(()=>{});return [url,request];}));
})();</script>"""
    chapter_manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    chapter_assets = {str(c["number"]): ["chapters/" + c["file"], c.get("markUnits")]
                      for c in chapter_manifest["chapters"] if c.get("file")}
    aliases = json.loads((ROOT / "data/highlight-aliases.json").read_bytes())
    for chapter, assets in chapter_assets.items():
        content, units = assets
        layout = next((c.get("textLayout") for c in chapter_manifest["chapters"] if str(c["number"]) == chapter), None)
        base = chapter.removesuffix("s")
        refs = f"data/reader-references/{base}.json" if base.isdigit() else None
        pack = {content: (out / content).read_text(encoding="utf-8"),
                "data/highlight-aliases.json": [row for row in aliases if str(row["chapter"]) == chapter]}
        if layout:
            pack[layout] = json.loads((out / layout).read_bytes())
        if units:
            pack[units] = json.loads((out / units).read_bytes())
        if refs and (out / refs).is_file():
            pack[refs] = json.loads((out / refs).read_bytes())
        raw = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        url = f"reader-start/{chapter}-{hashlib.sha256(raw).hexdigest()[:16]}.json"
        (out / url).parent.mkdir(parents=True, exist_ok=True)
        (out / url).write_bytes(raw)
        chapter_assets[chapter] = [url, *pack]
    # Optional content-addressed packs save round trips on first reading.
    # Every constituent is also in the verified offline manifest.
    early = early.replace("window.HazzardEarlyFetch=new Map", "const files=CHAPTER_ASSETS[params.get('chapter')];window.HazzardEarlyFetch=new Map")
    early = early.replace("})();</script>", """
if(files&&!params.has('home')&&!params.has('tab')&&navigator.onLine){
  const pack=fetch(files[0]).then(r=>{if(!r.ok)throw Error('Chapter pack unavailable');return r.json()});
  for(const path of files.slice(1)){
    const request=pack.then(data=>{if(!Object.hasOwn(data,path))throw Error('Missing chapter asset');
      return {ok:true,text:async()=>data[path],json:async()=>data[path]};}).catch(()=>fetch(path));
    request.catch(()=>{});window.HazzardEarlyFetch.set(path,request);
  }
}
})();</script>""").replace("CHAPTER_ASSETS", json.dumps(chapter_assets, separators=(",", ":")))
    html = html.replace("<head>", "<head>"+policy+early+preload,1).replace("</body>", '<script src="js/preview-start.js"></script></body>')
    (out / "index.html").write_text(html,encoding="utf-8",newline="\n")
    corpus = ROOT / "data/search-index.json"
    corpus_id = hashlib.sha256((ROOT / "tools/preview_search.py").read_text(encoding="utf-8").encode() + corpus.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:16]
    # Shards are optional network assets. The full corpus in the existing
    # offline manifest provides the same search without thousands of requests.
    bounds = build_search(corpus, out / "search" / corpus_id)
    search = json.dumps({"corpus": corpus_id, "bounds": bounds}, separators=(",", ":"))
    bootstrap = """(async()=>{
 const host=location.hostname;
 if(!['localhost','127.0.0.1','[::1]'].includes(host)&&!host.endsWith('.netlify.app')&&!host.endsWith('.pages.dev')){
   document.body.textContent='Open the preview on its separate host.';return;
 }
 window.HazzardDrugSummary="data/drug-summary.json";window.HazzardHomeSummary="data/home-question-summary.json";
 window.HazzardBookSearch=BOOK_SEARCH;
 function load(src,module){
   return new Promise((resolve,reject)=>{
     const script=document.createElement('script');script.async=false;if(module)script.type='module';
     script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Unable to load '+src));document.head.append(script);
   });
 }
 const owner=document;
 const active=()=>owner.defaultView&&owner.defaultView.document===owner;
 let classic=[];
 for(const [src,module] of SCRIPTS){
   if(!active())return;
   if(module){await Promise.all(classic);classic=[];if(!active())return;await load(src,true);}
   else classic.push(load(src,false));
 }
 await Promise.all(classic);
})().catch(e=>{document.body.textContent=e.message;});
"""
    (out/"js/preview-start.js").write_text(bootstrap.replace("SCRIPTS", json.dumps(scripts)).replace("BOOK_SEARCH",search), encoding="utf-8",newline="\n")
    paths.add("js/preview-start.js")
    inline_boot = (out / "js/preview-start.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
    html = html.replace('<script src="js/preview-start.js"></script>', '<script>' + inline_boot + '</script>')
    (out / "index.html").write_text(html, encoding="utf-8", newline="\n")
    files = []
    for name in sorted(paths):
        raw = (out/name).read_bytes()
        files.append({"url":"./"+name,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)})
    manifest = json.dumps({"version":source_list["version"],"files":files},separators=(",",":"))
    (out/"asset-list.json").write_text(manifest,encoding="utf-8",newline="\n")
    template = (ROOT / "tools/preview-worker.js").read_text(encoding="utf-8")
    build_id = hashlib.sha256((manifest + template).encode("utf-8")).hexdigest()[:16]
    shell = [row for row in files if row["url"].endswith((".js", ".css")) or
             row["url"] in {"./index.html", "./manifest.json", "./app.webmanifest", "./data/changelog.json"}]
    shell.append({"url": "./asset-list.json", "sha256": hashlib.sha256(manifest.encode("utf-8")).hexdigest()})
    worker = template.replace("__RELEASE__", json.dumps(version)).replace("__BUILD__", json.dumps(build_id))
    worker = worker.replace("__SHELL__", json.dumps(shell, separators=(",", ":")))
    (out / "sw.js").write_text(worker, encoding="utf-8", newline="\n")
    (out / "_headers").write_text("/sw.js\n  Cache-Control: no-cache, must-revalidate\n/index.html\n  Cache-Control: no-cache, must-revalidate\n/reader-start/*\n  Cache-Control: public, max-age=31536000, immutable\n", encoding="utf-8", newline="\n")
    print(out,source_list["version"],len(files),"verified assets")


def build(out):
    # Netlify restores the previous dist between builds. Publish fresh files
    # only after the entire new manifest and worker have been written.
    out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists() and any(out.iterdir()) and out != ROOT / "dist":
        raise ValueError("Choose an empty upload folder outside the build directory")
    with tempfile.TemporaryDirectory(prefix=".preview-build-",dir=out.parent) as temp:
        staging = Path(temp)
        fresh = staging / "new"
        write_package(fresh)
        previous = staging / "previous"
        if out.exists():
            out.rename(previous)
        try:
            fresh.rename(out)
        except OSError:
            if previous.exists():
                previous.rename(out)
            raise


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("destination",type=Path)
    build(parser.parse_args().destination.resolve())
