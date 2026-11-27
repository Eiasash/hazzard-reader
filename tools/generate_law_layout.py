"""Precompute bidirectional runs in required-reading cards without altering source wording."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEBREW = re.compile(r'[\u0590-\u05ff]')
STRONG = re.compile(r'[A-Za-z\u05d0-\u05ea]')
RUN = re.compile(
    r'(?:\(\s*§\s*\d+[\u05d0-\u05ea]?(?:\([\d\u05d0-\u05ea]+\))?\s*\)|'
    r'§\s*\d+[\u05d0-\u05ea]?(?:\([\d\u05d0-\u05ea]+\))*|'
    r'\d{1,2}\.\d{1,2}\.\d{4}|'
    r'\d+(?:[.,]\d+)?(?:\s*[-–—−]\s*\d+(?:[.,]\d+)?)+(?:[%‰])?|'
    r'[A-Za-z][A-Za-z0-9’/_+-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9’/_+-]*)*)[.,;:!?]?'
)

def generate():
    data = json.loads((ROOT / 'data/law-cards.json').read_bytes())
    # A lesson can quote Hebrew as its first term while its sentence is English.
    # Ignore bracketed bibliography when deciding the language of a teaching bullet.
    english_bullets = set()
    for card in [*data['cards'], *data['articles']['cards']]:
        for bullet in card.get('bullets', []):
            prose = re.sub(r'\[[^\]]*\]', '', bullet)
            if HEBREW.search(prose) and len(re.findall(r'[A-Za-z]+', prose)) > len(re.findall(r'[\u05d0-\u05ea]+', prose)):
                english_bullets.add(bullet)
    layout = {}
    def collect(value):
        if isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, str) and HEBREW.search(value):
            if value in english_bullets:
                layout[value] = [False, [value], 'en']
                return
            first = STRONG.search(value)
            if first is None:
                return
            parts = []
            end = 0
            for match in RUN.finditer(value):
                parts.extend([value[end:match.start()], match.group()])
                end = match.end()
            parts.append(value[end:])
            layout[value] = [bool(HEBREW.match(first.group())), parts]
    collect(data)
    out = ROOT / 'data/law-card-layout.json'
    out.write_text(json.dumps(layout, ensure_ascii=False, separators=(',',':')) + '\n', encoding='utf8', newline='\n')
    return str(out.relative_to(ROOT)).replace('\\','/')

if __name__ == '__main__':
    generate()
