"""Build the reader links from IMA records, chapter-level 7e matches and the served book."""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/mcq'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def page_destinations(manifest, toc):
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    result, paragraphs = {}, {}
    for chapter in manifest:
        number = chapter['number']
        if not number.isdigit() or chapter['kind'] != 'chapter':
            continue
        template = re.search(r'<template\b[^>]*id="chapter' + number + r'Template"[^>]*>(.*?)</template>', html, re.S)
        content = template[1] if template else (ROOT / 'chapters' / chapter['file']).read_text(encoding='utf-8')
        markers = set(map(int, re.findall(r'id="p(\d+)"', content)))
        extent = toc[number]
        for page in range(extent['start'], extent['end'] + 1):
            result[page] = dict(page=page, chapter=number, available=page in markers)
        current_page = None
        for tag in re.finditer(r'<(?:a|span)\b[^>]*>', content):
            attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', tag[0]))
            anchor = attrs.get('id', '')
            if re.fullmatch(r'p\d+', anchor):
                current_page = int(anchor[1:])
            if anchor and 'data-exam-ids' in attrs:
                printed = int(attrs.get('data-exam-read-page') or current_page or 0)
                for ident in attrs['data-exam-ids'].split():
                    paragraphs.setdefault((ident, printed), anchor)
    return result, paragraphs


def build(write=True):
    bank = read(DATA / 'all.json')
    official = {(r['sitting'], r['number']): r for r in read(DATA / 'exam-catalog.json')['records'].values()}
    historical = read(DATA / 'hazzard7e-chapter-links.json')['questions']
    toc = {row['chapter']: row for row in read(DATA / 'hazzard8e-toc.json')['chapters']}
    pages, paragraphs = page_destinations(read(ROOT / 'manifest.json')['chapters'], toc)
    index = read(DATA / 'index.json')
    study = {}
    for chapter in toc:
        imported = read(DATA / (chapter + '.json')) if chapter in index else []
        study[chapter] = dict(ids=[], before=sum(q['kind']=='past' for q in imported), past=0,
                              resolved=0, fallback=0, practice=0, chapterLinked=0)

    entries = {}
    for question in bank:
        if question['kind'] != 'past':
            chapter = str(question.get('chapter'))
            if chapter in study and not question.get('retired'):
                study[chapter]['practice'] += 1
            continue
        ident = question['id']
        sitting = question['t'].removesuffix('-Subspec')
        record = official[sitting, question['examNumber']]
        mapping = record.get('readerMapping', {})
        entry = dict(sitting=sitting, number=record['number'], edition=record['edition'], source=record['source'],
                     reference=record['reference'], questionRef=question['ref'], status='unresolved',
                     reason='The bibliography gives no Hazzard 8e page for this question.', pages=[], tables=[], chapters=[])
        entries[ident] = entry
        for field in ('bankChapter', 'bankChapterTitle', 'relatedTeaching'):
            if field in mapping:
                entry[field] = mapping[field]
        if record.get('referenceNote'):
            entry['referenceNote'] = record['referenceNote']
        old = historical.get(ident)
        if int(sitting[:4]) < 2023:
            if old and not old.get('hold'):
                entry.update(chapters=[old['chapter']], status=old['method'],
                             reason='Eighth-edition topic or chapter match. Seventh-edition page numbers are not transferable.')
                for field in ('chapter7', 'title7', 'tables'):
                    if field in old:
                        entry[field] = old[field]
            elif old and old.get('hold'):
                entry['reason'] = old['hold']
        elif 'printedPages' in mapping:
            cited = mapping['printedPages']
            # Distinguish an official but misleading locator from a verified teaching passage.
            entry['pages'] = [{**pages[p], **({'citationOnly': True} if p in mapping.get('citationOnly', []) else {})}
                              for p in cited if p in pages and not mapping.get('topicOnly')]
            if mapping.get('supportPages'):
                entry['supportPages'] = [dict(pages[p]) for p in mapping['supportPages']]
            for location in [*entry['pages'], *entry.get('supportPages', [])]:
                anchor = paragraphs.get((ident, location['page']))
                if anchor and not location.get('citationOnly'):
                    location['anchor'] = anchor
                cue = mapping.get('passages', {}).get(str(location['page']))
                if cue and not anchor and not location.get('citationOnly'):
                    if isinstance(cue, dict):
                        location.update({key: cue[key] for key in ('contextPage', 'rangeText', 'imageFile') if key in cue})
                        cue = cue['text']
                    location.update(anchor=f"exam-p{location['page']}-{ident}", passage=cue)
            entry['chapters'] = mapping.get('chapters', list(dict.fromkeys(p['chapter'] for p in entry['pages'])))
            entry['tables'] = mapping.get('tables', [])
            if mapping.get('figures'):
                entry['figures'] = mapping['figures']
            if entry['pages']:
                entry.update(status='resolved', reason='')
            elif entry['chapters']:
                status = 'topic-8e' if mapping.get('topicOnly') else 'chapter-only'
                entry.update(status=status, reason='Topic match to the eighth edition.' if status=='topic-8e'
                             else 'The bibliography names the chapter without giving a printed page.')
        membership = {str(mapping.get('bankChapter', question.get('chapter'))), *entry['chapters']}
        for chapter in membership.intersection(study):
            row = study[chapter]
            row['ids'].append(ident)
            row['past'] += 1
            if entry['status'] == 'resolved':
                row['resolved'] += 1
            elif entry['chapters']:
                row['chapterLinked'] += 1
            else:
                row['fallback'] += 1
    result = dict(version=1, edition=8, tocSource='hazzard8e-toc.json', questions=entries, study=study)
    if write:
        (DATA / 'exam-references.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n',
                                                  encoding='utf-8', newline='\n')
    print(f'{len(entries)} official questions: {dict(Counter(e["status"] for e in entries.values()))}')
    return result


if __name__ == '__main__':
    build()
