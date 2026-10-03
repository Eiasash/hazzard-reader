"""Build the topic-based Law & ethics source and the law study union.

Only complete statute names in a question stem or reference count. Options,
explanations, topic guesses and the block's explicitly unreviewed list do not.
Law & ethics uses primary topics 30–34 only; regulatory.json is not used.
"""
from pathlib import Path
import json
import re
from hashlib import sha256
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
LAW_TOPICS = (30, 31, 32, 33, 34)


def build(root=ROOT):
    block_path = root / 'chapters/israel_law.md'
    block = block_path.read_text(encoding='utf-8')
    boundary = '## מסמכים ישראליים/משרד הבריאות נוספים'
    if boundary not in block:
        raise ValueError('Law block reviewed/unreviewed boundary not found')
    covered = block.split(boundary, 1)[0]
    statutes = re.findall(r'^## (חוק [^,\n]+),', covered, re.M)
    if not statutes or len(statutes) != len(set(statutes)):
        raise ValueError('Cannot identify unique covered statute names')
    data = root / 'data/mcq'
    bank = json.loads((data / 'all.json').read_text(encoding='utf-8'))
    topics = json.loads((data / 'topics.json').read_text(encoding='utf-8'))
    for question in bank:
        question['law'] = question['topic'] in LAW_TOPICS
    (data / 'all.json').write_text(json.dumps(bank, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    by_index = {q['sourceIndex']: q for q in bank}
    index = json.loads((data / 'index.json').read_text(encoding='utf-8'))
    for chapter in index:
        if not chapter.isdigit():
            continue
        path = data / f'{chapter}.json'
        subset = [by_index[q['sourceIndex']] for q in json.loads(path.read_text(encoding='utf-8'))]
        path.write_text(json.dumps(subset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    matched, evidence = [], []
    for question in bank:
        matches = []
        for statute in statutes:
            fields = [field for field in ('q', 'ref')
                      if statute in ' '.join(question.get(field, '').split())]
            if fields:
                matches.append({'statute': statute, 'fields': fields})
        if matches or question['law']:
            matched.append(question)
            evidence.append({'id': question['id'], 'sourceIndex': question['sourceIndex'],
                             'kind': question['kind'], 'topic': question['topic'],
                             'topicIncluded': question['law'], 'matches': matches})
    matched.sort(key=lambda q: (q['kind'] != 'past', q['sourceIndex']))
    counts = Counter(q['kind'] for q in matched)
    source_counts = Counter(q['kind'] for q in bank if q['law'])
    topic_counts = {str(t): {'name': topics[t], **{kind: sum(q['topic'] == t and q['kind'] == kind for q in bank) for kind in ('past','practice')}} for t in LAW_TOPICS}
    report = {'law_block_sha256': sha256(block_path.read_bytes()).hexdigest(),
              'rule': 'Primary topic 30–34 OR full covered statute name in q/ref; no regulatory.json.',
              'statutes': statutes, 'past': counts['past'], 'practice': counts['practice'],
              'source_past': source_counts['past'], 'source_practice': source_counts['practice'],
              'topics': topic_counts, 'exact_name_matches': sum(bool(x['matches']) for x in evidence),
              'exact_only': [q['sourceIndex'] for q in matched if not q['law']], 'evidence': evidence}
    (data / 'law.json').write_text(json.dumps(matched, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    (data / 'law-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    index['law'] = {'title': 'Israeli law', 'past': counts['past'], 'practice': counts['practice']}
    (data / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    import_path = data / 'import-report.json'
    if import_path.exists():
        imported = json.loads(import_path.read_text(encoding='utf-8'))
        imported['source_sha256'].pop('regulatory.json', None)
        imported.update(law_count=sum(source_counts.values()),law_rule='primary topic index in 30,31,32,33,34; regulatory.json not used',law_topics=topic_counts)
        import_path.write_text(json.dumps(imported,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__ == '__main__':
    result = build()
    print(f"Law & ethics: {result['source_past']} past, {result['source_practice']} practice; "
          f"law block: {result['past']} past, {result['practice']} practice")
