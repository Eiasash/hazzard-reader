"""Build All chapters search data with the reader's own renderer.
Run before generate_asset_list.py. Requires Playwright and Chrome.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from generate_recall_cards import publish

ROOT = Path(__file__).resolve().parents[1]

def generate():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    entries = [
        [str(e["number"]), (ROOT / "chapters" / e["file"]).read_text(encoding="utf-8")]
        for e in manifest["chapters"]
    ]
    javascript = r"""entries => {
      const {renderMarkdown, smoothPageMarkers, searchText, searchBlocks} = HazzardChapterContent;
      return entries.map(([id, markdown]) => {
        const root = document.createElement('div');
        root.innerHTML = renderMarkdown(markdown,id);
        const prompts = /^(?:\d+s|laws)$/.test(id) ? HazzardFlashcards.recallBlocks(root,id).map(({answer,prompt,summary,key}) => {
          const norm = s=>s.replace(/[*_]+/g,'').replace(/\s+/g,' ').trim();
          const front = norm(prompt.textContent).replace(/^\d+[.)]\s+/,'');
          const body = answer.cloneNode(true);
          body.querySelector('summary').remove();
          const clean = document.createElement('div');
          clean.innerHTML = marked.parse(body.innerHTML.trim());
          return {chapter:id.slice(0,-1),key,front,back:norm(clean.textContent),
                  link:clean.querySelector('a[href*="#p"]')?.getAttribute('href')||null};
        }) : [];
        const pages = [...root.querySelectorAll('[id]')].filter(e=>/^p\d+$/.test(e.id)).map(e=>Number(e.id.slice(1)));
        HazzardChapterContent.formatReadEndMatter(root,id);
        HazzardFlashcards.foldRecall(root,id,{});
        smoothPageMarkers(root);
        return [id, searchBlocks(root).map(searchText), prompts, pages];
      });
    }"""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel="chrome")
        try:
            page = browser.new_page()
            page.add_script_tag(path=str(ROOT / "js/marked.min.js"))
            page.add_script_tag(path=str(ROOT / "js/chapter-content.js"))
            page.add_script_tag(path=str(ROOT / "js/flashcards.js"))
            rows = page.evaluate(javascript, entries)
        finally:
            browser.close()
    publish([row for _,_,prompts,_ in rows for row in prompts],
            {chapter: set(pages) for chapter,_,_,pages in rows if chapter.isdigit()})
    rows = [row[:2] for row in rows]
    output = ROOT / "data/search-index.json"
    text = json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n"
    output.write_text(text, encoding="utf-8", newline="\n")
    if output.read_text(encoding="utf-8") != text:
        raise OSError("Search index read-back mismatch")
    print(f"Search index: {len(rows)} pages, {sum(len(row[1]) for row in rows)} blocks")
    return output

if __name__ == "__main__":
    generate()
