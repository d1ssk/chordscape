"""Verify reviewed analysis references against the pinned When in Rome archive."""

from collections import Counter
import hashlib
import json
from pathlib import Path
import tarfile


ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "datasets" / "publication_corpus_v1.json"


def main() -> None:
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    revision = policy["source_revisions"]["when_in_rome"]
    short = revision[:12]
    archive = (
        ROOT / "data" / "raw" / "when_in_rome" / short / f"when-in-rome-{short}.tar.gz"
    )
    references = {}
    reviews = policy["reviewed_choco_when_in_rome"]
    for review in reviews.values():
        path = review.get("analysis_path")
        if path is None:
            continue
        digest = review["analysis_sha256"]
        if path in references and references[path] != digest:
            raise ValueError(f"Conflicting analysis hashes: {path}")
        references[path] = digest

    prefix = f"When-in-Rome-{revision}/"
    found = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            path = member.name[len(prefix):]
            if path not in references:
                continue
            file = source.extractfile(member)
            assert file is not None
            actual = hashlib.sha256(file.read()).hexdigest()
            if actual != references[path]:
                raise ValueError(f"Analysis hash mismatch: {path}")
            found.add(path)
    missing = set(references) - found
    if missing:
        raise ValueError(f"Analysis references absent from archive: {sorted(missing)[:5]}")
    decisions = dict(sorted(Counter(item["decision"] for item in reviews.values()).items()))
    print(f"Verified {len(found)} analysis files; {len(reviews)} reviewed ChoCo items: {decisions}")


if __name__ == "__main__":
    main()
