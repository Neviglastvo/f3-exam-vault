from pathlib import Path
import re, sys
root=Path(__file__).resolve().parents[1]
files=[p for p in root.rglob('*.md') if '.git' not in p.parts]
by_name={p.stem:p for p in files}
# Non-markdown attachments that wikilinks can target.
attachments={p.name:p for p in root.rglob('*') if p.is_file() and p.suffix.lower()!='.md'}
broken=[]
for p in files:
    text=p.read_text(encoding='utf-8')
    for raw in re.findall(r'\[\[([^\]]+)\]\]', text):
        target=raw.split('|',1)[0]
        target=target.split('#',1)[0]
        if not target:
            continue
        name=Path(target).name
        stem=Path(name).stem
        if name in attachments or stem in by_name:
            continue
        broken.append((p.relative_to(root),raw))
# Duplicate markdown basenames make Obsidian resolution ambiguous.
seen={}
dups=[]
for p in files:
    if p.stem in seen: dups.append((p.stem,seen[p.stem],p))
    seen[p.stem]=p
print(f'Markdown files: {len(files)}')
print(f'Broken wikilinks: {len(broken)}')
for x in broken[:50]: print(' BROKEN',x)
print(f'Duplicate note names: {len(dups)}')
for x in dups[:50]: print(' DUP',x)
if broken or dups: sys.exit(1)
