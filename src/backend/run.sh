#!/bin/bash

# Run FastAPI backend with hot reload

echo "Starting FastAPI backend on http://localhost:8000"
echo "API docs available at http://localhost:8000/docs"
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
