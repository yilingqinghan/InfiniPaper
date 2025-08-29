"""Simple exporter: dumps all tables to JSON for portability."""
import json
from pathlib import Path
from sqlmodel import select
from ..db.database import get_session
from ..models import Paper, Author, Tag, Note

def export_json(path: str = "export.json"):
    with next(get_session()) as s:
        data = {
            "papers": [p.dict() for p in s.exec(select(Paper)).all()],
            "authors": [a.dict() for a in s.exec(select(Author)).all()],
            "tags": [t.dict() for t in s.exec(select(Tag)).all()],
            "notes": [n.dict() for n in s.exec(select(Note)).all()],
        }
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {path}")

if __name__ == "__main__":
    export_json()