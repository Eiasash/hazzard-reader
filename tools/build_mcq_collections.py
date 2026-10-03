"""Build explicit-citation Israeli data/system IDs and requested topic fallbacks.

The citation evidence is copied verbatim from ref/explanation. It is a routing
signal, not verification that the bank's legal/clinical claim is correct.
"""
from pathlib import Path
from collections import Counter
import json
import re

ROOT = Path(__file__).resolve().parents[1]
FALLBACKS = {'99': 22, '104': 27, '105': 27, '108': 27}
BROOKDALE = ('ברוקדייל', 'ברוקדיל', 'brookdale', 'brook-dale', 'brook dale', 'שנתון', 'שנטון')
MINISTRY = ('משרד הבריאות', 'ministry of health')
PROCEDURE_PHRASES = ('נהלי משרד הבריאות', 'נוהל משרד הבריאות', 'חוזרי משרד הבריאות', 'תקנות משרד הבריאות')
PROCEDURE_WORD = re.compile(r'(?<![א-תA-Za-z])(?:נוהל|הנוהל|procedure|protocol)(?![א-תA-Za-z])', re.I)


def citation_evidence(q):
    if q['kind'] != 'past':
        return []
    fields = {f: q.get(f, '') for f in ('ref', 'explanation')}
    evidence = []
    def add(field, start, end, category):
        text = fields[field]
        evidence.append({'field': field, 'match': text[start:end], 'excerpt': text[max(0,start-60):min(len(text),end+160)], 'category': category})
    for field, text in fields.items():
        lower = text.lower()
        for term in BROOKDALE:
            start = lower.find(term)
            if start >= 0:
                add(field, start, start+len(term), 'Brookdale/yearbook')
    ministry_hits = [(field,m.start(),m.end()) for field,text in fields.items()
                     for m in re.finditer('|'.join(map(re.escape,MINISTRY)),text,re.I)]
    procedural_hits = []
    for field,text in fields.items():
        for phrase in PROCEDURE_PHRASES:
            start = text.find(phrase)
            if start >= 0:
                procedural_hits.append((field,start,start+len(phrase)))
        procedural_hits.extend((field,m.start(),m.end()) for m in PROCEDURE_WORD.finditer(text))
    if ministry_hits and procedural_hits:
        for field,start,end in ministry_hits + procedural_hits:
            add(field,start,end,'MoH procedure')
    return evidence


def build(root=ROOT):
    data = root / 'data/mcq'
    bank = json.loads((data/'all.json').read_text(encoding='utf-8'))
    topics = json.loads((data/'topics.json').read_text(encoding='utf-8'))
    index = json.loads((data/'index.json').read_text(encoding='utf-8'))
    matches = [{'id':q['id'],'sourceIndex':q['sourceIndex'],'evidence':e} for q in bank if (e:=citation_evidence(q))]
    ids = list(dict.fromkeys(q['id'] for q in matches))
    catalog = {'israeliSystem': {'enabled':len(ids)>=3,'ids':ids}, 'topicFallbacks':{}}
    for chapter,topic in FALLBACKS.items():
        items = sorted((q for q in bank if q['topic']==topic), key=lambda q:(q['kind']!='past',q['sourceIndex']))
        counts = Counter(q['kind'] for q in items)
        (data/f'{chapter}.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        index[chapter].update(past=counts['past'],practice=counts['practice'],topicFallback=topic)
        catalog['topicFallbacks'][chapter]={'topic':topic,'name':topics[topic], 'past':counts['past'],'practice':counts['practice']}
    report={'rule':'Past exam only. Literal Brookdale/yearbook term, OR explicit Ministry of Health term plus procedure citation in ref/explanation. No stems/options or managed-word substrings.',
            'count':len(ids),'matches':matches,'topicFallbacks':catalog['topicFallbacks']}
    (data/'collections.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (data/'israeli-system-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (data/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    report=build()
    print('Israeli data/system:',report['count'])
    print('Bank indices:',[x['sourceIndex'] for x in report['matches']])
