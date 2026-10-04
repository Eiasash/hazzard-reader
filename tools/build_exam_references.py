"""Rebuild citation metadata only; never rewrite questions, answers or IDs."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/mcq'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def build():
    bank = read(DATA / 'all.json')
    catalog = read(DATA / 'exam-catalog.json')['records']
    toc = read(DATA / 'hazzard8e-toc.json')['chapters']
    manifest = read(ROOT / 'manifest.json')['chapters']
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    markers, destinations = {}, {}
    for ch in manifest:
        number = ch['number'].removesuffix('s')
        if not number.isdigit() or not (ch['kind'] == 'chapter' or ch.get('studyOnly')):
            continue
        # Five chapters render from templates, so inspect the actual surface.
        template = re.search(r'<template\b[^>]*id="chapter' + ch['number'] + r'Template"[^>]*>(.*?)</template>', html, re.S)
        content = template[1] if template else (ROOT / 'chapters' / ch['file']).read_text(encoding='utf-8')
        markers[number] = set(map(int, re.findall(r'id="p(\d+)"', content)))
        if ch.get('studyOnly'):
            destinations[number] = ch['number']
    official = {(r['sitting'], r['number']): r for r in catalog.values()}
    entries = {}
    for q in bank:
        if q['kind'] != 'past':
            continue
        sitting = q['t'].removesuffix('-Subspec')
        r = official[(sitting, q['examNumber'])]
        entry = dict(sitting=sitting, number=r['number'], edition=r['edition'],
                     source=r['source'], reference=r['reference'], questionRef=q['ref'],
                     status='unresolved', reason='', pages=[], tables=[], chapters=[])
        entries[q['id']] = entry
        if r['edition'] != 8 or not 2023 <= int(sitting[:4]) <= 2026:
            entry['reason'] = 'Outside 2023–2026 Hazzard 8e scope; no 7e page mapping'
            continue
        if r['type'] != 'Hazzard':
            entry['reason'] = 'Official reference is not Hazzard 8e'
            continue
        # A checked correction never silently replaces the printed IMA citation.
        ref = r.get('readerReference', r['reference'])
        if r.get('referenceNote'):
            entry['referenceNote'] = r['referenceNote']
        entry['tables'] = list(dict.fromkeys(re.findall(r'\bTable\s+(\d+[-–]\d+)', ref, re.I)))
        # Only explicit p./pp. locators count as pages. Table/chapter numbers do not.
        page_sets = re.findall(r'\bpp?\.\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)', ref, re.I)
        pages = set()
        for page_set in page_sets:
            for span in page_set.split(','):
                ends = [int(v) for v in re.split(r'[-–]', span)]
                if len(ends) == 1:
                    pages.add(ends[0])
                elif ends[0] <= ends[1] <= 1740:
                    pages.update(range(ends[0], ends[1] + 1))
        for page in sorted(pages):
            ch = next((c['chapter'] for c in toc if c['start'] <= page <= c['end']), None)
            entry['pages'].append(dict(page=page, chapter=ch, available=page in markers.get(ch, set())))
            if ch in destinations:
                entry['pages'][-1]['readerChapter'] = destinations[ch]
        entry['chapters'] = list(dict.fromkeys(p['chapter'] for p in entry['pages'] if p['chapter']))
        if pages and all(p['chapter'] for p in entry['pages']):
            entry['status'] = 'resolved'
        else:
            entry['reason'] = 'No explicit printed page' if not pages else 'Printed page outside chapter TOC ranges'
    study = {}
    index = read(DATA / 'index.json')
    for ch in dict.fromkeys([*index, *destinations]):
        if ch == 'law':
            continue  # The Israeli-law collection has its own explicit membership.
        old = read(DATA / f'{ch}.json') if ch in index else []
        past = [q for q in bank if q['kind'] == 'past' and
                (ch in entries[q['id']]['chapters'] if entries[q['id']]['status'] == 'resolved' else ch not in destinations and str(q.get('chapter')) == ch)]
        study[ch] = dict(ids=[q['id'] for q in past], before=sum(q['kind'] == 'past' for q in old),
                         past=len(past), resolved=sum(entries[q['id']]['status'] == 'resolved' for q in past),
                         fallback=sum(entries[q['id']]['status'] != 'resolved' for q in past),
                         practice=sum(q['kind'] == 'practice' for q in old))
        if ch in destinations:
            study[ch]['studyOnly'] = True
    result = dict(version=1, edition=8, tocSource='hazzard8e-toc.json', questions=entries, study=study)
    (DATA / 'exam-references.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} official questions; {sum(e["status"] == "resolved" for e in entries.values())} resolved')


if __name__ == '__main__':
    build()
