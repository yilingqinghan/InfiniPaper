.PHONY: init backend frontend dev db-migrate export ollama ollama-pull ollama-stop mineru-http mineru-http-stop grobid grobid-stop

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

# --- Local LLM via Ollama ----------------------------------------------------
ollama:
	@command -v ollama >/dev/null 2>&1 || { echo "[ERR] Please install Ollama: https://ollama.com/download"; exit 1; }
	@echo "Starting ollama serve (background)..."
	@OLLAMA_NUM_PARALLEL=1 ollama serve >/dev/null 2>&1 & echo $$! > .ollama.pid; sleep 2
	@echo "Ollama running on $(shell grep -E '^OLLAMA_BASE_URL' backend/.env 2>/dev/null || echo OLLAMA_BASE_URL=http://localhost:11434)"

ollama-pull:
	@MODEL=$(shell grep -E '^OLLAMA_MODEL' backend/.env 2>/dev/null | cut -d'=' -f2); \
	if [ -z "$$MODEL" ]; then MODEL=llama3.1:8b; fi; \
	echo "Pulling $$MODEL..."; \
	ollama pull $$MODEL

# --- MinerU (HTTP service) ---------------------------------------------------
# Usage:
#   make mineru-http MINERU_IMAGE=<your-mineru-image>
#   # expects the service to listen on 7001 in the container
mineru-http:
	@if [ -z "$$MINERU_IMAGE" ]; then echo "[ERR] Please provide MINERU_IMAGE=<image>, e.g. MINERU_IMAGE=mineru/mineru:latest"; exit 1; fi
	@echo "Starting MinerU HTTP service on :7001 ..."
	docker run -d --name mineru -p 7001:7001 -v $$(pwd)/backend/storage/mineru:/data $$MINERU_IMAGE >/dev/null
	@echo "MinerU running at http://localhost:7001"

mineru-http-stop:
	-@docker rm -f mineru >/dev/null 2>&1 || true

# --- GROBID (optional) -------------------------------------------------------
grobid:
	@echo "Starting GROBID on :8070 ..."
	docker run -d --name grobid -p 8070:8070 lfoppiano/grobid:0.7.3 >/dev/null
	@echo "GROBID running at http://localhost:8070"

grobid-stop:
	-@docker rm -f grobid >/dev/null 2>&1 || true

# --- Helpers -----------------------------------------------------------------
ollama-stop:
	-@[ -f .ollama.pid ] && kill $$(cat .ollama.pid) >/dev/null 2>&1 && rm -f .ollama.pid || true

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
	@make ollama &
	-@make grobid &
	@make backend &
	@make frontend