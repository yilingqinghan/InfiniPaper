# InfiniPaper Backend (No-Docker Quickstart)

## 1) 环境准备（Mac / M3 Max）
- Python 3.11
- Poetry (`pipx install poetry`)

## 2) 选择数据库
### 方案 A：SQLite（零依赖）
```bash
cd backend
cp .env.sqlite.example .env
poetry install
poetry run uvicorn app.main:app --reload
# http://localhost:8000/docs
```

### 方案 B：Postgres
```bash
cd backend
cp .env.postgres.example .env
poetry install
poetry run uvicorn app.main:app --reload
```

> 本项目改用 **IP_ 前缀** 的环境变量（如 `IP_DATABASE_URL`），避免你系统里已有的 `DATABASE_URL` 影响运行。
> 如果你想继续使用系统 `DATABASE_URL`，请手动：`unset DATABASE_URL` 再运行。

## 3) Alembic 迁移（可选）
```bash
poetry run alembic revision --autogenerate -m "init"
poetry run alembic upgrade head
```

## 4) 导出数据（可移植）
```bash
poetry run python -m app.cli.export_data
```
