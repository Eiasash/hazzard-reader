"""Small view-specific projections of the canonical bank and flashcard data."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]

def generate(out, paths):
    # The chapter search needs drug names, not the full book and exam passages.
    drugs = json.loads((ROOT / "data/drug-index.json").read_bytes())["entries"]
    lookup = []
    buckets = {}
    for drug in drugs:
        aliases = list(drug.get("aliases", []))
        for brand in drug.get("israeliBrands", []):
            aliases.extend([brand.get("name"), brand.get("hebrewName"), *brand.get("searchNames", [])])
        bucket = hashlib.sha256(drug["id"].encode()).hexdigest()[:1]
        part = f"data/drug-details/{bucket}.json"
        buckets.setdefault(part, {})[drug["id"]] = drug
        lookup.append({**({"previousId": drug["previousId"]} if "previousId" in drug else {}), "detailFile": part, "bankOnly": drug.get("bankOnly", False), "id": drug["id"], "name": drug["name"], "class": drug.get("class", ""),
                       "kind": drug["kind"], "aliases": list(dict.fromkeys(a for a in aliases if a)),
                       "passages": len(drug["passages"]), "questions": len(drug["questions"])})
    for name, entries in buckets.items():
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
        paths.add(name)
    drug_lookup = "data/drug-lookup.json"
    (out / drug_lookup).write_text(json.dumps(lookup, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8", newline="\n")
    paths.add(drug_lookup)
    home_file = "data/home-question-summary.json"
    catalog = json.loads((ROOT / "data/mcq/catalog.json").read_text(encoding="utf-8"))
    evidence = json.loads((ROOT / "data/mcq/exam-references.json").read_text(encoding="utf-8"))
    collections = json.loads((ROOT / "data/mcq/collections.json").read_text(encoding="utf-8"))
    positions = {q["id"]: i for i, q in enumerate(catalog)}
    chapters = {}
    for i, q in enumerate(catalog):
        if not q.get("retired") and q.get("chapter") is not None:
            chapters.setdefault(str(q["chapter"]), []).append(i)
    for chapter, record in evidence["study"].items():
        chapters[chapter] = list(dict.fromkeys(chapters.get(chapter, []) + [positions[k] for k in record["ids"] if k in positions]))
    compact = {"questions": [[q["id"], 1 if q["kind"] == "past" else 0, q["accepted"], int(bool(q.get("retired"))) + 2 * int(bool(q.get("content_changed")))] for q in catalog],
               "chapters": chapters, "sittings": {positions[k]: v["sitting"] for k, v in evidence["questions"].items() if k in positions},
               "law": [positions[k] for k in collections["israeliLawEthics"]["ids"] if k in positions]}
    aliases = json.loads((ROOT / "data/highlight-aliases.json").read_bytes())
    for chapter, membership in evidence["study"].items():
        if not chapter.isdigit():
            continue
        ids = set(membership["ids"])
        for qid, record in evidence["questions"].items():
            pages = record["pages"] + record.get("supportPages", []) + record.get("relatedTeaching", [])
            if chapter in record["chapters"] or any(chapter in (str(page.get("chapter")), str(page.get("readerChapter"))) for page in pages):
                ids.add(qid)
        current = [catalog[i]["id"] for i in chapters.get(chapter, [])]
        ids.update(current)
        subset = {"accepted": {qid: catalog[positions[qid]]["accepted"] for qid in sorted(ids) if qid in positions},
                  "study": {chapter: membership}, "currentChapters": {chapter: current},
                  "questions": {qid: record for qid, record in evidence["questions"].items() if qid in ids}}
        # The chapter Questions directory needs the stems already covered by its visible teaching.
        subset["directoryStems"] = {qid: catalog[positions[qid]]["q"] for qid in current if qid in positions}
        subset["highlightAliases"] = [a for a in aliases if a["chapter"] in (chapter, chapter + "s")]
        path = f"data/reader-references/{chapter}.json"
        (out / path).parent.mkdir(parents=True, exist_ok=True)
        (out / path).write_text(json.dumps(subset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
        paths.add(path)
    # Shared directory for filtering and sorting. Only the displayed question needs its full text.
    compact["statsRows"] = [
        [q["topic"], q.get("topics"), q["t"], q["chapter"], q["sourceIndex"], q["c"], q["law"],
         q.get("source"), q.get("mockEligible"), q.get("sourceChecked")]
        for q in catalog
    ]
    # The initial Bank list is small. Full-text search and deeper pages may request the full catalogue.
    served = [q for q in catalog if not q.get("retired")]
    official = sorted((q for q in served if q["kind"] == "past"), key=lambda q: q.get("examNumber", 0))
    official.sort(key=lambda q: q["t"], reverse=True)
    practice = sorted((q for q in served if q["kind"] == "practice"), key=lambda q: q["sourceIndex"])
    first = {q["id"]: q["q"] for q in official[:48] + practice[:48]}
    directory_file = "data/mcq/directory-start.json"
    (out / directory_file).write_text(json.dumps(first, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    paths.add(directory_file)
    compact["articleFilterEnabled"] = collections["suppliedArticles"]["enabled"]
    compact["topicFallbacks"] = collections["topicFallbacks"]
    compact["topics"] = json.loads((ROOT / "data/mcq/topics.json").read_bytes())
    compact["toc"] = json.loads((ROOT / "data/mcq/hazzard8e-toc.json").read_bytes())["chapters"]
    compact["studyIds"] = list(evidence["study"])
    compact["articles"] = [positions[k] for k in collections["suppliedArticles"]["ids"] if k in positions]
    # A review question carries its own page references; the full bibliography
    # and general bank catalogue are unnecessary to answer that question.
    for chunk in sorted((out / "data/mcq/chunks").glob("*.json")):
        rows = json.loads(chunk.read_bytes())
        for row in rows:
            if row["id"] in evidence["questions"]:
                row["readerReference"] = evidence["questions"][row["id"]]
        chunk.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    # Share the official sitting directory with the chooser. Question bodies are
    # fetched only for the sitting the reader actually opens.
    compact["officialSlots"] = [[i, q["t"], q["examNumber"]] for i, q in enumerate(catalog)
                                if q["kind"] == "past" and q.get("examNumber")]
    sittings = {}
    for question in json.loads((ROOT / "data/mcq/all.json").read_text(encoding="utf-8")):
        if question["kind"] == "past" and question.get("examNumber"):
            sitting = question["t"].rsplit("-", 1)[0]
            sittings.setdefault(sitting, []).append(question)
    for sitting, questions in sittings.items():
        name = f"data/mcq/sittings/{sitting}.json"
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        (out / name).write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
        paths.add(name)
    history = json.loads((ROOT / "data/redo-history.json").read_text(encoding="utf-8"))["questions"]
    changes = json.loads((ROOT / "data/mcq/content-changes.json").read_text(encoding="utf-8"))
    # Home needs the last correction date to score first attempts, not the
    # complete list of question labels and previous revisions.
    dates = {}
    for change in history + changes:
        qid, date = change["id"], change["changedAt"]
        stamp = datetime.fromisoformat(date.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        if qid not in dates or stamp > dates[qid][0]:
            dates[qid] = (stamp, date)
    dates = {qid: dated[1] for qid, dated in dates.items()}
    unique_dates = sorted(set(dates.values()))
    date_id = {date: i for i, date in enumerate(unique_dates)}
    compact["changeDates"] = unique_dates
    compact["changes"] = [[positions.get(qid, qid), date_id[date]] for qid, date in dates.items()]
    (out / home_file).write_text(json.dumps(compact,separators=(",",":")),encoding="utf-8",newline="\n")
    paths.add(home_file)
    cards = json.loads((ROOT/'data/flashcards.json').read_bytes())
    index = {
        "chapters": sorted({str(c["chapter"]) for c in cards}),
        "ids": [c["id"] for c in cards],
        "legacy": {c["id"]: c["recallKeys"] for c in cards if c.get("recallKeys")},
    }
    name = "data/flashcard-due-index.json"
    (out/name).write_text(json.dumps(index, ensure_ascii=False, separators=(",",":"))+"\n",encoding="utf-8",newline="\n")
    paths.add(name)
