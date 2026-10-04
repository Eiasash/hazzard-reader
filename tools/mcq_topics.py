"""Shared primary-plus-extra topic membership and chapter-only annotations."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def membership(question):
    return list(dict.fromkeys([question['topic'], *question.get('topics', [])]))


def chapter_membership(question, toc):
    if question['kind'] == 'past' and question.get('edition') == 8:
        pages = set()
        for group in re.findall(r'\bpp?\.\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)', question.get('readerReference', question.get('ref', '')), re.I):
            for span in group.split(','):
                ends = [int(n) for n in re.split('[-–]', span)]
                if len(ends) == 1:
                    pages.add(ends[0])
                elif ends[0] <= ends[1] <= 1740:
                    pages.update(range(ends[0], ends[1] + 1))
        chapters = [c['chapter'] for c in toc if any(c['start'] <= p <= c['end'] for p in pages)]
        if chapters:
            return chapters
    return [str(question.get('chapter', ''))]


def extend_topics(source_topics, root=ROOT):
    existing = json.loads((root / 'data/mcq/topics.json').read_text(encoding='utf-8'))
    if existing[:len(source_topics)] != source_topics:
        raise ValueError('Source topics changed existing indexes; reconcile without renumbering')
    return existing


def annotate(items, root=ROOT):
    data = root / 'data/mcq'
    mapping = json.loads((data / 'chapter-topics.json').read_text(encoding='utf-8'))
    toc = json.loads((data / 'hazzard8e-toc.json').read_text(encoding='utf-8'))['chapters']
    display_path = data / 'lab-tables.json'
    displays = json.loads(display_path.read_text(encoding='utf-8')) if display_path.exists() else {}
    for q in items:
        extras = list(dict.fromkeys([*q.get('topics', []), *(mapping[c] for c in chapter_membership(q, toc) if c in mapping)]))
        extras = [t for t in extras if t != q['topic']]
        if extras:
            q['topics'] = extras
        display = displays.get(q['id'])
        if display:
            span = display['labTable']['span']
            if not span or q['q'].count(span) != 1:
                raise ValueError('Reviewed lab span changed: ' + q['id'])
            q['labTable'] = display['labTable']
    return items
