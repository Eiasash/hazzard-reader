"""Write a release report whose first line identifies the actual open pull request."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def status_line(repo, branch, tested_head, hold=None):
    if hold:
        return 'HOLD ' + ' '.join(hold.split())
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', branch, '--json', 'number,headRefOid,headRefName,baseRefName,state,isDraft'],
            cwd=repo, capture_output=True, text=True, encoding='utf-8', check=True,
        )
        pr = json.loads(result.stdout)
        if pr['state'] != 'OPEN' or pr['isDraft'] or pr['baseRefName'] != 'main' or pr['headRefName'] != branch:
            return 'HOLD The release branch has no ready, open PR against main.'
        head = pr['headRefOid']
        if not re.fullmatch(r'[a-f0-9]{40}', head) or head != tested_head:
            return 'HOLD The PR head differs from the commit used for release verification.'
        if not isinstance(pr['number'], int) or pr['number'] < 1:
            return 'HOLD GitHub returned an invalid PR number.'
        return f"READY PR #{pr['number']} head {head}"
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
        return f'HOLD Could not identify the release PR on GitHub ({type(exc).__name__}).'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--branch', required=True)
    parser.add_argument('--tested-head', required=True)
    parser.add_argument('--hold', help='Specific reason the release cannot be marked ready')
    parser.add_argument('--body', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.hold is not None and not args.hold.strip():
        parser.error('--hold must include a reason')
    first = status_line(args.repo, args.branch, args.tested_head, args.hold)
    body = args.body.read_text(encoding='utf-8').lstrip()
    if re.match(r'^(?:READY|HOLD)(?:[ \t]|\n|$)', body):
        body = body.partition('\n')[2].lstrip('\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=args.output.parent, delete=False) as tmp:
        tmp.write(first + '\n\n' + body.rstrip() + '\n')
    os.replace(tmp.name, args.output)
    print(first, flush=True)
    return 0 if first.startswith('READY PR #') else 1


if __name__ == '__main__':
    raise SystemExit(main())
