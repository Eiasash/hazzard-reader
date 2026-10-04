"""Rebuild navigation metadata from the checked alias catalog and built book text.

Run with Python 3 and Node (the reader's vendored marked is reused). This does not
edit chapters, questions, answers or highlight identities.
"""
import json
import re
import subprocess
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def text(self):
        return ''.join(c.text() if isinstance(c, Node) else c for c in self.children)

    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.walk()


class Tree(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.current)
        self.current.children.append(n)
        if tag not in {'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr'}:
            self.current = n
        elif tag == 'br':
            self.current.children.append(' ')

    def handle_endtag(self, tag):
        n = self.current
        while n.parent:
            if n.tag == tag:
                self.current = n.parent
                return
            n = n.parent

    def handle_data(self, text):
        self.current.children.append(text)


def plain(text):
    return re.sub(r'\s+', ' ', text).strip()


def norm(text):
    text = text.translate(str.maketrans('', '', 'ᵃᵇᶜᵈᵉᶠ'))
    return re.sub(r'[‐‑–—−]', '-', unicodedata.normalize('NFKC', text)).casefold()


def pattern(terms):
    # Full terms, not suffixes: morphine must not match hydromorphone.
    # Hebrew exam text sometimes touches an English name without a space. Latin
    # letters/digits delimit names; a Hebrew prefix/suffix is not part of the drug.
    return re.compile(r'(?<![a-z0-9_])(?<!non-)(?<!non )(?:' + '|'.join(re.escape(norm(t)) for t in sorted(terms, key=len, reverse=True)) + r')(?![a-z0-9_])')


def corpus():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['chapters']
    entries = [e for e in manifest if re.fullmatch(r'\d+s?', e['number'])]
    rendered = json.loads(subprocess.run(['node', '-e', "const fs=require('fs'),m=require('./js/marked.min.js');const a=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(a.map(x=>m.parse(x))));"],
        input=json.dumps([(ROOT / 'chapters' / e['file']).read_text(encoding='utf-8') for e in entries]),
        cwd=ROOT, text=True, encoding='utf-8', capture_output=True, check=True).stdout)
    shell = (ROOT / 'index.html').read_text(encoding='utf-8')
    out = []
    for entry, html in zip(entries, rendered):
        ch = entry['number']
        template = re.search(r'<template\b[^>]*id="chapter' + ch + r'Template"[^>]*>([\s\S]*?)</template>', shell)
        embedded = bool(template)
        if template:
            html = template[1]
        else:
            # The reader slugs the rendered heading markup before HTML entities
            # are decoded ("&amp;" therefore contributes "amp" to its ID).
            used_ids = set()
            def heading_id(match):
                level, inner = match[1], match[2]
                text = re.sub(r'<[^>]+>', '', inner)
                slug = re.sub(r'[^a-z0-9]+', '-', text.lower().strip()).strip('-') or 'section'
                unique, i = slug, 2
                while unique in used_ids:
                    unique, i = f'{slug}-{i}', i+1
                used_ids.add(unique)
                return f'<h{level} id="{unique}">{inner}</h{level}>'
            html = re.sub(r'<h([123])>([\s\S]*?)</h\1>', heading_id, html)
        root = Tree(html).root
        heading, anchor, stop = '', '', False
        for n in root.walk():
            if n.tag in {'h1', 'h2', 'h3', 'h4'}:
                heading = plain(n.text())
                if re.search(r'^(?:Drill\b|Self.test\b|References|Further Reading|Selected Readings|Selected References|Bibliography|Past.paper questions|.*(?:recall drill|exam questions|question drill)|\d+[- ]question)', heading, re.I):
                    stop = True
                if n.attrs.get('id'):
                    anchor = n.attrs['id']
            if n.tag == 'a' and re.fullmatch(r'p\d+', n.attrs.get('id', '')):
                anchor = n.attrs['id']
            if stop or not anchor or n.tag not in {'p', 'li', 'tr', 'h2', 'h3', 'h4'}:
                continue
            ancestors, a = [], n.parent
            while a:
                ancestors.append(a)
                a = a.parent
            if any(a.tag in {'blockquote', 'details', 'figure', 'figcaption'} or 'note' in a.attrs.get('class', '').split() or a.attrs.get('data-reader-metadata') for a in ancestors):
                continue
            if n.tag == 'li':
                # Keep a drug's own label above its nested table-detail list.
                text = plain(''.join(c.text() if isinstance(c, Node) else c for c in n.children if not isinstance(c, Node) or c.tag not in {'ul', 'ol'}))
            else:
                text = plain(n.text())
            if len(text) < 4 or re.search(r'^(?:Table|Figure) \d', text) and len(text) < 45:
                continue
            # A page marker inside a paragraph takes precedence for that block.
            pages = [c.attrs['id'] for c in n.walk() if c.tag == 'a' and re.fullmatch(r'p\d+', c.attrs.get('id', ''))]
            out.append({'chapter': ch, 'kind': entry['kind'], 'anchor': pages[0] if pages else anchor,
                        'section': heading, 'text': text, 'source': 'index.html' if embedded else 'chapters/' + entry['file']})
    return out


def build():
    catalog = json.loads((ROOT / 'data/drug-aliases.json').read_text(encoding='utf-8'))
    blocks = corpus()
    # These are name/class-column transcriptions checked against the built crops.
    # They add discoverability without rewriting chapter content or table images.
    blocks.extend(catalog.get('tables', []))
    normalized = [(b, norm(b['text'])) for b in blocks]
    questions = json.loads((ROOT / 'data/mcq/all.json').read_text(encoding='utf-8'))
    records = []
    for item in catalog['entries']:
        terms = [item['name'], *item.get('aliases', [])]
        rx = pattern(terms)
        matches = [b for b, text in normalized if rx.search(text)]
        if not matches:
            raise ValueError('No built-source occurrence: ' + item['name'])
        links = {}
        for b in matches:
            key = (b['chapter'], b['anchor'])
            m = rx.search(norm(b['text']))
            start, end = max(0, m.start()-55), min(len(b['text']), m.end()+115)
            link = {k: b[k] for k in ['chapter', 'kind', 'anchor', 'section']}
            if b['source'].endswith('.png'):
                link['image'] = b['source']
            link['excerpt'] = ('…' if start else '') + b['text'][start:end] + ('…' if end < len(b['text']) else '')
            links.setdefault(key, link)
        evidence = []
        for source in item.get('sources', []):
            found = [b for b in blocks if b['chapter'] == source['chapter'] and norm(source['quote']) in norm(b['text'])]
            if not found:
                raise ValueError('Source quote not found: ' + item['name'] + ' ' + str(source))
            b = found[0]
            evidence.append({**source, 'anchor': b['anchor'], **({'image': b['source']} if b['source'].endswith('.png') else {})})
        qlinks = []
        for q in questions:
            if q['kind'] != 'past':
                continue
            if q['id'] in {e['id'] for e in item.get('questionExclusions', [])}:
                continue
            stem = rx.search(norm(q['q']))
            # All-answer/void appeals don't turn distractors into drug evidence.
            accepted = q.get('accepted', [q['c']])
            valid_key = q.get('mockEligible', True) and 0 < len(accepted) < len(q['o'])
            options = [i for i in accepted if valid_key and rx.search(norm(q['o'][i]))]
            if stem or options:
                qlinks.append({'id': q['id'], 'sitting': q['t'].replace('-Subspec', ''), 'number': q['examNumber'],
                               'match': 'stem' if stem else 'keyed option', 'terms': sorted({m.group() for t in ([q['q']] if stem else [q['o'][i] for i in options]) for m in rx.finditer(norm(t))})})
        records.append({'id': re.sub(r'[^a-z0-9]+', '-', norm(item['name'])).strip('-'),
                        'name': item['name'], 'kind': item.get('kind', 'drug'), 'class': item['class'],
                        'aliases': item.get('aliases', []), 'sources': evidence,
                        'passages': sorted(links.values(), key=lambda b: (int(b['chapter'].rstrip('s')), b['kind'] == 'study', b['anchor'])),
                        'questions': sorted(qlinks, key=lambda q: (q['sitting'], q['number']))})
    records.sort(key=lambda e: norm(e['name']).replace('α', 'alpha').replace('β', 'beta'))
    output = {'version': 1, 'edition': 'Hazzard 8e', 'scope': catalog['scope'],
              'counts': {'drugs': sum(e['kind']=='drug' for e in records), 'classes': sum(e['kind']=='class' for e in records),
                         'passages': sum(len(e['passages']) for e in records), 'questions': sum(len(e['questions']) for e in records)}, 'entries': records}
    (ROOT / 'data/drug-index.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(output['counts']))
    return output


if __name__ == '__main__':
    build()
