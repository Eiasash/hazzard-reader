"""Precompile Hebrew block direction and inline bidi markup from the canonical chapter files."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def build(manifest):
    out = ROOT / "data/chapter-layout"
    out.mkdir(exist_ok=True)
    files = set()
    sources = [(str(c["number"]), (ROOT / "chapters" / c["file"]).read_text(encoding="utf-8"))
               for c in manifest["chapters"] if c.get("file")]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        try:
            renderer = browser.new_page()
            for file in ("js/marked.min.js", "js/chapter-content.js", "tools/chapter-layout-compiler.js"):
                renderer.add_script_tag(path=str(ROOT / file))
            # Keep each call bounded even on the longest chapters.
            compiled = {}
            for start in range(0, len(sources), 8):
                rows = renderer.evaluate("""rows => rows.map(([id, markdown])=>{
                  const root=document.createElement('article');
                  root.innerHTML=HazzardChapterContent.renderMarkdown(markdown,id);
                  return [id,compileChapterLayout(root,id)];
                })""", sources[start:start+8])
                compiled.update(rows)
        finally:
            browser.close()
    for chapter in manifest["chapters"]:
        id_ = str(chapter["number"])
        patches = compiled.get(id_, {})
        file = out / (id_ + ".json")
        if not patches.get("dir") and not patches.get("runs"):
            chapter.pop("textLayout", None)
            if file.is_file():
                file.unlink()
            continue
        name = file.relative_to(ROOT).as_posix()
        chapter["textLayout"] = name
        files.add(name)
        content = json.dumps(patches, ensure_ascii=False, separators=(",", ":")) + "\n"
        if not file.is_file() or file.read_text(encoding="utf-8") != content:
            file.write_text(content, encoding="utf-8", newline="\n")
    return files
