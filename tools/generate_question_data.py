# Derive the runtime catalogue and body chunks from canonical data/mcq/all.json.
import json
import re
from pathlib import Path
if __package__:
    from .build_exam_references import build as build_exam_references
else:
    from build_exam_references import build as build_exam_references
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
    references = build_exam_references()['questions']
    chapters = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['chapters']
    chapter_titles = {str(c['number']): c['title'] for c in chapters}
    for q in all_questions:
        reference = references.get(q['id'], {})
        if 'bankChapter' in reference:
            chapter = reference['bankChapter']
            title = '' if chapter is None else (reference.get('bankChapterTitle') or chapter_titles[chapter])
            q = {**q, 'chapter': chapter, 'chapterTitle': title}
        # Hash prefixes keep chunk URLs stable when questions are added or moved.
        chunk = q['id'][4:6]
        chunks.setdefault(chunk, []).append(q)
        row = {k: v for k, v in q.items() if k in FIELDS}
        row['o'] = [None] * len(q['o'])
        if 'sourceChecked' in q:
            row['sourceChecked'] = {k: v for k, v in q['sourceChecked'].items() if k == 'changedAt'}
        catalog.append(row)
    outputs = {'data/mcq/catalog.json': catalog, 'data/mcq/content-changes.json': [{'id': q['id'], 'label': 'Practice \u00b7 '+q['q'][:90], 'changedAt': q['sourceChecked']['changedAt'], 'release': q['sourceChecked']['release'], 'content_changed': True} for q in all_questions if q.get('content_changed')]}
    # Chapters search uses catalogue stems and these options. Explanations
    # and images can stay in their individual question chunks.
    outputs['data/mcq/search-options.json'] = {q['id']: q['o'] for q in all_questions if not q.get('retired')}
    outputs.update({f'data/mcq/chunks/{key}.json': value for key, value in sorted(chunks.items())})
    for name, value in outputs.items():
        path = ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    return outputs

def editorial_inputs(chapter=None):
    """Return the question and evidence locators from which an editor writes a fresh explanation."""
    bank = json.loads((ROOT / 'data/mcq/all.json').read_text(encoding='utf-8'))
    references = json.loads((ROOT / 'data/mcq/exam-references.json').read_text(encoding='utf-8'))['questions']
    for question in bank:
        reference = references.get(question['id'], {})
        assignment = reference.get('bankChapter', question.get('chapter'))
        links = {str(assignment), *map(str, reference.get('chapters', []))}
        links.update(str(p.get('readerChapter') or p.get('chapter')) for p in reference.get('pages', []))
        if chapter is not None and str(chapter) not in links:
            continue
        fields = ('id', 'kind', 'q', 'o', 'c', 'accepted', 't', 'examNumber', 'ref', 'images',
                  'sourceType', 'chapter', 'bookChapter', 'retired')
        item = {key: question[key] for key in fields if key in question}
        published = question.get('explanation') or ''
        item['explanationLanguage'] = 'he' if len(re.findall('[א-ת]', published)) > len(re.findall('[A-Za-z]', published)) else 'en'
        item['effectiveChapter'] = assignment
        item['examReference'] = {k: reference[k] for k in ('edition', 'reference', 'chapters', 'pages', 'tables', 'status', 'source', 'sitting', 'number') if k in reference}
        checked = question.get('sourceChecked') or {}
        item['reading'] = {key: checked[key] for key in ('source', 'locator') if key in checked}
        yield item


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--editorial-input', metavar='CHAPTER', help='Write source-first drafting inputs to stdout. Use all for the whole bank.')
    args = parser.parse_args()
    if args.editorial_input:
        chapter = None if args.editorial_input == 'all' else args.editorial_input
        for item in editorial_inputs(chapter):
            print(json.dumps(item, ensure_ascii=False))
    else:
        outputs = generate()
        print(f'Generated catalogue and {sum("/chunks/" in name for name in outputs)} question chunks')
