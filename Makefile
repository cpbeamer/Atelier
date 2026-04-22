.PHONY: dev install backend worker frontend clean docker-build docker-up docker-down docker-dev docker-logs

# bun location
BUN := $(HOME)/.bun/bin/bun
export PATH := $(HOME)/.bun/bin:$(PATH)

# Default target
all: install dev

# Install all dependencies
install:
	@echo "Installing root dependencies..."
	 $(BUN) install
	@echo "Installing frontend dependencies..."
	 cd frontend && $(BUN) install
	@echo "Installing backend dependencies..."
	 cd backend && $(BUN) install
	@echo "Installing worker dependencies..."
	 cd worker && $(BUN) install

# Run everything (backend + worker + frontend)
dev: install
	@echo "Starting Atelier..."
	@echo ""
	@echo "NOTE: The worker must be started separately:"
	@echo "  make worker"
	@echo ""
	cd backend && $(BUN) run dev &
	cd frontend && $(BUN) run dev &
	wait

# Start backend only
backend:
	cd backend && $(BUN) run dev

# Start worker only (requires backend to be running)
worker:
	cd worker && $(BUN) run start

# Start frontend only
frontend:
	cd frontend && $(BUN) run dev

# Docker commands
docker-build:
	docker compose build

docker-up:
	docker compose up -d
	@echo ""
	@echo "Atelier is running!"
	@echo "  Backend:  ws://localhost:3000"
	@echo "  HTTP API: http://localhost:3001"
	@echo "  Temporal: http://localhost:8466 (Web UI)"
	@echo ""

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-dev: docker-up
	@echo "Starting backend and worker on host..."
	@echo ""
	cd backend && TEMPORAL_ADDRESS=localhost:7466 USE_EXTERNAL_TEMPORAL=true $(BUN) run src/index.ts &
	cd worker && TEMPORAL_ADDRESS=localhost:7466 $(BUN) run src/worker.ts &
	@echo ""
	@echo "All services started!"
	@echo "  Backend:  ws://localhost:3000"
	@echo "  HTTP API: http://localhost:3001"
	@echo "  Temporal: http://localhost:8466 (Web UI)"
	@echo ""
	@echo "Press Ctrl+C to stop all services"

# Clean build artifacts
clean:
	cd frontend && rm -rf dist node_modules/.vite
	cd backend && rm -rf dist
	cd worker && rm -rf dist
	rm -rf node_modules

# Build for production
build:
	$(BUN) run build

# Help
help:
	@echo "Atelier Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  make install     - Install all dependencies"
	@echo "  make dev        - Start backend and frontend (worker must be started separately)"
	@echo "  make backend    - Start the backend server"
	@echo "  make worker     - Start the Temporal worker"
	@echo "  make frontend   - Start the frontend dev server"
	@echo "  make docker-up  - Start all services in Docker containers"
	@echo "  make docker-down - Stop Docker containers"
	@echo "  make build      - Build for production"
	@echo "  make clean      - Clean build artifacts"
	@echo ""
	@echo "Quick start:"
	@echo "  Terminal 1: make backend"
	@echo "  Terminal 2: make worker"
	@echo "  Terminal 3: make frontend"
	@echo ""
	@echo "Or with Docker:"
	@echo "  make docker-up"
