"""Generate small static search shards from the rendered book passages."""
from array import array
from collections import defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import base64
import unicodedata


COMMON = {"of", "the", "a", "in", "to", "and", "with", "for", "on", "or"}


def bucket(key):
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:2], "big") % 1024


def write(directory, name, obj):
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    (directory / name).write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))


def delta(values):
    result = bytearray()
    previous = 0
    for value in values:
        n = value - previous
        while n >= 128:
            result.append(128 | (n & 127))
            n >>= 7
        result.append(n)
        previous = value
    return base64.b64encode(result).decode("ascii")


def tokens(text):
    # Start of a Unicode word, matching the reader's word-start search rule.
    offsets = []
    symbols = []
    pending = []
    previous = False
    for index, char in enumerate(text):
        word = char == "_" or unicodedata.category(char)[0] in "LMN"
        if word and not previous:
            symbols.extend((text[start:index], len(offsets)) for start in pending)
            pending.clear()
            offsets.append(index)
        elif not word and not previous and not char.isspace():
            pending.append(index)
        previous = word
    symbols.extend((text[start:], len(offsets)) for start in pending)
    return [text[a:b] for a, b in zip(offsets, offsets[1:] + [len(text)])], symbols


def build(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    rows = []
    postings = defaultdict(lambda: array("I"))
    pairs = defaultdict(lambda: array("I"))
    punctuation = defaultdict(lambda: array("I"))
    bounds = {}
    for chapter, blocks in json.loads(source.read_text(encoding="utf-8")):
        bounds[str(chapter)] = [len(rows), len(rows) + len(blocks)]
        for block, text in enumerate(blocks):
            doc = len(rows)
            rows.append([chapter, block, text])
            previous = ""
            words, symbols = tokens(text.lower())
            for symbol, position in symbols:
                punctuation[symbol].append(doc * 65536 + position)
            for position, term in enumerate(words):
                if position >= 65536:
                    raise ValueError("Passage exceeds posting capacity")
                occurrence = doc * 65536 + position
                postings[term].append(occurrence)
                if previous and previous.rstrip() in COMMON:
                    pairs[(previous, term)].append(occurrence)
                previous = term
    for start in range(0, len(rows), 12):
        write(directory, f"text-{start // 12}.bin", rows[start:start + 12])
    docs, positions, short = defaultdict(dict), defaultdict(dict), defaultdict(set)
    short_positions = defaultdict(list)
    for term, occurrences in postings.items():
        page = bucket(term[:3])
        documents = sorted({n // 65536 for n in occurrences})
        docs[page][term] = delta(documents)
        positions[page][term] = delta(occurrences)
        for width in [1, 2]:
            if len(term) >= width:
                short[term[:width]].update(documents)
                short_positions[term[:width]].extend(occurrences)
    short_pos = defaultdict(dict)
    for prefix, ids in short.items():
        docs[bucket(prefix)]["\0" + prefix] = delta(sorted(ids))
        short_pos[bucket(prefix)]["\0" + prefix] = delta(sorted(short_positions[prefix]))
    symbols = defaultdict(dict)
    for term, values in punctuation.items():
        symbols[bucket(term[0]) % 64][term] = delta(values)
    for page in range(64):
        write(directory, f"symbol-{page}.bin", symbols.get(page, {}))
    contextual = defaultdict(dict)
    for (previous, term), values in pairs.items():
        for width in {min(3, len(term)), min(2, len(term)), 1}:
            key = previous + "|" + term[:width]
            contextual[bucket(key)].setdefault(key, {})[term] = delta(values)
    for name, shards in [("docs", docs), ("pos", positions), ("pair", contextual), ("short", short_pos)]:
        for page in range(1024):
            write(directory, f"{name}-{page}.bin", shards.get(page, {}))
    return bounds
