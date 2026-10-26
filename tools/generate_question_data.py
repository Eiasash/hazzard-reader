# Derive the runtime catalogue and body chunks from canonical data/mcq/all.json.
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
FIELDS = set('id sourceIndex kind q c accepted t topic topics law chapter source examNumber retired mockEligible content_changed'.split())

def generate():
    all_questions = json.loads((ROOT / 'data/mcq/all.json').read_text(encoding='utf-8'))
    # The save validator runs before fetch; derive its exact Basic sitting IDs here.
    sittings = json.loads((ROOT / 'data/mcq/exam-catalog.json').read_text(encoding='utf-8')).get('basicSittings', {})
    simulation = ROOT / 'js/exam-simulation.js'
    original = simulation.read_text(encoding='utf-8')
    updated, count = re.subn(r'(  // BEGIN GENERATED BASIC SITTINGS\n).*?(\n  // END GENERATED BASIC SITTINGS)',
                             lambda m: m[1] + '  const BASIC_SITTINGS = ' + json.dumps(sittings, separators=(',', ':')) + ';' + m[2], original, flags=re.S)
    if count != 1:
        raise ValueError('Missing Basic sitting catalogue markers')
    if updated != original:
        simulation.write_text(updated, encoding='utf-8', newline='\n')
    catalog, chunks = [], {}
    for q in all_questions:
        # Hash prefixes keep chunk URLs stable when questions are added or moved.
        chunk = q['id'][4:6]
        chunks.setdefault(chunk, []).append(q)
        row = {k: v for k, v in q.items() if k in FIELDS}
        row['o'] = [None] * len(q['o'])
        if 'sourceChecked' in q:
            row['sourceChecked'] = {k: v for k, v in q['sourceChecked'].items() if k == 'changedAt'}
        catalog.append(row)
    outputs = {'data/mcq/catalog.json': catalog, 'data/mcq/content-changes.json': [{'id': q['id'], 'label': 'Practice \u00b7 '+q['q'][:90], 'changedAt': q['sourceChecked']['changedAt'], 'release': q['sourceChecked']['release'], 'content_changed': True} for q in all_questions if q.get('content_changed')]}
    outputs.update({f'data/mcq/chunks/{key}.json': value for key, value in sorted(chunks.items())})
    for name, value in outputs.items():
        path = ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    return outputs

if __name__ == '__main__':
    outputs = generate()
    print(f'Generated catalogue and {sum("/chunks/" in name for name in outputs)} question chunks')
