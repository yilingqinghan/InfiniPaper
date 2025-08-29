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