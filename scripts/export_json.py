#!/usr/bin/env python
import json, os, pathlib, datetime
from sqlmodel import Session, select
from app.db.database import engine
from app.models import Paper, Author, Tag, Note

out_dir = pathlib.Path("exports")
out_dir.mkdir(exist_ok=True)

def dump_table(name, rows):
    path = out_dir / f"{name}.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"Wrote {path}")

with Session(engine) as s:
    papers = [r.dict() for r in s.exec(select(Paper)).all()]
    authors = [r.dict() for r in s.exec(select(Author)).all()]
    tags = [r.dict() for r in s.exec(select(Tag)).all()]
    notes = [r.dict() for r in s.exec(select(Note)).all()]

dump_table("papers", papers)
dump_table("authors", authors)
dump_table("tags", tags)
dump_table("notes", notes)

print("JSON export finished.")
