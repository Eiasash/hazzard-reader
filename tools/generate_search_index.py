"""Build All chapters search data with the reader's own renderer.
Run before generate_asset_list.py. Requires Playwright and Chrome.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def generate():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    entries = [
        [str(e["number"]), (ROOT / "chapters" / e["file"]).read_text(encoding="utf-8")]
        for e in manifest["chapters"]
    ]
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    renderer = html[html.index("function renderManifestChapterHtml("):html.index("\nlet manifestChapters=")]
    markers = html[html.index("function smoothPageMarkers("):html.index("\nsmoothPageMarkers(copy);")]
    search = html[html.index("const searchText="):html.index("\nlet fullTextIndex=")]
    javascript = """args => {
      const requestedChapter = '46', imageSizes = {};
    """ + renderer + markers + search + """
      const doc = new DOMParser().parseFromString(args.html, 'text/html');
      const templates = new Map([...doc.querySelectorAll('template[id^=chapter][id$=Template]')].map(t =>
        [t.content.querySelector('[data-chapter-id]').dataset.chapterId, t.innerHTML]));
      return args.entries.map(([id, markdown]) => {
        const root = document.createElement('div');
        root.innerHTML = templates.get(id) || renderManifestChapterHtml(markdown);
        smoothPageMarkers(root);
        return [id, searchBlocks(root).map(searchText)];
      });
    }"""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel="chrome")
        try:
            page = browser.new_page()
            page.add_script_tag(path=str(ROOT / "js/marked.min.js"))
            rows = page.evaluate(javascript, {"html": html, "entries": entries})
        finally:
            browser.close()
    output = ROOT / "data/search-index.json"
    text = json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n"
    output.write_text(text, encoding="utf-8", newline="\n")
    if output.read_text(encoding="utf-8") != text:
        raise OSError("Search index read-back mismatch")
    print(f"Search index: {len(rows)} pages, {sum(len(row[1]) for row in rows)} blocks")
    return output

if __name__ == "__main__":
    generate()
