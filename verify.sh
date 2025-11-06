#!/bin/bash

# Video Editor - Automated Verification Script
# Tests that both backend and frontend are running correctly

echo "🔍 Video Editor - Project Verification"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

# Test function
test_step() {
    local description=$1
    local command=$2
    local expected=$3

    echo -n "Testing: $description ... "

    result=$(eval "$command" 2>/dev/null)

    if echo "$result" | grep -q "$expected"; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAIL++))
        return 1
    fi
}

# Test backend
echo "🔧 Backend Tests"
echo "----------------"

test_step "Backend is responding" \
    "curl -s http://localhost:8000/" \
    "Video Editor API"

test_step "Backend API endpoint (/api/hello)" \
    "curl -s http://localhost:8000/api/hello" \
    "Hello from FastAPI"

test_step "Backend returns valid JSON" \
    "curl -s http://localhost:8000/api/hello | python3 -m json.tool" \
    "timestamp"

test_step "Backend status endpoint" \
    "curl -s http://localhost:8000/api/status" \
    "healthy"

test_step "Backend has CORS headers" \
    "curl -sI http://localhost:8000/api/hello | grep -i access-control" \
    "access-control-allow-origin"

echo ""

# Test frontend
echo "🎨 Frontend Tests"
echo "-----------------"

test_step "Frontend is serving content" \
    "curl -s http://localhost:5173/" \
    "Video Editor"

test_step "Frontend has root element" \
    "curl -s http://localhost:5173/" \
    '<div id="root">'

test_step "Frontend loads Vite dev server" \
    "curl -s http://localhost:5173/" \
    "/@vite/client"

echo ""

# Test integration
echo "🔗 Integration Tests"
echo "--------------------"

# Test if backend returns timestamp (indicates it's working)
if curl -s http://localhost:8000/api/hello | grep -q "timestamp"; then
    echo -e "Backend data structure: ${GREEN}✓ PASS${NC}"
    ((PASS++))
else
    echo -e "Backend data structure: ${RED}✗ FAIL${NC}"
    ((FAIL++))
fi

# Test response time
echo -n "Backend response time ... "
START=$(date +%s.%N)
curl -s http://localhost:8000/api/hello > /dev/null
END=$(date +%s.%N)
DIFF=$(echo "$END - $START" | bc)
if (( $(echo "$DIFF < 1.0" | bc -l) )); then
    echo -e "${GREEN}✓ PASS${NC} (${DIFF}s)"
    ((PASS++))
else
    echo -e "${YELLOW}⚠ SLOW${NC} (${DIFF}s)"
    ((PASS++))
fi

echo ""

# Summary
echo "📊 Summary"
echo "----------"
echo -e "Passed: ${GREEN}${PASS}${NC}"
echo -e "Failed: ${RED}${FAIL}${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed! Your project is running correctly.${NC}"
    echo ""
    echo "🌐 Access your application:"
    echo "   Frontend: http://localhost:5173"
    echo "   Backend:  http://localhost:8000"
    echo "   API Docs: http://localhost:8000/docs"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Please check the following:${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Make sure backend is running:"
    echo "   cd backend && source venv/bin/activate && ./run.sh"
    echo ""
    echo "2. Make sure frontend is running:"
    echo "   cd frontend && npm run dev"
    echo ""
    echo "3. Check for port conflicts:"
    echo "   lsof -i :8000  # backend"
    echo "   lsof -i :5173  # frontend"
    echo ""
    exit 1
fi
