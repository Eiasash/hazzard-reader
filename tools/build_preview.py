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
    template_files = {}
    def save_template(chapter, content):
        name = f"data/reader-templates/{chapter}.html"
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        template_files[chapter] = name
        paths.add(name)
    def split_template(match):
        save_template(match.group(1), match.group(2))
        return ""
    html = re.sub(r'<template id="chapter(\d+)Template">(.*?)</template>', split_template, html, flags=re.S)
    def split_default(match):
        save_template("46", match.group())
        return '<article id="copy" class="reading-copy" data-chapter-id="home"><h1>Home</h1></article>'
    html, count = re.subn(r'<article class="reading-copy" id="copy" data-chapter-id="46">.*?</article>', split_default, html, count=1, flags=re.S)
    if count != 1:
        raise ValueError("Default reader chapter not found")
    home_file = "data/home-question-summary.json"
    catalog = json.loads((ROOT / "data/mcq/catalog.json").read_text(encoding="utf-8"))
    evidence = json.loads((ROOT / "data/mcq/exam-references.json").read_text(encoding="utf-8"))
    collections = json.loads((ROOT / "data/mcq/collections.json").read_text(encoding="utf-8"))
    positions = {q["id"]: i for i, q in enumerate(catalog)}
    chapters = {}
    for i, q in enumerate(catalog):
        if not q.get("retired") and q.get("chapter") is not None:
            chapters.setdefault(str(q["chapter"]), []).append(i)
    for chapter, record in evidence["study"].items():
        chapters[chapter] = list(dict.fromkeys(chapters.get(chapter, []) + [positions[k] for k in record["ids"] if k in positions]))
    compact = {"questions": [[q["id"], 1 if q["kind"] == "past" else 0, q["accepted"], int(bool(q.get("retired"))) + 2 * int(bool(q.get("content_changed")))] for q in catalog],
               "chapters": chapters, "sittings": {positions[k]: v["sitting"] for k, v in evidence["questions"].items() if k in positions},
               "law": [positions[k] for k in collections["israeliLawEthics"]["ids"] if k in positions]}
    history = json.loads((ROOT / "data/redo-history.json").read_text(encoding="utf-8"))["questions"]
    changes = json.loads((ROOT / "data/mcq/content-changes.json").read_text(encoding="utf-8"))
    # Home needs the last correction date to score first attempts, not the
    # complete list of question labels and previous revisions.
    dates = {}
    for change in history + changes:
        qid, date = change["id"], change["changedAt"]
        stamp = datetime.fromisoformat(date.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        if qid not in dates or stamp > dates[qid][0]:
            dates[qid] = (stamp, date)
    dates = {qid: dated[1] for qid, dated in dates.items()}
    unique_dates = sorted(set(dates.values()))
    date_id = {date: i for i, date in enumerate(unique_dates)}
    compact["changeDates"] = unique_dates
    compact["changes"] = [[positions.get(qid, qid), date_id[date]] for qid, date in dates.items()]
    (out / home_file).write_text(json.dumps(compact,separators=(",",":")),encoding="utf-8",newline="\n")
    paths.add(home_file)
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
        source = re.search(r'src="([^"]+)"', attrs)
        if source:
            name = source.group(1)
            if name not in paths:
                raise ValueError(f"Missing shell script in asset list: {name}")
        else:
            name = f"preview-inline-{len(scripts)}.js"
            (out / name).write_text(body, encoding="utf-8", newline="\n")
            paths.add(name)
        scripts.append([name,'type="module"' in attrs])
        return ""
    html = re.sub(r"<script\b([^>]*)>(.*?)</script>", executable, html, flags=re.S)
    policy = """<meta http-equiv="Content-Security-Policy" content="connect-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'">"""
    # Preserve the parser's parallel fetching while authorizing execution
    # only after the preview-origin check.
    preload = "".join(f'<link rel="modulepreload" href="{src}">' if module else
                      f'<link rel="preload" as="script" href="{src}">' for src,module in scripts)
    # Start the two mandatory small reads while Chrome parses the shell.
    early = """<script>(()=>{const host=location.hostname;
if(!['localhost','127.0.0.1','[::1]'].includes(host)&&!host.endsWith('.netlify.app')&&!host.endsWith('.pages.dev'))return;
const urls=['manifest.json','data/mcq/id-aliases.json'];
if(new URLSearchParams(location.search).get('home')==='1'||(!location.search&&!location.hash))urls.push('data/home-question-summary.json');
window.HazzardEarlyFetch=new Map(urls.map(url=>{const request=fetch(url);request.catch(()=>{});return [url,request];}));
})();</script>"""
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
 window.HazzardDrugSummary="data/drug-summary.json";window.HazzardTemplates=TEMPLATE_FILES;window.HazzardHomeSummary="data/home-question-summary.json";
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
    (out/"js/preview-start.js").write_text(bootstrap.replace("SCRIPTS", json.dumps(scripts)).replace("BOOK_SEARCH",search).replace("TEMPLATE_FILES",json.dumps(template_files)), encoding="utf-8",newline="\n")
    paths.add("js/preview-start.js")
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
    (out / "_headers").write_text("/sw.js\n  Cache-Control: no-cache, must-revalidate\n/index.html\n  Cache-Control: no-cache, must-revalidate\n", encoding="utf-8", newline="\n")
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
