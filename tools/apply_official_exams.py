"""Apply the rendered-paper catalog and official keys before building any view.

The source bank is read-only. Keep original content IDs: corrections must not
silently reassign a saved answer to a different question or option ordering.
"""
import json
import re
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]


def apply(items, root=ROOT):
    data = root / 'data/mcq'
    records = json.loads((data / 'exam-catalog.json').read_text(encoding='utf-8'))['records']
    overrides = json.loads((data / 'official-overrides.json').read_text(encoding='utf-8'))['entries']
    result, excluded, seen = [], [], set()
    for original in items:
        q = dict(original)
        key = str(q['sourceIndex'])
        if q['kind'] == 'past':
            row = records.get(key)
            if row is None:
                excluded.append({'index': q['sourceIndex'], 'reason': 'basic-only-or-duplicate'})
                continue
            if q['id'] not in {row['id'], row.get('uniqueId')}:
                raise ValueError(f'Question {key} changed since its official-paper match; rematch before importing')
            seen.add(key)
            if row.get('images'):
                q['images'] = list(row['images'])
            for field in ('q', 'explanation', 'explanationIncomplete', 'explanationSource'):
                if field in row:
                    q[field] = row[field]
            q.update(t=row['sitting'] + '-Subspec', examNumber=row['number'],
                     sourceType=row['type'], ref=row['reference'],
                     referenceSource='IMA ' + row['sitting'] + f' reference list, Q{row["number"]}',
                     israeliSystem=row['type'] in {'Law', 'Procedure', 'Circular', 'Yearbook'},
                     suppliedArticle=row['type'] == 'Article')
            if row['type'] == 'Hazzard':
                q['edition'] = row['edition']
            if row.get('uniqueId'):
                q['id'] = row['uniqueId']
            if row['edition'] == 7:
                # Remove later-edition attributions from generated bank prose;
                # do not relabel unverified prose as a verified 7e quotation.
                q['explanation'] = re.sub(r'\b8e\b|\b8th\s+ed(?:ition)?\.?|מהדורה\s*8', '', q['explanation'], flags=re.I)
        else:
            q['sourceType'] = 'Hazzard practice'
        override = overrides.get(key)
        if override:
            q['accepted'] = override['accepted']
            q['c'] = q['c'] if q['c'] in q['accepted'] else q['accepted'][0]
            q['keySource'] = override['source']['title'] + ', Q' + str(override['source']['question'])
            for field in ('label', 'mockEligible', 'explanation'):
                if field in override:
                    q[field] = override[field]
        if len(q['accepted']) == len(q['o']):
            q.update(mockEligible=False, label='All answers accepted after appeal')
        for field in ('ref', 'explanation'):
            paragraphs = re.split(r'(?:\\n\\n|\n\n)', q.get(field, ''))
            q[field] = '\n\n'.join(p for p in paragraphs if not re.search(r'\bGRS\s*\d*\b', p, re.I))
        result.append(q)
    missing = set(records) - seen
    if missing:
        raise ValueError('Previously verified questions unavailable: ' + ', '.join(sorted(missing, key=int)))
    return result, excluded


if __name__ == '__main__':
    data = ROOT / 'data/mcq'
    items, excluded = apply(json.loads((data / 'all.json').read_text(encoding='utf-8')))
    (data / 'all.json').write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    index = json.loads((data / 'index.json').read_text(encoding='utf-8'))
    for chapter in index:
        if chapter.isdigit():
            subset = [q for q in items if q['chapter'] == chapter]
            (data / f'{chapter}.json').write_text(json.dumps(subset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
            counts = Counter(q['kind'] for q in subset)
            index[chapter].update(past=counts['past'], practice=counts['practice'])
    (data / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = json.loads((data / 'import-report.json').read_text(encoding='utf-8'))
    report.update(included=len(items), sources=dict(Counter(q['t'] for q in items)), source_types=dict(Counter(q['sourceType'] for q in items)))
    included = {q['sourceIndex'] for q in items}
    report['excluded'] = [x for x in {x['index']:x for x in [*report['excluded'],*excluded]}.values() if x['index'] not in included]
    report['excluded_counts'] = dict(Counter(q['reason'] for q in report['excluded']))
    report['chapters'] = index
    report['topics'] = {t: {**v, **{kind: sum(q['topic'] == int(t) and q['kind'] == kind for q in items) for kind in ('past','practice')}} for t,v in report['topics'].items()}
    (data / 'import-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    from build_law_mcqs import build as law
    from build_mcq_collections import build as collections
    law(ROOT)
    collections(ROOT)
    print(f'{len(items)} questions; {len(excluded)} Basic-only / duplicate records removed')
