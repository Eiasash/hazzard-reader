"""Independently verify every bolded, page-cited number in each study page against its source
chapter. Does NOT trust the writer agents' self-reported verification.

Fixed 23-24 Sep 2026: the previous version scoped each bolded span's citation-search window to
"up to the NEXT ** marker", which meant that on a line with more than one bolded number sharing
one trailing citation -- e.g. "**11.5%**... but **47%** in adults (p1278)" -- every bold EXCEPT
the last was silently skipped (its window was cut off by the next `**` before ever reaching the
"(p1278)"). Proven with an injected-defect fixture before trusting this fix (see
test_verify_study_pages_fix.py): swap a correct earlier-in-line number for a wrong one and require
the checker to flag it, which the old version did not.

Fix: citation-search is now per LINE, not per "gap between bold markers". Every bolded number span
on a line looks forward to the NEAREST following (p123) citation anywhere later on that same line
(not stopped by an intervening ** marker) -- so multiple bolds sharing one trailing citation are
all now checked, while a line with more than one citation still assigns each bold to its own
nearest-following one, not an earlier claim's citation.

Widened 24 Sep 2026: CITE_RE was a bare "(pNNN)" only. A scan of all 32 study pages found 207
citations in other styles -- "(pNNN, Table X)", "(Table X, pNNN)", "(pNNN-NNN)" page ranges,
"(pNNN, image)", multi-page "(pNNN, pNNN)", and a few freeform asides with more than one page
number -- none of which the old CITE_RE matched, so every bolded number attached to one of these
was silently skipped: not checked, not flagged as a miss, a NOT-RUN folded into a clean result
(this is exactly how ch77's and ch99's misattributions happened in the first place). CITE_GROUP_RE
now matches any parenthetical containing at least one "pNNN" (excluding a leading "#", which is a
markdown link-anchor target like "[p. 695](#p695)" in a Drill question header, not a citation).
extract_pages() pulls every page number out of that group's content, expanding a "pNNN-MMM" or
"pNNN-pMMM" range to every integer in between (all observed ranges are 2-3 pages) and picking up
every other bare "pNNN" in the same parens, so "(pNNN, image)", "(Table X, pNNN)" and multi-page
"(p894, p897)" are all read correctly regardless of where the page number sits or what else share
the parens with it. Proven with an injected-defect fixture (test_verify_fix.py) before trusting it,
the same way as the per-line fix above: a wrong number under each of the three new citation styles
must be caught, and a correct one under each style must not be flagged.
"""
import re, os, sys, json

REPO = os.environ.get("HAZZARD_CHAPTERS") or (r"C:\Users\eiasa\repos\hazzard-reader\chapters" if os.name == "nt" else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chapters"))

CHAPTERS = [
    ("42", "hazzard8e_ch42_frailty.md", "hazzard8e_ch42_study.md"),
    ("43", "hazzard8e_ch43_falls.md", "hazzard8e_ch43_study.md"),
    ("44", "hazzard8e_ch44_sleep_disorders.md", "hazzard8e_ch44_study.md"),
    ("45", "hazzard8e_ch45_syncope_and_dizziness.md", "hazzard8e_ch45_study.md"),
    ("46", "hazzard8e_ch46_pressure_injuries.md", "hazzard8e_ch46_study.md"),
    ("47", "hazzard8e_ch47_incontinence.md", "hazzard8e_ch47_study.md"),
    ("51", "hazzard8e_ch51_osteoporosis.md", "hazzard8e_ch51_study.md"),
    ("52", "hazzard8e_ch52_osteoarthritis.md", "hazzard8e_ch52_study.md"),
    ("55", "hazzard8e_ch55_rehabilitation.md", "hazzard8e_ch55_study.md"),
    ("57", "hazzard8e_ch57_cognitive_changes_in_aging.md", "hazzard8e_ch57_study.md"),
    ("58", "hazzard8e_ch58_delirium.md", "hazzard8e_ch58_study.md"),
    ("59", "hazzard8e_ch59_dementia_including_alzheimer_disease.md", "hazzard8e_ch59_study.md"),
    ("60", "hazzard8e_ch60_bpsd_psychoactive.md", "hazzard8e_ch60_study.md"),
    ("61", "hazzard8e_ch61_parkinson.md", "hazzard8e_ch61_study.md"),
    ("63", "hazzard8e_ch63_other_neurodegenerative_disorders.md", "hazzard8e_ch63_study.md"),
    ("65", "hazzard8e_ch65_major_depression.md", "hazzard8e_ch65_study.md"),
    ("68", "hazzard8e_ch68_pain_management.md", "hazzard8e_ch68_study.md"),
    ("75", "hazzard8e_ch75_valvular_heart_disease.md", "hazzard8e_ch75_study.md"),
    ("76", "hazzard8e_ch76_heart_failure.md", "hazzard8e_ch76_study.md"),
    ("77", "hazzard8e_ch77_cardiac_arrhythmias.md", "hazzard8e_ch77_study.md"),
    ("81", "hazzard8e_ch81_copd.md", "hazzard8e_ch81_study.md"),
    ("83", "hazzard8e_ch83_kidney_diseases.md", "hazzard8e_ch83_study.md"),
    ("87", "hazzard8e_ch87_constipation.md", "hazzard8e_ch87_study.md"),
    ("88", "hazzard8e_ch88_cancer_and_aging_general_principles.md", "hazzard8e_ch88_study.md"),
    ("97", "hazzard8e_ch97_endocrine_non_thyroid.md", "hazzard8e_ch97_study.md"),
    ("98", "hazzard8e_ch98_thyroid_diseases.md", "hazzard8e_ch98_study.md"),
    ("99", "hazzard8e_ch99_diabetes.md", "hazzard8e_ch99_study.md"),
    ("101", "hazzard8e_ch101_ra_autoimmune.md", "hazzard8e_ch101_study.md"),
    ("102", "hazzard8e_ch102_back_pain_and_spinal_stenosis.md", "hazzard8e_ch102_study.md"),
    ("104", "hazzard8e_ch104_infection_and_appropriate_antimicrobial_selection.md", "hazzard8e_ch104_study.md"),
    ("105", "hazzard8e_ch105_pneumonia_tb.md", "hazzard8e_ch105_study.md"),
    ("108", "hazzard8e_ch108_influenza_covid_respiratory_viruses.md", "hazzard8e_ch108_study.md"),
]

PAGE_ANCHOR_RE = re.compile(r'<a id="p(\d+)"></a>')
NUM_RE = re.compile(r'\d[\d,.]*')
BOLD_RE = re.compile(r"\*\*([^*\n]+)\*\*")
CITE_GROUP_RE = re.compile(r"\(([^)]*p\d+[^)]*)\)")
PAGE_IN_GROUP_RE = re.compile(r"p(\d+)(?:\s*[–-]\s*p?(\d+))?")

def extract_pages(group_content):
    """Every page number mentioned inside one citation's parens, range-expanded. Handles a bare
    page, 'Table X, pNNN', 'pNNN, image', 'pNNN-MMM' / 'pNNN-pMMM' ranges (expanded to every page
    in between -- all seen so far are 2-3 pages, so this stays cheap), and multiple page mentions
    in one group like 'p894, p897' or 'KCP #3, p1667; detail p1674'."""
    pages = set()
    for m in PAGE_IN_GROUP_RE.finditer(group_content):
        start = int(m.group(1))
        pages.add(start)
        if m.group(2):
            end = int(m.group(2))
            if end < start:  # e.g. a typo'd or truncated range -- don't silently invert it
                end = start
            if end - start <= 10:
                pages.update(range(start, end + 1))
            else:
                pages.add(end)
    return pages

def page_buckets(src_text):
    """Map printed page -> concatenated text on that page (between its anchor and the next)."""
    anchors = list(PAGE_ANCHOR_RE.finditer(src_text))
    buckets = {}
    for i, m in enumerate(anchors):
        page = m.group(1)
        start = m.end()
        end = anchors[i + 1].start() if i + 1 < len(anchors) else len(src_text)
        buckets.setdefault(page, "")
        buckets[page] += src_text[start:end]
    return buckets

def normalize_num(tok):
    return tok.replace(",", "")

def number_tokens(text):
    """Whole-number tokens only (word-boundary), not naive substrings -- '5' must not match
    inside '0.25' or '45' or a page number like '101'. Trailing lookahead only rejects another
    digit (not a bare '.') so a number at a sentence end ('...above 35. Although') still counts."""
    return {normalize_num(m.group(0)) for m in re.finditer(r"(?<![\d.])\d[\d,]*(?:\.\d+)?(?!\d)", text)}

def find_bold_number_claims(study_text):
    """Per-line: every bolded number-bearing span, matched to the NEAREST FOLLOWING citation
    group anywhere later on the same line (not stopped by an intervening ** marker). A citation
    group can name more than one page (a range, or several bare mentions); the claim is checked
    against all of them. A "#pNNN" markdown link-anchor target (Drill question headers' "sourced
    to [p. N](#pN)") is not a citation and is excluded. A bold with no citation later on its own
    line is skipped -- unchanged from the original design, which never required every bolded term
    to carry a citation (eg a bolded drug name alone)."""
    claims = []
    for line in study_text.split("\n"):
        cites = []
        for m in CITE_GROUP_RE.finditer(line):
            if m.group(1).lstrip().startswith("#"):
                continue  # markdown link-anchor target, not a citation
            pages = extract_pages(m.group(1))
            if pages:
                cites.append((m.start(), pages))
        if not cites:
            continue
        for bm in BOLD_RE.finditer(line):
            bold_text = bm.group(1)
            nums = [normalize_num(n) for n in NUM_RE.findall(bold_text)]
            if not nums:
                continue  # bolded but no digits -- not a number claim
            end = bm.end()
            following = [c for c in cites if c[0] >= end]
            if not following:
                continue  # no citation later on this line -- not a checkable claim
            cited_pages = min(following, key=lambda c: c[0])[1]
            claims.append({"bold": bold_text, "cited_pages": cited_pages, "numbers": nums})
    return claims

def check_chapter(num, src_file, study_file):
    src_path = os.path.join(REPO, src_file)
    study_path = os.path.join(REPO, study_file)
    if not os.path.isfile(study_path):
        return {"chapter": num, "error": f"STUDY FILE MISSING: {study_path}"}
    src_text = open(src_path, encoding="utf-8").read()
    study_text = open(study_path, encoding="utf-8").read()
    buckets = page_buckets(src_text)
    all_pages = sorted(int(p) for p in buckets)

    misses = []
    checked = 0
    for claim in find_bold_number_claims(study_text):
        bold_text, cited_pages, nums = claim["bold"], claim["cited_pages"], claim["numbers"]
        checked += 1
        # check each number appears on one of the cited pages, or on any page immediately
        # adjacent (+/-1) to one of them, to tolerate a claim spanning a page break
        candidates = set(cited_pages)
        for cp in cited_pages:
            if cp - 1 in all_pages:
                candidates.add(cp - 1)
            if cp + 1 in all_pages:
                candidates.add(cp + 1)
        candidates = [str(c) for c in candidates]
        found = False
        for pg in candidates:
            bucket_tokens = number_tokens(buckets.get(pg, ""))
            if all(n in bucket_tokens for n in nums):
                found = True
                break
        if not found:
            # relaxed check: each individual number found as a whole token somewhere across
            # candidate pages (handles a bolded span combining two figures, e.g. "4x/12x")
            combined_tokens = set()
            for pg in candidates:
                combined_tokens |= number_tokens(buckets.get(pg, ""))
            if all(n in combined_tokens for n in nums):
                found = True
        if not found:
            cited_str = ",".join(str(c) for c in sorted(cited_pages))
            misses.append({"bold": bold_text, "cited_page": cited_str, "numbers": nums})

    return {"chapter": num, "checked": checked, "misses": misses, "n_misses": len(misses)}

if __name__ == "__main__":
    results = [check_chapter(*c) for c in CHAPTERS]
    total_checked = sum(r.get("checked", 0) for r in results)
    total_misses = sum(r.get("n_misses", 0) for r in results)
    print(f"TOTAL: {total_checked} number-claims checked, {total_misses} misses\n")
    for r in results:
        if r.get("error"):
            print(f"ch{r['chapter']}: ERROR {r['error']}")
            continue
        status = "OK" if r["n_misses"] == 0 else f"{r['n_misses']} MISS(ES)"
        print(f"ch{r['chapter']}: {r['checked']} checked, {status}")
        for miss in r["misses"]:
            print(f"    MISS: bold={miss['bold']!r} cited_page=p{miss['cited_page']} numbers={miss['numbers']}")
    json.dump(results, open(os.path.join(os.path.dirname(__file__), "verify_results.json"), "w", encoding="utf-8"), indent=2)
