"""Run after release edits: python tools/generate_asset_list.py. No site build needed."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
paths = {'index.html', 'manifest.json', 'js/marked.min.js', 'js/mcq.js', 'js/mcq-review.js', 'js/reader-storage.js', 'js/reader-status.js', 'js/reader-cloud.js', 'css/mcq.css', 'data/mcq/index.json', 'data/mcq/all.json', 'data/mcq/topics.json', 'data/mcq/collections.json', 'data/mcq/official-overrides.json', 'data/mcq/id-aliases.json', 'data/mcq/exam-references.json', 'data/mcq/hazzard8e-toc.json', 'js/exam-evidence.js', 'js/law-cards.js', 'css/law-cards.css', 'data/law-cards.json'}
mcq_index = json.loads((ROOT / 'data/mcq/index.json').read_text(encoding='utf-8'))
for chapter in [*mcq_index, 'all']:
    path = f'data/mcq/{chapter}.json'
    paths.add(path)
    for question in json.loads((ROOT / path).read_text(encoding='utf-8')):
        paths.update(question['images'])
for chapter in manifest['chapters']:
    path = 'chapters/' + chapter['file']
    paths.add(path)
    text = (ROOT / path).read_text(encoding='utf-8')
    for image in re.findall(r'!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|svg))\)', text, re.I):
        paths.add('chapters/' + image.rsplit('/', 1)[-1])
html = (ROOT / 'index.html').read_text(encoding='utf-8')
paths.update(re.findall(r'(?:src|data-src)="(chapters/[^"?#]+\.(?:png|jpe?g|gif|svg))"', html, re.I))
files = []
for path in sorted(paths):
    data = (ROOT / path).read_bytes()
    # GitHub Pages serves Git's LF text, even from a Windows CRLF checkout.
    if Path(path).suffix in {'.html', '.md', '.js', '.json', '.css'}:
        data = data.replace(b'\r\n', b'\n')
    files.append({'url': './' + path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
version = re.search(r"CACHE_VERSION = '([^']+)'", (ROOT / 'sw.js').read_text()).group(1)
(ROOT / 'asset-list.json').write_text(json.dumps({'version': version, 'files': files}, indent=2) + '\n', encoding='utf-8')
print(f'{version}: {len(files)} files, {sum(f["bytes"] for f in files):,} bytes')
