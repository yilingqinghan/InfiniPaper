# InfiniPaper

自建学术文献数据库 · 无 Docker 快速启动（保持可移植性）

## 快速开始
```bash
make init          # 安装前后端依赖
cp backend/.env.sqlite.example backend/.env
make backend       # http://localhost:8000/docs
make frontend      # http://localhost:3000
```

## 数据可移植
- SQLite 模式下，数据在项目根的 `infinipaper.db` 文件中，拷贝即可迁移。
- 也可执行 `make export` 生成 `export.json`。

## 切换到 Postgres
- 按 `backend/.env.postgres.example` 配置 `DATABASE_URL`。
- 运行 `make db-migrate` 同步表结构。


## 🚀 本次改动（August 29, 2025, M3 friendly）

**UI/UX**
- 全局导航与卡片样式焕新，统一圆角与阴影，提升可读性。
- 新增 `/search` 页面：支持 **语义搜索** 与关键词搜索切换。
- 新增 `/import` 页面：一键从 **OpenAlex** 搜索并批量导入。
- 新增 `/quality` 页面：质量面板展示缺失字段数量，一键定位问题数据。
- 标签输入升级为 **芯片式编辑器**（支持建议与快捷删除）。

**数据与API**
- `GET /api/v1/import/openalex?q=...` 搜索外部文献；`POST /api/v1/import/openalex/import` 批量导入。
- `GET /api/v1/search/semantic?q=...` 语义搜索（优先使用 `sentence-transformers/all-MiniLM-L6-v2`，不可用时自动降级）。
- `POST /api/v1/tags/suggest` 从文本中给出建议标签。
- `GET /api/v1/quality/summary` 质量概览。
- `GET /api/v1/dedupe/preview` 与 `POST /api/v1/dedupe/merge` 去重预览与合并（无 DOI 时按标题近似）。

**安装依赖（后端）**
- 新增依赖：`httpx`、`rapidfuzz`、`sentence-transformers`、`loguru`（已写入 `backend/pyproject.toml`）。
- 语义模型初次运行会自动下载（可离线前置下载）。

**Apple Silicon (M1/M2/M3) 说明**
- Python 依赖建议使用 **uv/poetry** 或 `pipx+venv` 安装，避免 Rosetta。
- 若安装 `sentence-transformers` 较慢，可先跑：`pip install torch --extra-index-url https://download.pytorch.org/whl/cpu`，然后 `pip install sentence-transformers`。
- 若只想先跑起来，后端会自动降级为“关键词搜索”，**不阻塞功能**。

**开发启动**
```bash
make init
cp backend/.env.sqlite.example backend/.env
make backend   # http://localhost:8000/docs
make frontend  # http://localhost:3000
```
