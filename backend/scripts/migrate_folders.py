# backend/scripts/migrate_folders.py
from __future__ import annotations

import os
import sys
import pathlib
from typing import Set

# --- 让脚本可直接作为独立文件运行，自动补 PYTHONPATH ---
THIS = pathlib.Path(__file__).resolve()
BACKEND_DIR = THIS.parents[1]         # .../backend
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# --- 拿到 engine（优先用项目里的 engine；失败则回退用 DATABASE_URL） ---
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine

def _get_engine():
    # 1) 项目内标准位置
    try:
        from app.db.session import engine  # type: ignore
        return engine
    except Exception:
        pass

    # 2) 尝试用项目配置
    try:
        from app.core.config import settings  # type: ignore
        db_url = getattr(settings, "SQLALCHEMY_DATABASE_URI", None) or \
                 getattr(settings, "DATABASE_URL", None)
        if db_url:
            return create_engine(db_url, echo=False)
    except Exception:
        pass

    # 3) 环境变量
    db_url = os.getenv("DATABASE_URL") or os.getenv("SQLALCHEMY_DATABASE_URI")
    if db_url:
        return create_engine(db_url, echo=False)

    # 4) 最后兜底（常见的 sqlite 路径；你若自定义了路径，可导出 DATABASE_URL 再运行）
    fallback = "sqlite:///./app.db"
    print(f"[migrate] WARNING: using fallback DB url: {fallback}")
    return create_engine(fallback, echo=False)

engine = _get_engine()

def colnames(conn, table: str) -> Set[str]:
    rows = conn.exec_driver_sql(f"PRAGMA table_info('{table}')").all()
    return {r[1] for r in rows}  # r[1] 是列名

def table_exists(conn, table: str) -> bool:
    row = conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).first()
    return bool(row)

def main():
    with engine.begin() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")

        # folder 表：补列
        if not table_exists(conn, "folder"):
            print("[migrate] table 'folder' not found -> create_all")
            SQLModel.metadata.create_all(engine)
        else:
            cols = colnames(conn, "folder")
            if "parent_id" not in cols:
                print("[migrate] add column folder.parent_id")
                conn.exec_driver_sql("ALTER TABLE folder ADD COLUMN parent_id INTEGER NULL")
            if "color" not in cols:
                print("[migrate] add column folder.color")
                conn.exec_driver_sql("ALTER TABLE folder ADD COLUMN color VARCHAR(255) NULL")
            if "created_at" not in cols:
                print("[migrate] add column folder.created_at")
                conn.exec_driver_sql("ALTER TABLE folder ADD COLUMN created_at TIMESTAMP NULL")

        # paperfolderlink 表：若不存在则创建
        if not table_exists(conn, "paperfolderlink"):
            print("[migrate] create table paperfolderlink")..
            conn.exec_driver_sql("""
                CREATE TABLE IF NOT EXISTS paperfolderlink (
                    paper_id INTEGER NOT NULL,
                    folder_id INTEGER NOT NULL,
                    PRIMARY KEY (paper_id),
                    FOREIGN KEY(paper_id) REFERENCES paper(id),
                    FOREIGN KEY(folder_id) REFERENCES folder(id)
                )
            """)

    print("[migrate] done ✅")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[migrate] failed:", repr(e))
        sys.exit(1)