"""Build the optional, stateless design prototype on the isolated preview only."""
import json
import shutil
from pathlib import Path


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n',
                    encoding='utf-8', newline='\n')


def publish(root, output):
    root = Path(root)
    target = Path(output) / 'overhaul'
    target.mkdir(parents=True, exist_ok=True)
    assets = Path(__file__).resolve().parent / 'overhaul-prototype'
    for name in ('index.html', 'prototype.js', 'prototype.css'):
        shutil.copyfile(assets / name, target / name)
    manifest = json.loads((root / 'manifest.json').read_bytes())['chapters']
    by_id = {str(c['number']): c for c in manifest}
    refs = json.loads((root / 'data/mcq/exam-references.json').read_bytes())['study']
    bank = json.loads((root / 'data/mcq/all.json').read_bytes())
    active = {q['id']: q for q in bank if not q.get('retired')}
    chapters = []
    for chapter, entry in by_id.items():
        if entry['kind'] != 'chapter' or chapter+'s' not in by_id:
            continue
        public_ids = [qid for qid in refs.get(chapter, {}).get('ids', []) if qid in active]
        chapters.append({'id':chapter, 'title':entry['title'], 'read':entry['file'],
                         'study':by_id[chapter+'s']['file'], 'official':public_ids})
    ids = next(c['official'] for c in chapters if c['id']=='61')
    official = sorted(ids, key=lambda k:(active[k].get('t',''), active[k].get('examNumber') or 0),
                      reverse=True)
    practice = next(q['id'] for q in bank if str(q.get('chapter'))=='61'
                    and q['kind']=='practice' and not q.get('retired') and q['q'].lstrip()[:1].isascii())
    sample_ids = [official[0], practice, official[1]]
    study_source = (root/'chapters'/by_id['61s']['file']).read_text(encoding='utf-8').splitlines()
    title = next(i for i,line in enumerate(study_source) if line.startswith('# '))
    orientation = next(line.strip() for line in study_source[title+1:] if line.strip())
    write_json(target/'start.json', {'chapters':chapters,'sample':sample_ids,'orientation':orientation,
                                     'answers':[active[k] for k in sample_ids]})
    index = json.loads((root/'data/drug-index.json').read_bytes())
    write_json(target/'drugs.json', [
        {'id':d['id'],'name':d['name'],'kind':d['kind'],'class':d.get('class',''),
         'aliases':d.get('aliases',[]),'passages':len(d['passages']),'questions':len(d['questions'])}
        for d in index['entries']])
