"""Prove the checker fixes before trusting them, run through the exact same check_chapter() logic
as production, using temp files so nothing touches the real repo.

Fixtures A/B: the per-line citation fix (23-24 Sep). A is known-clean (both bolded numbers on the
line are correct -> 0 misses). B injects a defect: the EARLIER of two bolds sharing one trailing
citation is wrong (99.9 instead of the book's 11.5) -> exactly 1 miss expected. The OLD (pre-fix)
checker provably missed this class -- that's the bug being fixed.

Fixtures C-E: the widened citation-style parsing (24 Sep) -- "(pNNN, Table X)", "(Table X, pNNN)",
and a "(pNNN-MMM)" page range. Each has a clean variant (0 misses) and a defect variant (1 miss on
the wrong number), proving the widened parser both reads these styles at all AND still catches a
real mismatch under each style, not just that it stops crashing on them.
"""
import os, sys, tempfile, shutil

sys.path.insert(0, os.path.dirname(__file__))
import verify_study_pages as v

FIXTURE_SRC = '''# Fixture Chapter

<a id="p100"></a>**[p. 100]**

Some prose here. The rate is 11.5% in children and 47% in adults, according to the study.
'''

FIXTURE_STUDY_CLEAN = '''Study summary of Fixture Chapter.

- Rate: **11.5%** in children, but **47%** in adults (p100).
'''

FIXTURE_STUDY_DEFECT = '''Study summary of Fixture Chapter.

- Rate: **99.9%** in children, but **47%** in adults (p100).
'''

def run_fixture(src_text, study_text, label):
    tmpdir = tempfile.mkdtemp()
    try:
        src_path = os.path.join(tmpdir, "src.md")
        study_path = os.path.join(tmpdir, "study.md")
        open(src_path, "w", encoding="utf-8").write(src_text)
        open(study_path, "w", encoding="utf-8").write(study_text)
        orig_repo = v.REPO
        v.REPO = tmpdir
        result = v.check_chapter("FIX", "src.md", "study.md")
        v.REPO = orig_repo
        print(f"--- {label} ---")
        print(f"checked={result['checked']} misses={result['n_misses']}")
        for m in result["misses"]:
            print(f"  MISS: {m}")
        return result
    finally:
        shutil.rmtree(tmpdir)

clean = run_fixture(FIXTURE_SRC, FIXTURE_STUDY_CLEAN, "Fixture A: clean, both numbers correct")
assert clean["checked"] == 2, f"expected 2 claims checked (both bolds on the line), got {clean['checked']}"
assert clean["n_misses"] == 0, f"expected 0 misses on the clean fixture, got {clean['n_misses']}"
print("PASS: clean fixture -> 0 misses, both bolds counted as checked\n")

defect = run_fixture(FIXTURE_SRC, FIXTURE_STUDY_DEFECT, "Fixture B: earlier bold deliberately wrong (99.9 vs book's 11.5)")
assert defect["checked"] == 2, f"expected 2 claims checked, got {defect['checked']}"
assert defect["n_misses"] == 1, f"expected exactly 1 miss (the injected defect), got {defect['n_misses']}"
assert defect["misses"][0]["bold"] == "99.9%", f"expected the miss to be the earlier bold '99.9%', got {defect['misses'][0]['bold']}"
print("PASS: injected defect on the EARLIER of two same-citation bolds is caught\n")

# --- Widened citation-style fixtures (24 Sep) ---

FIXTURE_SRC2 = '''# Fixture Chapter 2

<a id="p200"></a>**[p. 200]**

Prose on page 200: the dose is 25 mg. Table 2-1 (not shown as text) lives on this page too.

<a id="p201"></a>**[p. 201]**

Prose on page 201: the rate is 60% overall.
'''

def check_style(label, study_line, expect_checked, expect_miss_bold):
    study = f"Study summary.\n\n- {study_line}\n"
    r = run_fixture(FIXTURE_SRC2, study, label)
    assert r["checked"] == expect_checked, f"{label}: expected {expect_checked} checked, got {r['checked']}"
    if expect_miss_bold is None:
        assert r["n_misses"] == 0, f"{label}: expected 0 misses, got {r['n_misses']}"
    else:
        assert r["n_misses"] == 1, f"{label}: expected 1 miss, got {r['n_misses']}"
        assert r["misses"][0]["bold"] == expect_miss_bold, f"{label}: expected miss on {expect_miss_bold!r}, got {r['misses'][0]['bold']!r}"
    print(f"PASS: {label}\n")

check_style("Fixture C-clean: '(pNNN, Table X)' style, correct value",
            "Dose: **25 mg** (p200, Table 2-1).", 1, None)
check_style("Fixture C-defect: '(pNNN, Table X)' style, wrong value",
            "Dose: **99 mg** (p200, Table 2-1).", 1, "99 mg")

check_style("Fixture D-clean: '(Table X, pNNN)' style, correct value",
            "Dose: **25 mg** (Table 2-1, p200).", 1, None)
check_style("Fixture D-defect: '(Table X, pNNN)' style, wrong value",
            "Dose: **99 mg** (Table 2-1, p200).", 1, "99 mg")

check_style("Fixture E-clean: page-range '(pNNN-MMM)' style, correct value spanning the range",
            "Findings: **25 mg** and **60%** (p200-201).", 2, None)
check_style("Fixture E-defect: page-range '(pNNN-MMM)' style, wrong value",
            "Findings: **25 mg** and **99%** (p200-201).", 2, "99%")

print("ALL FIXTURE TESTS PASSED -- both the per-line fix and the widened citation-style parsing are proven, not just asserted.")
