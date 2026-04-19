.PHONY: dev install backend worker frontend clean

# Default target
all: install dev

# Install all dependencies
install:
	@echo "Installing root dependencies..."
	 bun install
	@echo "Installing frontend dependencies..."
	 cd frontend && bun install
	@echo "Installing backend dependencies..."
	 cd backend && bun install
	@echo "Installing worker dependencies..."
	 cd worker && bun install

# Run everything (backend + worker + frontend)
dev: install
	@echo "Starting Atelier..."
	@echo ""
	@echo "NOTE: The worker must be started separately:"
	@echo "  make worker"
	@echo ""
	cd backend && bun run dev &
	cd frontend && bun run dev &
	wait

# Start backend only
backend:
	cd backend && bun run dev

# Start worker only (requires backend to be running)
worker:
	cd worker && bun run start

# Start frontend only
frontend:
	cd frontend && bun run dev

# Clean build artifacts
clean:
	cd frontend && rm -rf dist node_modules/.vite
	cd backend && rm -rf dist
	cd worker && rm -rf dist
	rm -rf node_modules

# Build for production
build:
	bun run build

# Help
help:
	@echo "Atelier Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  make install   - Install all dependencies"
	@echo "  make dev       - Start backend and frontend (worker must be started separately)"
	@echo "  make backend    - Start the backend server"
	@echo "  make worker     - Start the Temporal worker"
	@echo "  make frontend   - Start the frontend dev server"
	@echo "  make build     - Build for production"
	@echo "  make clean     - Clean build artifacts"
	@echo ""
	@echo "Quick start:"
	@echo "  Terminal 1: make backend"
	@echo "  Terminal 2: make worker"
	@echo "  Terminal 3: make frontend"
