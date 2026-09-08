from collections import Counter, defaultdict
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MD_FILES = sorted(p for p in ROOT.rglob("*.md") if ".git" not in p.parts)
TEXT = {p: p.read_text(encoding="utf-8") for p in MD_FILES}


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def frontmatter(text: str) -> str:
    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", text, re.S)
    return match.group(1) if match else ""


def aliases(text: str) -> list[str]:
    fm = frontmatter(text)
    match = re.search(r"(?m)^aliases:\s*(.*)$", fm)
    if not match:
        return []
    inline = match.group(1).strip()
    if inline.startswith("[") and inline.endswith("]"):
        return [x.strip(" '\"") for x in inline[1:-1].split(",") if x.strip()]
    tail = fm[match.end():]
    found = []
    for line in tail.splitlines():
        item = re.match(r"^\s+-\s+(.+?)\s*$", line)
        if item:
            found.append(item.group(1).strip(" '\""))
        elif line.strip():
            break
    return found


name_owners: dict[str, list[Path]] = defaultdict(list)
for path, text in TEXT.items():
    name_owners[path.stem.casefold()].append(path)
    for alias in aliases(text):
        name_owners[alias.casefold()].append(path)

ambiguous_names = {
    name: sorted(set(paths))
    for name, paths in name_owners.items()
    if len(set(paths)) > 1
}
attachments = {
    path.name.casefold()
    for path in ROOT.rglob("*")
    if path.is_file() and path.suffix.lower() != ".md" and ".git" not in path.parts
}

broken: list[tuple[Path, str]] = []
outgoing: dict[Path, set[Path]] = defaultdict(set)
incoming: Counter[Path] = Counter()
for path, text in TEXT.items():
    for raw in re.findall(r"\[\[([^\]]+)\]\]", text):
        target = raw.split("|", 1)[0].split("#", 1)[0].strip()
        if not target:
            continue
        target_name = Path(target).name
        key = Path(target_name).stem.casefold()
        if target_name.casefold() in attachments:
            continue
        owners = sorted(set(name_owners.get(key, [])))
        if len(owners) != 1:
            broken.append((path, raw))
            continue
        outgoing[path].add(owners[0])
        incoming[owners[0]] += 1

infrastructure = {
    ROOT / "README.md",
    ROOT / "_templates" / "Exam topic.md",
    ROOT / "00 Exam" / "START HERE.md",
}
orphans = [path for path in MD_FILES if path not in infrastructure and incoming[path] == 0]
notes_without_links = [
    path for path in MD_FILES if path not in infrastructure and not outgoing[path]
]

learning_notes = []
for path in MD_FILES:
    if re.match(r"0[1-9] ", path.parent.name) and "type: moc" not in TEXT[path]:
        learning_notes.append(path)

required_keys = ("topic", "section", "priority", "status", "source_page")
required_blocks = (
    "[!summary] Відповідь за 20–30 секунд",
    "## Суть",
    "## Іспитовий фокус",
    "**Що запам'ятати:**",
    "**Типова пастка:**",
    "**Можливі питання:**",
    "## Пов’язані знання",
    "## Самоперевірка",
    "## Джерело програми",
)
quality_issues: list[tuple[Path, str]] = []
priorities = Counter()
for path in learning_notes:
    text = TEXT[path]
    fm = frontmatter(text)
    for key in required_keys:
        if not re.search(rf"(?m)^{re.escape(key)}:\s*\S+", fm):
            quality_issues.append((path, f"missing frontmatter {key}"))
    priority = re.search(r"(?m)^priority:\s*(P[0-2])\s*$", fm)
    if priority:
        priorities[priority.group(1)] += 1
    else:
        quality_issues.append((path, "invalid priority"))
    page = re.search(r"(?m)^source_page:\s*(\d+)", fm)
    if re.match(r"0[1-5] ", path.parent.name) and page and not 11 <= int(page.group(1)) <= 22:
        quality_issues.append((path, "source_page outside 11-22"))
    if re.match(r"0[6-9] ", path.parent.name) and not re.search(r"(?m)^source_document:\s*\S+", fm):
        quality_issues.append((path, "missing source_document"))
    for block in required_blocks:
        if block not in text:
            quality_issues.append((path, f"missing block {block}"))
    related = re.search(r"## Пов’язані знання\n(.*?)(?:\n## |\Z)", text, re.S)
    if not related or len(re.findall(r"\[\[", related.group(1))) < 2:
        quality_issues.append((path, "fewer than two related concept links"))

required_exam = {
    "START HERE.md",
    "F3 — Карта екзамену.md",
    "Що вчити зараз.md",
    "Checklist повторення.md",
    "Дірки в знаннях.md",
    "Швидка шпаргалка.md",
    "Усні питання.md",
}
missing_exam = sorted(required_exam - {p.name for p in (ROOT / "00 Exam").glob("*.md")})

coverage_text = TEXT[ROOT / "99 Source" / "Покриття програми сторінки 11–22.md"]
coverage = Counter(
    re.findall(r"(?m)^- \*\*(covered|partially covered|missing)\*\*", coverage_text)
)

ipmms_coverage_text = TEXT[ROOT / "99 Source" / "Покриття білетів ІПММС.md"]
ipmms_tickets = {
    int(number): status
    for number, status in re.findall(
        r"(?ms)^## Білет (\d+)\n\n- \*\*(covered|partially covered|missing)\*\*",
        ipmms_coverage_text,
    )
}
ipmms_missing = sorted(set(range(1, 21)) - set(ipmms_tickets))
ipmms_not_covered = sorted(
    number for number, status in ipmms_tickets.items() if status != "covered"
)

print(f"Markdown files: {len(MD_FILES)}")
print(f"Learning notes: {len(learning_notes)}")
print(f"Priorities: P0={priorities['P0']}, P1={priorities['P1']}, P2={priorities['P2']}")
print(
    "Coverage rows: "
    f"covered={coverage['covered']}, "
    f"partially covered={coverage['partially covered']}, "
    f"missing={coverage['missing']}"
)
print(
    "ІПММС tickets: "
    f"covered={sum(status == 'covered' for status in ipmms_tickets.values())}, "
    f"missing={len(ipmms_missing)}, "
    f"not covered={len(ipmms_not_covered)}"
)
print(f"Broken wikilinks: {len(broken)}")
print(f"Orphan notes: {len(orphans)}")
print(f"Notes without outgoing links: {len(notes_without_links)}")
print(f"Ambiguous note names or aliases: {len(ambiguous_names)}")
print(f"Learning-note quality issues: {len(quality_issues)}")
print(f"Missing required 00 Exam pages: {len(missing_exam)}")

for path, raw in broken:
    print(" BROKEN", rel(path), "->", raw)
for path in orphans:
    print(" ORPHAN", rel(path))
for path in notes_without_links:
    print(" NO_OUTGOING", rel(path))
for name, paths in sorted(ambiguous_names.items()):
    print(" AMBIGUOUS", name, "->", ", ".join(rel(p) for p in paths))
for path, issue in quality_issues:
    print(" QUALITY", rel(path), "->", issue)
for name in missing_exam:
    print(" MISSING_EXAM", name)
for number in ipmms_missing:
    print(" IPMMS_MISSING_TICKET", number)
for number in ipmms_not_covered:
    print(" IPMMS_NOT_COVERED", number)

failed = any(
    (broken, orphans, notes_without_links, ambiguous_names, quality_issues, missing_exam,
     ipmms_missing, ipmms_not_covered)
) or coverage["partially covered"] or coverage["missing"] or coverage["covered"] == 0
sys.exit(1 if failed else 0)
