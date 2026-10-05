"""Run after release edits: python tools/generate_asset_list.py. No site build needed."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
# CACHE_VERSION is the release source; refresh page/cloud labels before hashing.
version = re.search(r"CACHE_VERSION = '([^']+)'", (ROOT / 'sw.js').read_text(encoding='utf-8')).group(1)
for name, pattern, replacement in [
    ('js/reader-status.js', r"const VERSION = '[^']+'", f"const VERSION = '{version}'"),
    ('index.html', r'(id="readerStatusChip"[^>]*>)v\d+(?:-r\d+)?( - checking offline copy)', rf'\g<1>{version}\2'),
]:
    path = ROOT / name
    original = path.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, replacement, original)
    if count != 1:
        raise ValueError(f'Expected one release label in {name}, found {count}')
    if updated != original:
        path.write_text(updated, encoding='utf-8')
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
paths = {'js/reader-debug.js', 'js/reader-whats-new.js', 'css/reader-tools.css', 'data/changelog.json', 'index.html', 'manifest.json', 'js/marked.min.js', 'js/mcq.js', 'js/question-search.js', 'js/mcq-review.js', 'js/exam-simulation.js', 'js/reader-storage.js', 'js/reader-status.js', 'js/reader-cloud.js', 'css/mcq.css', 'data/mcq/index.json', 'data/mcq/all.json', 'data/mcq/topics.json', 'data/mcq/collections.json', 'data/mcq/official-overrides.json', 'data/mcq/id-aliases.json', 'data/mcq/exam-references.json', 'data/mcq/hazzard8e-toc.json', 'js/exam-evidence.js', 'js/law-cards.js', 'css/law-cards.css', 'data/law-cards.json', 'js/memory-aids.js', 'css/memory-aids.css', 'data/memory-aids.json', 'js/drug-index.js', 'css/drug-index.css', 'data/drug-index.json'}
mcq_index = json.loads((ROOT / 'data/mcq/index.json').read_text(encoding='utf-8'))
paths.add('js/changed-questions.js')
paths.add('data/redo-history.json')
for chapter in [*mcq_index, 'all']:
    path = f'data/mcq/{chapter}.json'
    paths.add(path)
    for question in json.loads((ROOT / path).read_text(encoding='utf-8')):
        paths.update(question['images'])
for chapter in manifest['chapters']:
    path = 'chapters/' + chapter['file']
    paths.add(path)
    text = (ROOT / path).read_text(encoding='utf-8')
    for image in re.findall(r'!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|svg|webp))\)', text, re.I):
        paths.add('chapters/' + image.rsplit('/', 1)[-1])
html = (ROOT / 'index.html').read_text(encoding='utf-8')
paths.update(re.findall(r'(?:src|data-src)="(chapters/[^"?#]+\.(?:png|jpe?g|gif|svg|webp))"', html, re.I))
files = []
for path in sorted(paths):
    data = (ROOT / path).read_bytes()
    # GitHub Pages serves Git's LF text, even from a Windows CRLF checkout.
    if Path(path).suffix in {'.html', '.md', '.js', '.json', '.css'}:
        data = data.replace(b'\r\n', b'\n')
    files.append({'url': './' + path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
(ROOT / 'asset-list.json').write_text(json.dumps({'version': version, 'files': files}, indent=2) + '\n', encoding='utf-8')
print(f'{version}: {len(files)} files, {sum(f["bytes"] for f in files):,} bytes')
