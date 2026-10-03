"""Build official IMA source collections and existing topic fallbacks."""
from pathlib import Path
from collections import Counter
import json
import re

ROOT = Path(__file__).resolve().parents[1]
FALLBACKS = {'99': 22, '104': 27, '105': 27, '108': 27}
def build(root=ROOT):
    data = root / 'data/mcq'
    bank = json.loads((data/'all.json').read_text(encoding='utf-8'))
    topics = json.loads((data/'topics.json').read_text(encoding='utf-8'))
    index = json.loads((data/'index.json').read_text(encoding='utf-8'))
    matches = [{'id':q['id'],'sourceIndex':q['sourceIndex'],'sitting':q['t'],'question':q['examNumber'],'type':q['sourceType'],'reference':q['ref'],'source':q['referenceSource']} for q in bank if q.get('israeliSystem')]
    ids = list(dict.fromkeys(q['id'] for q in matches))
    catalog = {'israeliSystem': {'enabled':len(ids)>=3,'ids':ids}, 'suppliedArticles':{'enabled':True,'ids':[q['id'] for q in bank if q.get('suppliedArticle')]}, 'topicFallbacks':{}}
    for chapter,topic in FALLBACKS.items():
        items = sorted((q for q in bank if q['topic']==topic), key=lambda q:(q['kind']!='past',q['sourceIndex']))
        counts = Counter(q['kind'] for q in items)
        (data/f'{chapter}.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        index[chapter].update(past=counts['past'],practice=counts['practice'],topicFallback=topic)
        catalog['topicFallbacks'][chapter]={'topic':topic,'name':topics[topic], 'past':counts['past'],'practice':counts['practice']}
    report={'rule':'Rendered IMA reference lists: law, MoH procedure/circular, statistical yearbook/Brookdale. X rows resolved from rendered question paper. No keyword classifier.',
            'count':len(ids),'matches':matches,'topicFallbacks':catalog['topicFallbacks']}
    (data/'collections.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (data/'israeli-system-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (data/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    report=build()
    print('Israeli law & system:',report['count'])
    print('Bank indices:',[x['sourceIndex'] for x in report['matches']])
