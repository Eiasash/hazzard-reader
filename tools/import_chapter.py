"""Import a chapter's extracted Markdown, respecting a full-width Further Reading divider.

Usage: python tools/import_chapter.py SOURCE.md DESTINATION.md --pdf BOOK.pdf
The publisher's 1,824-page edition has 34 pages of front matter. A reference
section can begin below BOTH text columns. Sorting the whole page by column
first puts the top right column between two sets of references.
"""
import argparse
import html
from pathlib import Path
import re
import unicodedata

def letters(text):
    text = re.sub(r'<[^>]+>|⟨[^⟩]+⟩', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', html.unescape(text)).lower())

def order_tail(markdown, book, offset=34):
    blocks = markdown.split('\n\n')
    heading = next((i for i,b in enumerate(blocks) if b.strip().upper() == '## FURTHER READING'), None)
    if heading is None:
        return markdown
    pages = re.findall(r'<a id="p(\d+)"', '\n'.join(blocks[:heading]))
    if not pages:
        raise ValueError('Missing printed page anchor before Further Reading')
    page = book[int(pages[-1])+offset-1]
    lines = [(line['bbox'], ''.join(s['text'] for s in line['spans']))
             for block in page.get_text('dict', flags=0)['blocks']
             for line in block.get('lines', []) if line['dir'][0] > .99]
    dividers = [box for box,text in lines if letters(text) == 'furtherreading']
    if len(dividers) != 1:
        raise ValueError(f'Check the divider on printed page {pages[-1]}')
    boundary = dividers[0][1]
    def column(above):
        return letters(' '.join(text for box,text in sorted(lines,key=lambda x:(x[0][1],x[0][0]))
                                if box[0]>page.rect.width*.47 and (box[1]<boundary)==above))
    prose, refs = column(True), column(False)
    matches = []
    for i in range(heading+1,len(blocks)):
        block = blocks[i]
        if re.search(r'<a id="p\d+"',block) or 'Israeli context' in block:
            break
        text = letters(block)
        if not text:
            continue
        # Compare the full paragraph in small pieces to tolerate soft hyphens,
        # superscripts, inset tables, and editorial links in a previously built file.
        pieces = [text[j:j+16] for j in range(0,len(text),16)]
        fraction = sum(s in prose for s in pieces)/len(pieces)
        if fraction>.75 and sum(s in refs for s in pieces)/len(pieces)<.5:
            matches.append(i)
    if not matches:
        return markdown
    start,end = matches[0],matches[-1]+1
    if matches != list(range(start,end)):
        raise ValueError(f'Ambiguous body/reference boundary on printed page {pages[-1]}')
    body = blocks[start:end]
    prefix = blocks[:heading]
    if not body[0].startswith('#') and not re.search(r'[.!?][”’")]*$',prefix[-1].rstrip()):
        prefix[-1] = prefix[-1].rstrip()+' '+body.pop(0).lstrip()
    bibliography = blocks[heading:start]
    remaining = blocks[end:]
    if remaining and re.match('[a-z]',remaining[0]) and not bibliography[-1].rstrip().endswith('.'):
        joiner = '' if bibliography[-1].endswith('-') else ' '
        bibliography[-1] += joiner+remaining.pop(0)
    return '\n\n'.join(prefix+body+bibliography+remaining)

if __name__ == '__main__':
    import pymupdf
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('destination',type=Path)
    parser.add_argument('--pdf',type=Path,required=True)
    args=parser.parse_args()
    with pymupdf.open(args.pdf) as pdf:
        result=order_tail(args.source.read_text(encoding='utf-8'),pdf)
    args.destination.write_text(result,encoding='utf-8',newline='\n')
