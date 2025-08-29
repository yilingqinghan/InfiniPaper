.PHONY: init backend frontend dev db-migrate export

init:
	cd backend && poetry install
	cd frontend && corepack enable && corepack prepare pnpm@9.6.0 --activate && pnpm install

backend:
	cd backend && poetry run uvicorn app.main:app --reload

frontend:
	cd frontend && pnpm install && pnpm dev

dev:
	@echo "Start two terminals:"
	@echo "1) make backend"
	@echo "2) make frontend"

db-migrate:
	cd backend && poetry run alembic revision --autogenerate -m "auto" && poetry run alembic upgrade head

export:
	cd backend && poetry run python -m app.cli.export_data