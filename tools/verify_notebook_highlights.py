"""Check a real exported notebook on a local reader. Output contains counts and failure IDs."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import re

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(notebook, root, output):
    storage = json.loads(notebook.read_text(encoding="utf-8"))["storage"]
    chapters = {key.split(":")[1]: json.loads(raw)
                for key, raw in storage.items() if re.fullmatch(r"stage-a-highlights-v1:(?:\d+s?|laws?)", key)}
    marks = json.loads(storage.get("hazzard-answer-highlights-v1", '{"items":{}}'))["items"]
    active = {key: mark for key, mark in marks.items() if not mark["removed"]}
    report = {"chapters": {}, "answers": {}, "failures": []}
    handler = partial(QuietHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as pw:
        server.daemon_threads = True
        Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"
        browser = pw.chromium.launch(channel="chrome")
        try:
            ctx = browser.new_context(service_workers="block", viewport={"width": 412, "height": 915}, has_touch=True)
            ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(origin + "/") else r.abort())
            page = ctx.new_page()
            page.goto(origin + "/?tab=settings")
            page.wait_for_function("!!window.HazzardPrepareUpdate")
            page.locator("#notebookBackupFile").set_input_files(notebook)
            page.wait_for_function("(/merged|already saved/i).test(document.querySelector('#backupStatus').textContent)")
            for chapter, saved in chapters.items():
                page.evaluate("id=>HazzardRouter.go('?chapter='+id)", chapter)
                page.evaluate("()=>HazzardRouter.settled()")
                page.locator(f'#copy[data-chapter-id="{chapter}"] h1').first.wait_for(state="attached")
                records = {**saved.get("marks", {}), **saved.get("ranges", {})}
                failures = page.evaluate("""records=>{
                  const clean=s=>s.replace(/\\s+/gu,' ').trim();
                  return Object.entries(records).filter(([id,m])=>{
                    const parts=[...document.querySelectorAll('#copy [data-range="'+CSS.escape(id)+'"],#copy [data-saved-unit="'+CSS.escape(id)+'"]')];
                    return !parts.length||!['',' '].some(sep=>clean(parts.map(p=>p.textContent).join(sep))===clean(m.text));
                  }).map(([id])=>id);
                }""", records)
                report["chapters"][chapter] = {"total": len(records), "exact": len(records) - len(failures)}
                report["failures"].extend(f"{chapter}/{key}" for key in failures)
            notebook_items = page.evaluate("()=>HazzardAnswerHighlights.notebookItems()")
            by_id = {item["id"]: item for item in notebook_items}
            for question in sorted({m["questionId"] for m in active.values()}):
                ids = [key for key, m in active.items() if m["questionId"] == question]
                page.evaluate("u=>HazzardRouter.go(u)", f"?chapter=bank&q={question}&answerHighlight={ids[0]}")
                page.evaluate("()=>HazzardRouter.settled()")
                page.locator(f'[data-bank-id="{question}"] .mcq-explanation').wait_for()
                missing = page.evaluate("""ids=>ids.filter(id=>{
                  const spans=[...document.querySelectorAll('.mcq-explanation [data-answer-highlight="'+CSS.escape(id)+'"]')];
                  return !spans.some(e=>!e.closest('[data-prior-excerpt]')&&e.textContent.trim());
                })""", ids)
                unplaced = [key for key in ids if key not in by_id or by_id[key]["unplaced"]]
                report["answers"][question] = {"active": len(ids), "attached": len(ids)-len(missing),
                                                "placedInNotebook": len(ids)-len(unplaced)}
                report["failures"].extend(f"{question}/{key}" for key in set(missing + unplaced))
            unchanged = page.evaluate("""source=>Object.keys(source).filter(k=>
                (k.startsWith('stage-a-highlights-v1:')||k==='hazzard-answer-highlights-v1')&&localStorage.getItem(k)!==source[k])""", storage)
            report["changedHighlightStores"] = unchanged
        finally:
            browser.close()
            server.shutdown()
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return bool(report["failures"] or report["changedHighlightStores"])
