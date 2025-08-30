.PHONY: init backend frontend dev db-migrate export

init:
	cd backend && poetry add uvicorn && poetry install
	cd frontend && corepack enable && corepack prepare pnpm@9.6.0 --activate && pnpm install

backend:
	cd backend && poetry run python -m uvicorn app.main:app --reload

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

ccf:
	MAIN=$$(pwd); \
	git submodule update --init --remote --rebase; \
	cd $$MAIN/ccf-deadlines && yarn set version stable && yarn install && \
	mkdir -p public/conference && cd public/conference && \
	awk 1 $$(find ../../conference -name '*.yml' -not -path '**/types.yml') > allconf.yml && \
	awk 1 $$(find ../../accept_rates -name '*.yml') > allacc.yml && \
	cp ../../conference/types.yml . && cd ../.. && \
	python cli/ccfddl/convert_to_ical.py && mv *.ics public/conference/ && \
	NODE_OPTIONS=--openssl-legacy-provider yarn build && \
	rm -rf $$MAIN/ccfddl && rm -rf $$MAIN/frontend/public/ccfddl && mv $$MAIN/ccf-deadlines/dist $$MAIN/frontend/public/ccfddl

run:
	@echo "Starting the local environment..."
	@make ccf &
	@make backend &
	@make frontend