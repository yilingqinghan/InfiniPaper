#!/usr/bin/env python
from app.db.database import init_db
print("Initializing DB (creating tables & pgvector check)...")
init_db()
print("Done.")
