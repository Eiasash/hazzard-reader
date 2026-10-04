"""Copy dated past exams and Hazzard MCQs into the reader; source tree is read-only.

Usage: python tools/import_mcqs.py C:/Users/eiasa/repos/Geriatrics
All eligible sources are imported for the bank; chapter subsets keep study
pages fast. No topic index is used as an exam question number.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from urllib.parse import urlparse, unquote
from urllib.request import Request, urlopen
from build_law_mcqs import LAW_TOPICS, build
from mcq_topics import membership, extend_topics

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def category(q):
    if q.get('t') == 'Hazzard':
        return 'practice'
    if re.fullmatch(r'\d{4}(?:-[A-Za-z]+(?:-(?:Basic|Subspec))?)?', q.get('t', '')):
        return 'past'
    return None


def broken(q):
    return bool(q.get('broken')) or 'broken' in str(q.get('status', '')).lower()


def image_refs(q):
    values = ([q['img']] if q.get('img') else []) + (q.get('imgs') or [])
    return list(dict.fromkeys(values))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    if source == ROOT:
        raise ValueError('Source must be the separate Geriatrics repository')
    from PIL import Image
    files = {name: source / 'data' / name for name in ('questions.json', 'question_chapters.json', 'explanations.json', 'topics.json', 'hazzard_index.json')}
    files['shlav-a-mega.html'] = source / 'shlav-a-mega.html'
    hashes = {name: sha256(path.read_bytes()).hexdigest() for name, path in files.items()}
    questions, mappings, explanations = (read(files[name]) for name in ('questions.json', 'question_chapters.json', 'explanations.json'))
    match = re.search(r'const TOPICS=(\[[^;]+\]);', files['shlav-a-mega.html'].read_text(encoding='utf-8'))
    if not match:
        raise ValueError('Topic names not found in source app')
    topics = json.loads(match[1])
    if len(topics) != len(read(files['topics.json'])):
        raise ValueError('Topic names and topic index differ')
    topics = extend_topics(topics, ROOT)
    titles = read(files['hazzard_index.json'])
    chapters = {str(c['number']): c['title'] for c in read(ROOT / 'manifest.json')['chapters']
                if c['kind'] == 'chapter' and str(c['number']).isdigit()}
    destination = ROOT / 'data' / 'mcq'
    images = destination / 'images'
    images.mkdir(parents=True, exist_ok=True)
    catalog = read(destination / 'exam-catalog.json')['records']
    local_images = {ref for row in catalog.values() for ref in row.get('images', [])}
    def refs_for(index, question):
        return catalog.get(str(index), {}).get('images') or image_refs(question)
    excluded, candidates = [], []
    for i, q in enumerate(questions):
        kind = category(q)
        ch = str(mappings.get(str(i), {}).get('haz', ''))
        if not kind:
            reason = 'other-source-tag'
        elif broken(q):
            reason = 'broken'
        elif kind == 'past' and str(i) not in catalog:
            reason = 'basic-only-or-duplicate'
        else:
            candidates.append((i, q, ch, kind))
            continue
        excluded.append({'index': i, 'reason': reason})

    def copy_image(ref):
        parsed = urlparse(ref)
        suffix = Path(unquote(parsed.path)).suffix.lower()
        if suffix not in {'.png', '.jpg', '.jpeg', '.webp', '.gif'}:
            return ref, None, 'unsupported image format'
        target = images / (sha256(ref.encode()).hexdigest()[:20] + suffix)
        try:
            if ref in local_images:
                local = (ROOT / ref).resolve()
                if not local.is_relative_to(images.resolve()):
                    raise ValueError('Catalog image outside reader image directory')
                with Image.open(local) as image:
                    image.verify()
                return ref, local.relative_to(ROOT).as_posix(), None
            elif target.exists():
                data = target.read_bytes()
            elif parsed.scheme in {'http', 'https'}:
                with urlopen(Request(ref, headers={'User-Agent': 'Hazzard-reader-import/41'}), timeout=30) as response:
                    data = response.read()
            elif not parsed.scheme:
                local = (source / unquote(parsed.path).lstrip('/')).resolve()
                if not local.is_relative_to(source):
                    raise ValueError('Image path outside source')
                data = local.read_bytes()
            else:
                raise ValueError('Unsupported image URL')
            with Image.open(BytesIO(data)) as image:
                image.verify()
            if not target.exists():
                target.write_bytes(data)
            return ref, target.relative_to(ROOT).as_posix(), None
        except Exception as error:
            return ref, None, type(error).__name__ + ': ' + str(error)

    refs = sorted({r for i, q, _, _ in candidates for r in refs_for(i, q)})
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = dict((ref, (path, error)) for ref, path, error in pool.map(copy_image, refs))
    bank = {ch: [] for ch in chapters}
    all_items = []
    for i, q, ch, kind in candidates:
        refs = refs_for(i, q)
        missing = [r for r in refs if not results[r][0]]
        if missing or (q.get('imgDep') and not refs):
            excluded.append({'index': i, 'reason': 'missing-image', 'images': missing})
            continue
        if not isinstance(q.get('c'), int) or not 0 <= q['c'] < len(q.get('o', [])):
            raise ValueError(f'Invalid answer key at source index {i}')
        accepted = sorted(set([q['c'], *(q.get('c_accept') or [])]))
        if any(not isinstance(n, int) or not 0 <= n < len(q['o']) for n in accepted):
            raise ValueError(f'Invalid accepted answer at source index {i}')
        explanation = explanations[i] if isinstance(explanations, list) else explanations.get(str(i), '')
        identity = json.dumps([q['q'], q['o'], accepted, q['t']], ensure_ascii=False, separators=(',', ':'))
        item = {'id': 'mcq-' + sha256(identity.encode()).hexdigest()[:24], 'sourceIndex': i, 'kind': kind, 'q': q['q'], 'o': q['o'], 'c': q['c'],
                         'accepted': accepted, 't': q['t'], 'explanation': explanation or '',
                         'ref': q.get('ref', ''), 'images': [results[r][0] for r in refs],
                         'topic': q['ti'], 'law': q['ti'] in LAW_TOPICS, 'chapter': ch,
                         'chapterTitle': chapters.get(ch) or titles.get(ch, {}).get('title', '')}
        if not isinstance(q['ti'], int) or not 0 <= q['ti'] < len(topics):
            raise ValueError(f'Unknown topic index at {i}')
        all_items.append(item)
        if ch in bank:
            bank[ch].append(item)
    from apply_official_exams import apply
    all_items, official_excluded = apply(all_items, ROOT)
    excluded.extend(official_excluded)
    bank = {ch: [q for q in all_items if q['chapter'] == ch] for ch in chapters}
    index = {}
    for ch in sorted(chapters, key=int):
        items = bank[ch]
        (destination / f'{ch}.json').write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        counts = Counter(q['kind'] for q in items)
        index[ch] = {'title': chapters[ch], 'past': counts['past'], 'practice': counts['practice']}
    (destination / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (destination / 'all.json').write_text(json.dumps(all_items, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    (destination / 'topics.json').write_text(json.dumps(topics, ensure_ascii=False) + '\n', encoding='utf-8')
    topic_counts = {str(i): {'name': name, 'past': sum(i in membership(x) and x['kind']=='past' for x in all_items), 'practice': sum(i in membership(x) and x['kind']=='practice' for x in all_items)} for i,name in enumerate(topics)}
    report = {'source_sha256': hashes, 'total_source': len(questions), 'included': len(all_items),
              'excluded_counts': dict(Counter(x['reason'] for x in excluded)), 'excluded': excluded,
              'image_failures': {r: error for r, (_, error) in results.items() if error}, 'chapters': index,
              'sources': dict(Counter(x['t'] for x in all_items)), 'topics': topic_counts,
              'law_count': sum(x['law'] for x in all_items), 'law_rule': 'topic membership in 30,31,32,33,34; regulatory.json not used',
              'other_sources': dict(Counter(q['t'] for q in questions if not category(q)))}
    (destination / 'import-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if any(sha256(path.read_bytes()).hexdigest() != hashes[name] for name, path in files.items()):
        raise RuntimeError('Source changed during import; rerun against a stable snapshot')
    build(ROOT)
    from build_mcq_collections import build as build_collections
    build_collections(ROOT)
    print(json.dumps({k: report[k] for k in ('total_source', 'included', 'excluded_counts')}, indent=2))


if __name__ == '__main__':
    main()
