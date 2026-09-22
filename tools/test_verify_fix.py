"""Prove the per-line citation fix before trusting it: two fixtures, run through the exact
same check_chapter() logic as production, using temp files so nothing touches the real repo.

Fixture A (known-clean): both bolded numbers on the line are correct -> 0 misses expected.
Fixture B (injected defect): the EARLIER of two bolded numbers sharing one trailing citation is
wrong (99.9 instead of the book's 11.5) -> the fix must report exactly 1 miss for it. The OLD
(pre-fix) checker provably missed this class -- that's the bug being fixed.
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

print("ALL FIXTURE TESTS PASSED -- the fix is proven, not just asserted.")
