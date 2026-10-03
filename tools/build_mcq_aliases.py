"""Recover retired MCQ IDs from this repository's committed question history.

No fuzzy matching: use exact stem/options, or the official catalog's recorded
sitting/question identity (including its explicit duplicate source indexes).
Run from any directory; never reads the upstream bank or a personal backup.
"""
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# These historical texts contradict the catalog's duplicate-index link. Do not
# transfer an answer just because the source index was later reused/mislinked.
CONFLICTS = {
    'mcq-358cf8779eb64ab3646b3c13': 'Urinary urgency vs Parkinson hallucinations (index 309)',
    'mcq-9869aad627de52b1da833654': 'Thyroid/lithium vs REM sleep treatment (index 3079)',
    'mcq-70e6874d0b3709cf951bd3b5': 'Dialysis indications vs anticholinergic drugs (index 3137)',
}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def build():
    data = ROOT / 'data/mcq'
    current = json.loads((data / 'all.json').read_text(encoding='utf-8'))
    by_id = {q['id']: q for q in current}
    signature = lambda q: (q['q'], tuple(q['o']))
    exact, sitting = defaultdict(set), defaultdict(set)
    for q in current:
        exact[signature(q)].add(q['id'])
        if q.get('examNumber'):
            sitting[(q['t'].removesuffix('-Subspec'), q['examNumber'])].add(q['id'])
    catalog = json.loads((data / 'exam-catalog.json').read_text(encoding='utf-8'))['records']
    recorded = defaultdict(set)
    for index, row in catalog.items():
        for source_index in [int(index), *row.get('duplicates', [])]:
            recorded[source_index].add((row['sitting'], row['number']))

    # Read every distinct question-file blob, including v41's chapter-only bank.
    blobs = set()
    for rev in git('rev-list', 'HEAD', '--', 'data/mcq').decode().splitlines():
        for line in git('ls-tree', '-r', rev, 'data/mcq').decode().splitlines():
            meta, name = line.split('\t')
            if re.fullmatch(r'data/mcq/(?:all|law|\d+)\.json', name):
                blobs.add(meta.split()[2])
    proc = subprocess.run(['git', 'cat-file', '--batch'], cwd=ROOT,
                          input=('\n'.join(sorted(blobs)) + '\n').encode(), capture_output=True, check=True)
    pos, history = 0, defaultdict(dict)
    for _ in sorted(blobs):
        end = proc.stdout.index(b'\n', pos)
        blob, _, size = proc.stdout[pos:end].decode().split()
        pos = end + 1
        questions = json.loads(proc.stdout[pos:pos + int(size)])
        pos += int(size) + 1
        for q in questions:
            if q['id'] not in by_id:
                identity = (q['sourceIndex'], q['t'], signature(q), q.get('examNumber'))
                history[q['id']][identity] = (q, blob)

    aliases, evidence, unmatched = {}, {}, {}
    for old_id, versions in sorted(history.items()):
        if old_id in CONFLICTS:
            unmatched[old_id] = {'reason': 'Conflicting catalog duplicate link: ' + CONFLICTS[old_id]}
            continue
        targets, proofs = set(), []
        for q, blob in versions.values():
            exam = re.sub(r'-(?:Basic|Subspec)$', '', q['t'])
            identities = {pair for pair in recorded[q['sourceIndex']] if pair[0] == exam}
            if q.get('examNumber'):
                identities.add((exam, q['examNumber']))
            matches = set().union(*(sitting[pair] for pair in identities)) if identities else set()
            method = 'recorded sitting/question'
            if not matches:
                matches = exact[signature(q)]
                method = 'identical stem and ordered options'
            targets.update(matches)
            if matches:
                proofs.append({'blob': blob, 'sourceIndex': q['sourceIndex'], 'method': method,
                               'sittingQuestions': sorted(identities), 'targets': sorted(matches)})
        if len(targets) == 1:
            aliases[old_id] = targets.pop()
            evidence[old_id] = proofs
        else:
            q = next(iter(versions.values()))[0]
            unmatched[old_id] = {'sourceIndex': q['sourceIndex'], 'source': q['t'],
                                 'reason': 'Ambiguous identity' if targets else 'No exact content or recorded sitting/question match in current catalog'}
    (data / 'id-aliases.json').write_text(json.dumps(aliases, indent=2) + '\n', encoding='utf-8')
    return aliases, evidence, unmatched


if __name__ == '__main__':
    aliases, _, unmatched = build()
    print(f'{len(aliases)} verified aliases; {len(unmatched)} retired IDs left untouched')
