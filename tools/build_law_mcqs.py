"""Link existing imported MCQs to the law block's named, covered statutes.

Only complete statute names in a question stem or reference count. Options,
explanations, topic guesses and the block's explicitly unreviewed list do not.
This does not reclassify the bank's combined regulatory/ethics source.
"""
from pathlib import Path
import json
import re
from hashlib import sha256
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]


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
    matched, evidence = [], []
    for question in bank:
        matches = []
        for statute in statutes:
            fields = [field for field in ('q', 'ref')
                      if statute in ' '.join(question.get(field, '').split())]
            if fields:
                matches.append({'statute': statute, 'fields': fields})
        if matches:
            matched.append(question)
            evidence.append({'id': question['id'], 'sourceIndex': question['sourceIndex'],
                             'kind': question['kind'], 'regulatory': question['law'], 'matches': matches})
    matched.sort(key=lambda q: (q['kind'] != 'past', q['sourceIndex']))
    ids = {q['id'] for q in matched}
    unmatched = [q['sourceIndex'] for q in bank if q['law'] and q['id'] not in ids]
    counts = Counter(q['kind'] for q in matched)
    report = {'law_block_sha256': sha256(block_path.read_bytes()).hexdigest(),
              'rule': 'Full covered statute name in q or ref; whitespace normalized only.',
              'statutes': statutes, 'past': counts['past'], 'practice': counts['practice'],
              'regulatory_matches': sum(q['law'] for q in matched),
              'outside_regulatory': [q['sourceIndex'] for q in matched if not q['law']],
              'unmatched_regulatory': unmatched, 'evidence': evidence}
    (data / 'law.json').write_text(json.dumps(matched, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    (data / 'law-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    index = json.loads((data / 'index.json').read_text(encoding='utf-8'))
    index['law'] = {'title': 'Israeli law', 'past': counts['past'], 'practice': counts['practice']}
    (data / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    result = build()
    print(f"Law block: {result['past']} past, {result['practice']} practice; "
          f"{len(result['unmatched_regulatory'])} combined-source items unmatched")
