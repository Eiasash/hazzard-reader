"""Publish the Study self-checks in the graded flashcard deck.

The original drill key identifies the card across wording changes. Editorial
matches in recallKeys allow two prompts to share an existing clinical card.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAW_ANCHORS = [
    'law-dying-15', 'law-dying-16', 'law-dying-17', 'law-dying-16',
    'law-patient-14a', 'law-patient-14b', 'law-patient-14a', 'law-patient-14b',
    'law-capacity-32v', 'law-capacity-74a', 'law-capacity-32v', 'law-informed-consent',
    'law-brookdale-2024', 'law-brookdale-2024', 'law-brookdale-2024',
    'law-care-classification', 'law-care-classification', 'law-complex-nursing',
]

def publish(rows, printed_pages):
    path = ROOT / 'data/flashcards.json'
    previous = json.loads(path.read_bytes())
    cards = [c for c in previous if not c.get('fromRecall')]
    by_key = {key: c for c in cards for key in c.get('recallKeys', [])}
    seen = set()
    for row in rows:
        key = row['key']
        if key in seen:
            raise ValueError(f'Two Study prompts use the same grade key: {key}')
        seen.add(key)
        if key in by_key:
            continue
        chapter = row['chapter']
        suffix = key.partition(':')[2]
        card = {
            'id': f"ch{chapter if chapter != 'law' else '0'}-study-{suffix}",
            'chapter': chapter, 'front': row['front'], 'back': row['back'],
            'questionIds': [], 'recallKeys': [key], 'fromRecall': True,
        }
        if row.get('answerSource'):
            card['answerSource'] = row['answerSource']
        if chapter == 'law':
            card.update(anchor=LAW_ANCHORS[int(suffix)-1], sourceLabel='Read the legal provision', page=None)
        else:
            location = re.search(r'\?chapter=(\d+)#p(\d+)', row.get('link') or '')
            printed = re.search(r'\b(?:pages?|pp?)\.?\s*(\d+)', row['back']+' '+row['front'], re.I)
            if not printed and not location:
                raise ValueError(f'Missing printed page for {key}')
            page = int(location[2] if location else printed[1])
            book = location[1] if location else chapter
            if page not in printed_pages.get(book, set()):
                matches = [n for n, pages in printed_pages.items() if page in pages]
                if len(matches) != 1:
                    raise ValueError(f'Ambiguous printed page {page} for {key}')
                book = matches[0]
            card.update(anchor=f'p{page}', page=page)
            if chapter != book:
                card['readChapter'] = book
        cards.append(card)
    if len({c['id'] for c in cards}) != len(cards):
        raise ValueError('Flashcard ID collision')
    path.write_text(json.dumps(cards, ensure_ascii=False, indent=2)+'\n', encoding='utf8', newline='\n')
    print(f'{len(seen)} Study prompts, {len(cards)} graded cards')
