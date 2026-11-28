"""Rebuild navigation metadata from the checked alias catalog and built book text.

Run with Python 3 and Node (the reader's vendored marked is reused). This does not
edit chapters, questions, answers or highlight identities.
"""
from collections import defaultdict
from difflib import SequenceMatcher
import argparse
from hashlib import blake2s,sha256
from bisect import bisect_right
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



PAGE_ANCHOR = re.compile(r'p(\d+)$')
PAGE_REFS = re.compile(r'\b(?:pp?\.?|pages?)\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?((?:\s*,\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?)*)', re.I)
EDITOR_NOTE = re.compile(r'⟨[^⟩]*⟩|\[(?:sic\b|editor(?:ial)? note\b|reader note\b)[^\]]*\]', re.I)
PAGE_LABEL = re.compile(r'\[\s*p(?:age)?\.?\s*\d+\s*\]', re.I)
SKIP_SECTION = re.compile(r'^(?:References and source notes|What the exams asked|Exam-cited book images|Sources and scope)\s*$', re.I)
BIBLIOGRAPHY = re.compile(r'^(?:Further Reading|References|Selected Readings|Selected References|Bibliography)\s*$',re.I)
EXAM_ADDENDUM = re.compile(r'^(?:20\d\d\s+exam\b|(?:exam(?:ination)?|past.paper)[ -](?:questions?|items?|pearls?|links?|references?|notes?)\b|related exam(?:ination)? teaching|chapter method\b|audit trail|source notes)',re.I)
SKIP_START = re.compile(r'^(?:Current practice \(not the book\)|Status[.:]|Source and method[.:]|Lane.reviewed|Fast build from|Reader summary [—-]|Source audit[.:]|Not verified[.:]|Reconstructed from|Verify against|Study summary of Chapter|Chapter \d+ Study:)', re.I)
BLOCKS = {'p','li','tr','h1','h2','h3','h4','h5','h6','figcaption','caption','summary','dt','dd'}
HEADINGS = {'h1','h2','h3','h4','h5','h6'}


def plain(value):
    return re.sub(r'\s+', ' ', value).strip()


def clean(value):
    return plain(PAGE_LABEL.sub(' ', EDITOR_NOTE.sub(' ', value)))


def bank_text(value):
    value=re.sub(r'\[([^\]]+)]\((?:https?://|\?)[^)]*\)',r'\1',value)
    value=re.sub(r'https?://\S+',' ',value)
    value=re.sub(r'</?[A-Za-z][\w:-]*(?:\s[^<>]*?)?\s*/?>',' ',value)
    return plain(re.sub(r'\*{1,2}','',value))


def norm(value):
    value=value.translate(str.maketrans('', '', 'ᵃᵇᶜᵈᵉᶠ'))
    return unicodedata.normalize('NFKC', value).translate(str.maketrans('‐‑–—−','     ')).casefold().replace('-',' ')


def folded(value):
    """Character projection for excerpts, including NFKC expansions and Greek names."""
    text, indexes = [], []
    for i, char in enumerate(value):
        normalized = norm(char)
        text.append(normalized)
        indexes.extend([i]*len(normalized))
    return ''.join(text), indexes + [len(value)]


def word(char):
    return char == '_' or char.isalnum() or unicodedata.category(char).startswith('M')


def adjoining_word(edge, char):
    # Hebrew conjunctions/prepositions can touch a Latin drug name in the bank.
    if '\u0590' <= edge <= '\u05ff' and char.isascii():
        return False
    return word(edge)


def drug_sense(identity,term,text,start,end,page=None,context=''):
    # These same abbreviations denote a diagnostic test or professional
    # society on real Hazzard pages. Require the pharmacologic sense.
    if identity=='mineralocorticoid-receptor-antagonists' and term in ('mra','mras'):
        nearby=text[max(0,start-100):end+100]
        if re.search(r'angiogra|angiogram|magnetic resonance|\bcta\b|\bmri\b|doppler|duplex|vasculature|stenosis',nearby):
            return False
        return bool(re.search(r'mineralocorticoid|aldosterone|spironolactone|eplerenone|finerenone|heart failure|diuretic|\b(?:arni|acei|arbs?|hfpef|hfref)\b|אי ספיקת לב|ספירונולקטון',text+' '+context) or page in {1181,1182,1187,1188})
    if identity=='inhaled-corticosteroid' and term=='ics':
        nearby=text[max(0,start-100):end+100]
        if re.search(r'continence|cough stress test|\burolog|urodynamic',nearby):
            return False
        return bool(re.search(r'inhal|corticosteroid|bronchodilat|asthma|copd|\b(?:saba|laba|lama)\b|אסתמה|משאף',text+' '+context) or page is not None and 1246<=page<=1254)
    return True


def forms(term, is_class):
    base = norm(plain(term))
    forms = {base}
    if is_class:
        # Only inflect the last noun in an evidenced class. Never stem drug names.
        if re.search(r'(?:inhibitor|blocker|agonist|antagonist|antibiotic|opioid|antidepressant|antipsychotic|benzodiazepine|diuretic|bisphosphonate|statin|sulfonylurea|agent|corticosteroid|nsaid|ssri|snri|tca|arb|acei|glitazone|incretin|fibrate|drug|hypnotic|precursor|releaser|gabapentinoid|biguanide|thiazolidinedione|meglitinide|sequestrant|laxative|secretagogue|antimalarial|antiviral|relaxant|narcotic|antiplatelet|macrolide|glucocorticoid|anesthetic|antihistamine|anticonvulsant|fluoroquinolone|cephalosporin|penicillin|analog|muscarinic)s?$',base):
            forms.add(base[:-1] if base.endswith('s') else base+'s')
    for value in tuple(forms):
        for glyph, name in [('α','alpha'),('β','beta')]:
            if glyph in value:
                forms.add(value.replace(glyph,name))
            if name in value:
                forms.add(value.replace(name,glyph))
    # norm() treats equivalent hyphen and space typography consistently.
    # Digit-bearing class names also occur solid, as in SGLT2 inhibitors.
    for value in tuple(forms):
        if is_class:
            forms.add(re.sub(r'(?<=[a-zαβ]) (?=\d)','',value))
    return {norm(v) for v in forms}


class Names:
    """A trie finds all overlapping complete names in a passage in one scan."""
    def __init__(self):
        self.root = {}
        self.brand_terms=defaultdict(set)

    def add(self, term, identity):
        if not term:
            return
        node = self.root
        for char in term:
            node = node.setdefault(char, {})
        node.setdefault('',set()).add(identity)

    def matches(self, text, page=None, context=''):
        hits = defaultdict(list)
        for start, char in enumerate(text):
            node = self.root.get(char)
            if not node or start and adjoining_word(text[start-1],char):
                continue
            if text[max(0,start-4):start] in ('non-','non '):
                continue
            end = start+1
            while node is not None:
                if '' in node and (end==len(text) or not adjoining_word(text[end],text[end-1])):
                    for identity in node['']:
                        if drug_sense(identity,text[start:end],text,start,end,page,context):
                            hits[identity].append((start,end))
                if end==len(text):
                    break
                node = node.get(text[end])
                end += 1
        # Registered brand families can contain both a single active
        # ingredient and distinct combination products (e.g. BASE / BASE PLUS).
        # Do not attribute the shorter trade name inside that longer product
        # to a different formulation. Literal generic mentions remain valid.
        if len(hits)>1:
            brands=[(owner,a,b) for owner,spans in hits.items() for a,b in spans
                    if text[a:b] in self.brand_terms.get(owner,())]
            if len(brands)>1:
                for owner,a,b in brands:
                    if any(other!=owner and left<=a and b<=right and right-left>b-a for other,left,right in brands):
                        hits[owner].remove((a,b))
                hits={owner:spans for owner,spans in hits.items() if spans}
        return hits


def printed_refs(text):
    result=set()
    for m in PAGE_REFS.finditer(text):
        specs=[(m[1],m[2])] + re.findall(r',\s*(\d+)(?:\s*[-–—]\s*(\d+))?',m[3])
        for a,b in specs:
            left,right=int(a),int(b or a)
            if left <= right < left+100:
                result.update(range(left,right+1))
    return result


def rendered_chapters():
    entries = [e for e in json.loads((ROOT/'manifest.json').read_bytes())['chapters']
               if re.fullmatch(r'\d+s?', e['number'])]
    texts = [(ROOT/'chapters'/e['file']).read_text(encoding='utf-8') for e in entries]
    script = "const fs=require('fs'),m=require('./js/marked.min.js');process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(x=>m.parse(x))));"
    rendered = json.loads(subprocess.run(['node','-e',script],cwd=ROOT,input=json.dumps(texts),capture_output=True,text=True,encoding='utf-8',check=True).stdout)
    shell = (ROOT/'index.html').read_text(encoding='utf-8')
    embedded = dict(re.findall(r'<template\b[^>]*id="chapter(\d+)Template"[^>]*>([\s\S]*?)</template>',shell))
    opening = re.search(r'<article\b[^>]*\bid="copy"[^>]*\bdata-chapter-id="46"[^>]*>([\s\S]*?)</article>',shell)
    if opening:
        embedded['46']=opening[1]
    for entry, html in zip(entries, rendered):
        chapter=entry['number']
        if chapter in embedded:
            yield entry, embedded[chapter]
            continue
        used=set()
        def heading(m):
            slug=re.sub(r'[^a-z0-9]+','-',re.sub(r'<[^>]+>','',m[2]).lower()).strip('-') or 'section'
            name=slug;i=2
            while name in used:
                name=f'{slug}-{i}';i+=1
            used.add(name)
            return f'<h{m[1]} id="{name}">{m[2]}</h{m[1]}>'
        yield entry,re.sub(r'<h([123])>([\s\S]*?)</h\1>',heading,html)


def blocks_for(entry,html,bounds,anchors=None):
    """Walk source order. A page break inside a paragraph changes only later words."""
    ch = entry['number']
    study = ch.endswith('s')
    start, end = bounds[ch.rstrip('s')]
    page = None if study else start
    heading, anchor = entry['title'], 'copy'
    stopped = bibliography = 0
    pieces = []
    owner = None
    output = []

    def flush():
        if pieces:
            joined=''.join(pieces)
            raw=plain(joined.replace('\x1f',' '))
            cells=[s for part in joined.split('\x1f') if (s:=clean(part))]
            pieces.clear()
            text = ' '.join(cells)
            if text and not SKIP_START.search(text) and not re.fullmatch(r'(?:Answer|Show answer|\d+\.)',text,re.I):
                output.append({'chapter':ch,'kind':'study' if study else 'chapter','anchor':anchor if study else 'p'+str(page),
                               'section':heading,'page':page,'text':text,'raw':raw,'ordinal':len(output),
                               'termText':'\x1f'.join(cells),
                               'sourceType':'bibliography' if bibliography else 'prose','searchable':owner is not None and owner.tag!='tr' and not any(c is not owner and c.tag in {'p','li','td','th','details','h1','h2','h3','h4'} for c in owner.walk())})

    def visit(node, block=None):
        nonlocal owner,page,heading,anchor,stopped,bibliography
        if not isinstance(node,Node):
            if block is not None and not stopped:
                if owner is not block:
                    flush();owner=block
                pieces.append(node)
            return
        attrs=node.attrs
        marker=PAGE_ANCHOR.fullmatch(attrs.get('id',''))
        if marker and not study:
            flush()
            candidate=int(marker[1])
            if start<=candidate<=end:
                page=candidate
        if attrs.get('data-reader-metadata') or node.tag in {'script','style','template','button'}:
            return
        if node.tag in {'blockquote','div'} and (node.tag=='blockquote' or 'note' in attrs.get('class','').split()):
            # Notes in the reader are editorial; the source text stays separate.
            return
        if node.tag in HEADINGS:
            flush()
            level=int(node.tag[1])
            if stopped and level<=stopped:
                stopped=0
            if bibliography and level<=bibliography:
                bibliography=0
            heading=clean(node.text())
            if SKIP_SECTION.fullmatch(heading) or (not study and EXAM_ADDENDUM.search(heading)):
                stopped=level
            if BIBLIOGRAPHY.fullmatch(heading):
                bibliography=level
            if attrs.get('id'):
                anchor=attrs['id']
        if node.tag in BLOCKS and (block is None or block.tag!='tr'):
            flush();block=node
        if node.tag in {'td','th'}:
            pieces.append('\x1f')
        for child in node.children:
            visit(child,block)
        if node is block:
            flush();owner=None

    root=Tree(html).root
    visit(root);flush()
    # Some printed chapter-end pages contain only references and have no anchor.
    page_anchors={n.attrs['id'] for n in root.walk() if PAGE_ANCHOR.fullmatch(n.attrs.get('id',''))}
    if anchors is not None and not study:
        for name in page_anchors:
            anchors[(ch,int(name[1:]))]=name
    headings={n.attrs['id'] for n in root.walk() if n.attrs.get('id')}
    for b in output:
        if b['anchor'] not in (headings if study else page_anchors):
            b['anchor']='copy' if study else ''
    return output


def corpus(anchors=None):
    toc=json.loads((ROOT/'data/mcq/hazzard8e-toc.json').read_bytes())['chapters']
    bounds={r['chapter']:(r['start'],r['end']) for r in toc}
    blocks=[]
    for entry,html in rendered_chapters():
        blocks.extend(blocks_for(entry,html,bounds,anchors))
    return blocks


def snippet(text,hit,limit=210):
    """Keep complete sentences where practical, otherwise clip between tokens."""
    start,end=hit
    def whole_reference(left,right):
        for citation in PAGE_REFS.finditer(text):
            if citation.start()<left<citation.end():
                left=citation.start()
                if left and text[left-1] in '([':
                    left-=1
            if citation.start()<right<citation.end():
                right=citation.end()
                if right<len(text) and text[right] in ')]':
                    right+=1
        return text[left:right].strip()
    sentences=list(re.finditer(r'(?<=[.!?])\s+(?=[A-Zא-ת0-9])',text))
    boundaries=[0]+[m.end() for m in sentences if not re.search(r'\b(?:p|pp|fig|table|e\.g|i\.e)\.$',text[:m.start()],re.I)]+[len(text)]
    index=max(0,bisect_right(boundaries,start)-1)
    a,b=boundaries[index],boundaries[min(index+1,len(boundaries)-1)]
    if b-a<=limit and end<=b:
        return whole_reference(a,b)
    tokens=list(re.finditer(r'(?:\b(?:pages?|pp?\.?)\s*\d+(?:\s*[-–—,]\s*\d+)*)|(?:\S+)',text,re.I))
    i=next((i for i,t in enumerate(tokens) if t.end()>start),0)
    j=next((j for j,t in enumerate(tokens[i:],i) if t.end()>=end),len(tokens)-1)
    while i and tokens[i].start()-tokens[i-1].start()+end-tokens[i].start()<=limit//2:
        i-=1
    while j+1<len(tokens) and tokens[j+1].end()-tokens[i].start()<=limit:
        j+=1
    return whole_reference(tokens[i].start(),tokens[j].end())


def sentence_excerpt(text,hit):
    """The complete source sentence containing the matched drug or class."""
    start,end=hit
    breaks=[0]
    for m in re.finditer(r'(?<=[.!?])\s+',text):
        prefix=text[max(0,m.start()-20):m.start()]
        if re.search(r'\b(?:p|pp|fig|eq|vol|vs|no|dr|mr|mrs|e\.g|i\.e|et al)\.$',prefix,re.I):
            continue
        breaks.append(m.end())
    left=breaks[bisect_right(breaks,start)-1]
    right=next((boundary for boundary in breaks if boundary>=end),len(text))
    return text[left:right].strip()


def complete_quote(text,start,end):
    """Expand a previously clipped evidence quote to contain whole tokens."""
    while start and not text[start-1].isspace():
        start-=1
    while end<len(text) and not text[end].isspace():
        end+=1
    for match in PAGE_REFS.finditer(text):
        if match.start()<start<match.end():
            start=match.start()
        if match.start()<end<match.end():
            end=match.end()
    return text[start:end].strip()


def checked_quote(text,quote):
    # Project the match back to the displayed source. Punctuation,
    # discretionary hyphens and extracted table spacing may differ.
    raw, indexes=folded(text)
    needle=norm(clean(quote))
    offset=raw.find(needle)
    if offset>=0:
        return complete_quote(text,indexes[offset],indexes[offset+len(needle)])
    tokens=[(char,indexes[i]) for i,char in enumerate(raw) if word(char)]
    compact=''.join(char for char,_ in tokens)
    needle=''.join(c for c in needle if word(c))
    offset=compact.find(needle)
    if needle and offset>=0:
        return complete_quote(text,tokens[offset][1],tokens[offset+len(needle)-1][1]+1)
    return None


def rid(value):
    return re.sub(r'[^a-z0-9]+','-',norm(value)).strip('-')


def words(text):
    return set(re.findall(r'[a-zא-ת0-9]{3,}',norm(text))) - {'and','with','for','the','that','are','patients','may','when','from','has','have','older','chapter','book'}

def stable_key(block):
    material='\n'.join([block['chapter'],str(block['page']),block.get('termText',block['text'])])
    return blake2s(material.encode(),digest_size=10).hexdigest()


def brand_names(item):
    excluded={norm(t) for t in item.get('brandTextExclusions',[])}
    return [name for b in item.get('israeliBrands',[])
            for name in (b['name'],b.get('hebrewName'),*b.get('searchNames',[])) if name and norm(name) not in excluded]


def pdf_paragraphs(layout):
    # A native PDF "block" may consist of several table rows. Treat list
    # starts and separate cells as hard boundaries, while joining prose wraps.
    for block_no,block in enumerate(layout['blocks']):
        lines=[]
        for line in block.get('lines',[]):
            value=''.join(s['text'] for s in line['spans'] if not (s['flags']&1 and re.fullmatch(r'[a-f]',s['text'].strip())))
            if value.strip():
                lines.append((value,line['bbox']))
        simple_list=len(lines)>2 and all(re.fullmatch(r'\s*[A-Z][a-z]+\s*',v) for v,_ in lines)
        group=[]
        part=0
        previous=None
        for value,box in lines:
            new_item=bool(re.match(r'^(?:\s*[•▪]\s*|[\u2002\u2003]+ *\S)',value))
            different_cell=previous and abs(box[1]-previous[1])<2 and abs(box[0]-previous[0])>18
            if group and (simple_list or new_item or different_cell):
                yield f'{block_no}.{part}',group
                part+=1;group=[]
            group.append(value);previous=box
        if group:
            yield f'{block_no}.{part}',group


def display_quote(item,text):
    # A small number of checked tables attach an alphabetical footnote to
    # the generic name even in the PDF's text layer (e.g. Vildagliptina).
    for spelling in item.get('ocrAliases',[]):
        text=re.sub(r'(?<!\w)'+re.escape(spelling)+r'(?!\w)',item['name'],text,flags=re.I)
    return text


def quote_key(source):
    return blake2s(json.dumps([source['chapter'],source['page'],source['quote']],
                              ensure_ascii=False).encode(),digest_size=10).hexdigest()


def evidence_signature(entries,blocks):
    # Study prose and bank answers can change without invalidating book evidence.
    digest=blake2s()
    items=sorted((e['name'], e.get('kind','drug'), sorted(e.get('aliases',[])),
                  sorted(brand_names(e)),sorted(e.get('ocrAliases',[])),sorted(quote_key(s) for s in e.get('sources',[]) if s.get('printedOnly'))) for e in entries)
    digest.update(json.dumps(items,ensure_ascii=False).encode())
    for b in blocks:
        if b['kind']=='chapter':
            digest.update(stable_key(b).encode())
    return digest.hexdigest()


def comparison_terms(text):
    return re.findall(r'[^\W_]+',norm(text))


def affinity(text, other):
    a,b=comparison_terms(text),comparison_terms(other)
    if not a or not b:
        return 0,0
    matcher=SequenceMatcher(None,a,b,autojunk=False)
    length=max(group.size for group in matcher.get_matching_blocks())
    return length, matcher.ratio()


def printed_content(path,lexicon,entry_ids,toc,sources):
    import pymupdf
    pdf=pymupdf.open(path)
    if len(pdf)!=1824:
        raise ValueError('Use the marked 1,824-page Hazzard 8e PDF (printed page + 34)')
    output=defaultdict(list)
    checked_quotes={}
    requested=defaultdict(list)
    for source in sources:
        requested[(source['chapter'],source['page'])].append(source)
    for row in toc:
        ch=row['chapter']
        bibliography=False
        for page in range(row['start'],row['end']+1):
            physical=pdf[page+33]
            # Keep native text blocks separate. Joining adjacent table columns can
            # incorrectly associate a dose or class with an unrelated drug.
            layout=physical.get_text('dict',flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
            page_blocks=[]
            for block_no,lines in pdf_paragraphs(layout):
                raw='\n'.join(lines)
                text=clean(re.sub(r'(?<=\w)-\s*\n\s*(?=[a-z])','',raw.replace('\xad','')))
                if not text:
                    continue
                page_blocks.append(text)
                if any(BIBLIOGRAPHY.fullmatch(s.strip().rstrip('.:')) for s in lines):
                    bibliography=True
                normalized,indexes=folded(text)
                for identity,spans in lexicon.matches(normalized,page).items():
                    if identity not in entry_ids:
                        continue
                    # One source passage may name the same drug several times.
                    clips=[];sentences={}
                    for a,b in spans:
                        clip=snippet(text,(indexes[a],indexes[b]),180)
                        sentences[clip]=sentence_excerpt(text,(indexes[a],indexes[b]))
                        if clip not in clips:
                            clips.append(clip)
                    citation=bool(re.search(r'\b(?:19|20)\d\d;\s*\d+[\w()]*:\s*\d+',text))
                    output[identity].append({'chapter':ch,'page':page,'block':block_no,
                                             'type':'bibliography' if bibliography or citation else 'print-only','clips':clips,'sentences':sentences})
            if (ch,page) in requested:
                page_text=' '.join(page_blocks)
                for source in requested[(ch,page)]:
                    excerpt=checked_quote(page_text,source['quote'])
                    if excerpt:
                        checked_quotes[quote_key(source)]=excerpt
    pdf.close()
    return output,checked_quotes


def verify_printed(path, entries, blocks, lexicon, ids, toc):
    sources=[s for e in entries for s in e.get('sources',[]) if s.get('printedOnly')]
    physical,checked_quotes=printed_content(path,lexicon,ids,toc,sources)
    by_page=defaultdict(lambda:defaultdict(list))
    for identity, passages in physical.items():
        for p in passages:
            by_page[identity][p['page']].append(p)
    covered=set()
    deviations={}
    verbatim={}
    for b in blocks:
        if b['kind']!='chapter':
            continue
        normalized,indexes=folded(b.get('termText',b['text']))
        for identity,spans in lexicon.matches(normalized,b['page']).items():
            if identity not in ids:
                continue
            clips=[snippet(b['text'],(indexes[start],indexes[end]),180) for start,end in spans]
            def likely(page, adjacent):
                matched=[]
                for p in by_page[identity].get(page,[]):
                    if p['chapter']!=b['chapter']:
                        continue
                    best=max(affinity(c,other) for c in clips for other in p['clips'])
                    length,ratio=best
                    # An adjacent page needs more than a name in common. On the
                    # declared page accept a short table cell when identical.
                    short_exact=any(norm(c)==norm(other) for c in clips for other in p['clips'])
                    accepted=length>=(7 if adjacent else 5) or (length>=3 and ratio>=(.78 if adjacent else .55)) or (not adjacent and short_exact)
                    if accepted:
                        matched.append((best,p))
                return matched
            matches=likely(b['page'],False)
            if not matches and b.get('image'):
                # Catalogue table text was checked on this actual image. A
                # raster or damaged OCR layer can omit even a clearly legible name.
                continue
            if not matches:
                adjacent=[m for page in (b['page']-1,b['page']+1) for m in likely(page,True)]
                if adjacent:
                    best=max(m[0] for m in adjacent)
                    matches=[m for m in adjacent if m[0]==best]
                    if len({p['page'] for _,p in matches})!=1:
                        matches=[]
                deviations.setdefault(stable_key(b),{})[identity]=matches[0][1]['page'] if matches else None
            for _,p in matches:
                covered.add((identity,p['page'],p['block']))
            if matches:
                best=max(matches,key=lambda pair:pair[0])[1]
                display=max(best['clips'],key=lambda other:affinity(clips[0],other))
                # In the HTML the text may have been shortened or editorially
                # rewritten. Display the actual printed context in that case.
                if norm(clips[0]) != norm(display):
                    verbatim.setdefault(stable_key(b),{})[identity]=best['sentences'][display]
    supplements=defaultdict(dict)
    full_clips={}
    for identity,passages in physical.items():
        for p in passages:
            if (identity,p['page'],p['block']) in covered:
                continue
            for clip in p['clips']:
                if not clip:
                    continue
                bucket=supplements[(p['chapter'],p['page'],p['block'],p['type'])]
                bucket.setdefault(clip,set()).add(identity)
                full_clips[(p['chapter'],p['page'],p['block'],clip)]=p['sentences'][clip]
    rows=[]
    for (ch,page,block,kind),quotes in supplements.items():
        for text,matches in quotes.items():
            # A printed excerpt is limited to this passage. Store each once
            # even if it names several entries, and never ship the source PDF.
            rows.append({'chapter':ch,'page':page,'block':block,'type':kind,'text':text,'sentence':full_clips[(ch,page,block,text)],'entries':sorted(matches)})
    checked=sum(len(v) for v in physical.values())
    with Path(path).open('rb') as verified:
        digest=sha256()
        for chunk in iter(lambda:verified.read(1024*1024),b''):
            digest.update(chunk)
    return {'schema':1,'source':'Hazzard 8e, marked 1824-page copy (printed page + 34)',
            'sourceSha256':digest.hexdigest(),
            'signature':evidence_signature(entries,blocks),'checkedPdfEntryBlocks':checked,
            'coveredPdfEntryBlocks':len(covered),'deviations':deviations,'verbatim':verbatim,
            'supplemental':rows,'printedSourceQuotes':checked_quotes}


def checked_blocks(catalog,blocks,names,ids,book,anchors):
    path=ROOT/'data/drug-print-passages.json'
    if book:
        toc=json.loads((ROOT/'data/mcq/hazzard8e-toc.json').read_bytes())['chapters']
        result=verify_printed(book,catalog['entries'],blocks,names,ids,toc)
        path.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')
    result=json.loads(path.read_bytes())
    if result['signature']!=evidence_signature(catalog['entries'],blocks):
        raise ValueError('The book or checked names changed. Refresh printed evidence with --book before shipping the drug index.')
    for b in blocks:
        if b['kind']=='chapter':
            b['pageChanges']=result['deviations'].get(stable_key(b),{})
            b['printQuotes']=result['verbatim'].get(stable_key(b),{})
    for index,r in enumerate(result['supplemental']):
        ch,page=r['chapter'],r['page']
        found=set(names.matches(folded(r['text'])[0],page))
        if not set(r['entries']).issubset(found):
            raise ValueError(f'Printed excerpt lost a matched term on p{page}: {set(r["entries"])-found}')
        blocks.append({'chapter':ch,'kind':'chapter','section':'Further reading' if r['type']=='bibliography' else 'Printed passage',
                       'anchor':anchors.get((ch,page),''),'page':page,'text':r['text'],'raw':r['text'],
                       'ordinal':'print-'+str(index),'sourceType':r['type'],'sentence':r['sentence'],'verifiedEntries':set(r['entries'])})
    return result


def build(destination=None, audit=None, book=None):
    catalog=json.loads((ROOT/'data/drug-aliases.json').read_bytes())
    entries=catalog['entries']
    names=Names()
    ocr_only={}
    class_names={}
    ids=set()
    for item in entries:
        identity=rid(item['name'])
        if identity in ids:
            raise ValueError('Duplicate entry id: '+identity)
        ids.add(identity)
        is_class=item.get('kind')=='class'
        spellings=[item['name'],*item.get('aliases',[]),*brand_names(item)]
        terms=set().union(*(forms(t,is_class) for t in spellings))
        names.brand_terms[identity]={norm(t) for t in brand_names(item)}-{norm(item['name'])}
        for t in terms:
            names.add(t, identity)
            if is_class:
                class_names.setdefault(t,set()).add(identity)
        ocr_only[identity]={norm(t) for t in item.get('ocrAliases',[])}-terms
        for spelling in ocr_only[identity]:
            names.add(spelling,identity)

    members=defaultdict(set)
    for item in entries:
        if item.get('kind')=='class':
            continue
        identity=rid(item['name'])
        for label in item['class'].split(' / '):
            if norm(label).strip() in {'','medication','drug','drug class','unclassified'}:
                continue
            # Named ingredients contribute to their class page. Generic class
            # mentions are not evidence for any particular member drug.
            associated=set().union(*(class_names.get(t,set()) for t in forms(label,True)))
            if not associated:
                key='class:'+norm(label)
                for t in forms(label,True):
                    names.add(t,key)
                associated={key}
            for cls in associated:
                members[cls].add(identity)

    anchors={}
    blocks=corpus(anchors)
    by_chapter=defaultdict(list)
    for row in catalog.get('tables',[]):
        page=row.get('page') or int(PAGE_ANCHOR.fullmatch(row['anchor'])[1])
        blocks.append({'chapter':row['chapter'],'kind':'chapter','section':row['section'],
                       'anchor':row['anchor'],'page':page,'text':clean(row['text']),
                       'raw':row['text'],'image':row['source'],'ordinal':row['ordinal'],'sourceType':'table'})
    print_report=checked_blocks(catalog,blocks,names,ids,book,anchors)
    mentions=defaultdict(list)
    printed=defaultdict(lambda:defaultdict(list))
    for b in blocks:
        normalized,indexes=folded(b.get('termText',b['text']))
        b['normalized']=norm(b['text'])
        by_chapter[b['chapter']].append(b)
        matches=names.matches(normalized,b['page'])
        for identity,spans in matches.items():
            if identity not in ids:
                continue
            if 'verifiedEntries' in b and identity not in b['verifiedEntries']:
                continue
            changes=b.get('pageChanges',{})
            cited=b
            if identity in changes:
                page=changes[identity]
                if page is None:
                    continue
                cited={**b,'page':page,'anchor':anchors.get((b['chapter'],page),'')}
            if identity in b.get('printQuotes',{}):
                cited={**cited,'printQuote':b['printQuotes'][identity]}
            hits=[(indexes[start],indexes[end]) for start,end in spans]
            mentions[identity].append((cited,hits))
            if b['kind']=='chapter':
                printed[identity][cited['page']].append((cited,hits))

    bank=json.loads((ROOT/'data/mcq/all.json').read_bytes())
    classes_of=defaultdict(set)
    for cls,children in members.items():
        if cls in ids:
            for child in children:
                classes_of[child].add(cls)
    qlinks=defaultdict(list)
    active_bank={q['id']:q for q in bank if not q.get('retired')}
    for q in bank:
        if q.get('retired'):
            continue
        fields=[('stem',q['q']), *(('option',v) for v in q.get('o',[])), ('explanation',q.get('explanation',''))]
        context=norm(' '.join(bank_text(value) for _,value in fields))
        info=defaultdict(lambda:defaultdict(set))
        for field,value in fields:
            # Reference/page strings and markdown formatting have no bearing on a
            # whole-name match. Never inspect c or accepted when indexing options.
            value=norm(bank_text(value))
            for identity,spans in names.matches(value,context=context).items():
                terms={value[start:end] for start,end in spans}
                terms-=ocr_only.get(identity,set())
                if not terms:
                    continue
                if identity in ids:
                    info[identity]['direct'].update(terms)
                    info[identity]['fields'].add(field)
                for parent in classes_of.get(identity,()):
                    info[parent]['member'].update(terms)
                    info[parent]['fields'].add(field)
        for identity,evidence in info.items():
            official=q['kind']=='past'
            result={'id':q['id'],'kind':q['kind'],'label':str(q['t']).replace('-Subspec','')+' · Q'+str(q.get('examNumber')) if official else 'Practice · '+clean(bank_text(q['q'])),
                    'matchFields':sorted(evidence['fields']),'terms':sorted(evidence['direct']|evidence['member']),
                    'match':'name' if evidence['direct'] else 'member'}
            if official:
                result.update(sitting=q['t'].replace('-Subspec',''),number=q.get('examNumber'))
            if evidence['member']:
                result['memberTerms']=sorted(evidence['member'])
            qlinks[identity].append(result)

    records=[]
    omissions=defaultdict(list)
    evidence_errors=[]
    for item in entries:
        identity=rid(item['name'])
        passages=[]
        for b,spans in mentions[identity]:
            read=b;readspans=spans
            if b['kind']=='study':
                refs=printed_refs(b['text'])
                same_chapter=b['chapter'].rstrip('s')
                candidates=[v for page in refs for v in printed[identity].get(page,[])
                           if v[0].get('sourceType')!='bibliography' and (v[0]['chapter']==same_chapter or re.search(r'\bCh(?:apter)?\.?\s*'+v[0]['chapter']+r'\b',b['text'],re.I))]
                if not candidates and not refs:
                    # Recover a missing reference only from distinctive verbatim
                    # context including this entry's name, on one printed page.
                    probes=set()
                    for s,e in spans:
                        left=norm(b['text'][:s]).split()[-3:]
                        right=norm(b['text'][e:]).split()[:3]
                        if len(left)+len(right)>=5:
                            probes.add(' '.join([*left,norm(b['text'][s:e]),*right]))
                    for occurrences in printed[identity].values():
                        candidates.extend(v for v in occurrences if v[0]['chapter']==same_chapter and any(p in v[0]['normalized'] for p in probes))
                    if len({v[0]['page'] for v in candidates})!=1:
                        candidates=[]
                if not candidates:
                    omissions[identity].append({'chapter':b['chapter'],'refs':sorted(refs),'text':b['text']})
                    continue
                context=words(b['text'])
                read,readspans=max(candidates,key=lambda v:len(context.intersection(words(v[0]['text']))))
            s,e=readspans[0];excerpt=display_quote(item,read.get('printQuote') or read.get('sentence') or sentence_excerpt(read['text'],(s,e)))
            passage={'passageId':b['chapter']+'-'+str(b['ordinal']), 'chapter':b['chapter'],'kind':b['kind'],
                     'anchor':b['anchor'],'section':b['section'],'page':read['page'],'excerpt':excerpt}
            passage['sourceType']=read.get('sourceType','prose')
            if read.get('image'):
                passage['image']=read['image']
            if b is not read:
                passage.update(readChapter=read['chapter'],readAnchor=read['anchor'])
            # Search landings are only emitted for a contiguous substring of the
            # rendered passage. Keep exact text and offsets, including case.
            s,e=spans[0];selected=snippet(b['text'],(s,e))
            offset=b['text'].find(selected)
            if offset>=0 and offset<=s<e<=offset+len(selected) and selected in b['raw'] and b.get('searchable'):
                passage['target']={'q':b['text'][s:e],'offset':s-offset}
                if selected!=excerpt or b is not read:
                    passage['target']['excerpt']=selected
            passages.append(passage)

        sources=[]
        for source in item.get('sources',[]):
            if source.get('printedOnly'):
                verified=print_report.get('printedSourceQuotes',{}).get(quote_key(source))
                image=source.get('image') or source.get('source')
                if not verified and not (image and str(image).startswith('chapters/') and (ROOT/image).is_file()):
                    evidence_errors.append((item['name'],source['page'],source['quote'],'printed quote not verified'))
                    continue
                sources.append({'chapter':source['chapter'],'page':source['page'],'anchor':anchors.get((source['chapter'],source['page']),''),
                                'quote':display_quote(item,verified or clean(source['quote'])),**({'image':image} if image else {})})
                continue
            needle=norm(clean(source['quote']))
            found=[b for b in by_chapter[source['chapter']] if needle in b['normalized'] and b['kind']=='chapter']
            if source.get('page') is not None:
                found=[b for b in found if b['page']==source['page'] or b.get('pageChanges',{}).get(identity)==source['page']]
            if not found or (source.get('page') is None and len({b['page'] for b in found})!=1):
                evidence_errors.append((item['name'],source.get('page'),source['quote'],sorted({b['page'] for b in found})))
                continue
            b=found[0]
            page=source.get('page',b['page'])
            verified=checked_quote(b['text'],source['quote']) or clean(source['quote'])
            sources.append({'chapter':source['chapter'],'anchor':anchors.get((source['chapter'],page),''),'page':page,'quote':display_quote(item,verified),
                            **({'image':b['image']} if b.get('image') else {})})
        bank_sources=[]
        for source in item.get('bankSources',[]):
            q=active_bank.get(source['id'])
            if q is None:
                evidence_errors.append((item['name'], source['id'],'bank source','not active'))
                continue
            label=source['evidenceField'].lower()
            option=re.fullmatch(r'option\[(\d+)\]',label)
            if option:
                i=int(option[1])
                values=q['o'][i:i+1]
            else:
                values=[q['q']] if label in ('stem','q','question') else q['o'] if label in ('option','options','o') else [q.get('explanation','')] if label=='explanation' else []
            quote=clean(bank_text(source['quote']))
            if not quote or not any(norm(quote) in norm(bank_text(v)) for v in values) or identity not in names.matches(norm(quote)):
                evidence_errors.append((item['name'], source['id'],source['evidenceField'],'bank quote not found'))
                continue
            bank_sources.append({'id':q['id'],'evidenceField':source['evidenceField'],'quote':quote})
        if item.get('bankOnly') and not sources:
            published=next((p for p in passages if p['kind']=='chapter'),None)
            if published:
                sources.append({'chapter':published['chapter'],'page':published['page'],'anchor':published['anchor'],
                                'quote':published['excerpt'],**({'image':published['image']} if published.get('image') else {})})
        records.append({'id':identity,'name':item['name'],'kind':item.get('kind','drug'),'class':item['class'],
                        **({'classSource':item['classSource']} if 'classSource' in item else {}),
                        'aliases':item.get('aliases',[]),'israeliBrands':item.get('israeliBrands',[]),'sources':sources,
                        'bankOnly':bool(item.get('bankOnly') and not passages),'bankSources':bank_sources,
                        'passages':sorted(passages,key=lambda v:(int(v['chapter'].rstrip('s')),v['kind']=='study',v['page'])),
                        'questions':sorted(qlinks[identity],key=lambda v:(v['kind']!='past',v.get('sitting',''),v.get('number') or 0,v['id']))})
    if audit is not None:
        Path(audit).write_text(json.dumps({'omittedStudy':omissions,'sourceErrors':evidence_errors,'checkedPdfEntryBlocks':print_report['checkedPdfEntryBlocks'],'coveredPdfEntryBlocks':print_report['coveredPdfEntryBlocks']},ensure_ascii=False),encoding='utf-8')
    if evidence_errors and (destination is None or audit is None):
        raise ValueError(f'{len(evidence_errors)} missing or ambiguous printed name/class sources. First: {evidence_errors[:4]}')
    records.sort(key=lambda e:norm(e['name']).replace('α','alpha').replace('β','beta'))
    counts={'drugs':sum(r['kind']=='drug' for r in records),'classes':sum(r['kind']=='class' for r in records),
            'passages':sum(len(r['passages']) for r in records),'questions':sum(len(r['questions']) for r in records)}
    counts.update(bookPassages=sum(p['kind']=='chapter' for r in records for p in r['passages']),
                  studyPassages=sum(p['kind']=='study' for r in records for p in r['passages']),
                  uniqueQuestions=len({q['id'] for r in records for q in r['questions']}),
                  activeBank=sum(not q.get('retired') for q in bank))
    output={'version':2,'edition':'Hazzard 8e','scope':catalog['scope'],'counts':counts,'entries':records}
    path=Path(destination) if destination else ROOT/'data/drug-index.json'
    path.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')
    print(json.dumps(counts))
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--book',type=Path,help='Refresh the printed-page evidence using the local marked Hazzard 8e PDF.')
    parser.add_argument('--destination',type=Path,help='Write a separate index for private review.')
    parser.add_argument('--audit',type=Path,help='Write source exceptions and omitted Study items to a private report.')
    args=parser.parse_args()
    build(args.destination,args.audit,args.book)
