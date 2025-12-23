#!/bin/bash
# API Integration Tests for Video Editor Backend
# Uses isolated test data and cleans up after completion

# Don't exit on first error - we want to run all tests

API_BASE="http://localhost:8000"
TEST_PREFIX="__TEST__"
PASSED=0
FAILED=0
TEST_PROJECT_IDS=()
TEST_CLIP_IDS=()

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test result tracking
pass_test() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASSED++))
}

fail_test() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo -e "  ${YELLOW}Expected${NC}: $2"
    echo -e "  ${YELLOW}Got${NC}: $3"
    ((FAILED++))
}

# Create a small test video file
create_test_video() {
    local output="$1"
    ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v libx264 -pix_fmt yuv420p "$output" 2>/dev/null
}

# ============================================================
# CLEANUP FUNCTION - Run at start and end
# ============================================================
cleanup() {
    echo ""
    echo "=========================================="
    echo "Cleaning up test data..."
    echo "=========================================="

    # Delete all test projects (this will cascade to working_clips via soft delete)
    for project_id in "${TEST_PROJECT_IDS[@]}"; do
        curl -s -X DELETE "$API_BASE/api/projects/$project_id" > /dev/null 2>&1 || true
    done

    # Clean up test video file
    rm -f /tmp/test_video.mp4 2>/dev/null || true

    echo "Cleanup complete."
}

# Trap to ensure cleanup runs even on error
trap cleanup EXIT

# ============================================================
# HEALTH CHECK TESTS
# ============================================================
test_health() {
    echo ""
    echo "=========================================="
    echo "Testing Health Endpoints"
    echo "=========================================="

    # Test root endpoint
    response=$(curl -s "$API_BASE/")
    if echo "$response" | grep -q "Video Editor API"; then
        pass_test "GET / - Root endpoint"
    else
        fail_test "GET / - Root endpoint" "Contains 'Video Editor API'" "$response"
    fi

    # Test /api/status endpoint
    response=$(curl -s "$API_BASE/api/status")
    if echo "$response" | grep -q '"status":"healthy"'; then
        pass_test "GET /api/status - Health check"
    else
        fail_test "GET /api/status - Health check" "status: healthy" "$response"
    fi

    # Test /api/health endpoint with db status
    response=$(curl -s "$API_BASE/api/health")
    if echo "$response" | grep -q '"db_initialized":true'; then
        pass_test "GET /api/health - Database initialized"
    else
        fail_test "GET /api/health - Database initialized" "db_initialized: true" "$response"
    fi
}

# ============================================================
# PROJECT CRUD TESTS
# ============================================================
test_projects() {
    echo ""
    echo "=========================================="
    echo "Testing Project Endpoints"
    echo "=========================================="

    # Create project
    response=$(curl -s -X POST "$API_BASE/api/projects" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${TEST_PREFIX}Project1\", \"aspect_ratio\": \"16:9\"}")

    project_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

    if [ -n "$project_id" ] && echo "$response" | grep -q "\"name\":\"${TEST_PREFIX}Project1\""; then
        pass_test "POST /api/projects - Create project"
        TEST_PROJECT_IDS+=("$project_id")
    else
        fail_test "POST /api/projects - Create project" "Valid project with ID" "$response"
        return 1
    fi

    # List projects
    response=$(curl -s "$API_BASE/api/projects")
    if echo "$response" | grep -q "${TEST_PREFIX}Project1"; then
        pass_test "GET /api/projects - List projects"
    else
        fail_test "GET /api/projects - List projects" "Contains test project" "$response"
    fi

    # Get single project
    response=$(curl -s "$API_BASE/api/projects/$project_id")
    if echo "$response" | grep -q "\"id\":$project_id"; then
        pass_test "GET /api/projects/{id} - Get project detail"
    else
        fail_test "GET /api/projects/{id} - Get project detail" "Project with id $project_id" "$response"
    fi

    # Update project
    response=$(curl -s -X PUT "$API_BASE/api/projects/$project_id" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${TEST_PREFIX}UpdatedProject\", \"aspect_ratio\": \"9:16\"}")

    if echo "$response" | grep -q '"success":true'; then
        pass_test "PUT /api/projects/{id} - Update project"
    else
        fail_test "PUT /api/projects/{id} - Update project" "success: true" "$response"
    fi

    # Verify update
    response=$(curl -s "$API_BASE/api/projects/$project_id")
    if echo "$response" | grep -q "${TEST_PREFIX}UpdatedProject" && echo "$response" | grep -q '"aspect_ratio":"9:16"'; then
        pass_test "GET /api/projects/{id} - Verify update"
    else
        fail_test "GET /api/projects/{id} - Verify update" "Updated name and aspect ratio" "$response"
    fi

    # Test invalid aspect ratio
    response=$(curl -s -X POST "$API_BASE/api/projects" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${TEST_PREFIX}Invalid\", \"aspect_ratio\": \"invalid\"}")

    if echo "$response" | grep -q "Invalid aspect ratio"; then
        pass_test "POST /api/projects - Reject invalid aspect ratio"
    else
        fail_test "POST /api/projects - Reject invalid aspect ratio" "Error message" "$response"
    fi

    # Test 404 for non-existent project
    response=$(curl -s "$API_BASE/api/projects/99999")
    if echo "$response" | grep -q "not found"; then
        pass_test "GET /api/projects/99999 - Return 404"
    else
        fail_test "GET /api/projects/99999 - Return 404" "Not found error" "$response"
    fi
}

# ============================================================
# CLIPS API TESTS
# ============================================================
test_clips() {
    echo ""
    echo "=========================================="
    echo "Testing Clips Endpoints"
    echo "=========================================="

    # Create a project for clip tests
    response=$(curl -s -X POST "$API_BASE/api/projects" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${TEST_PREFIX}ClipProject\", \"aspect_ratio\": \"16:9\"}")

    project_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
    TEST_PROJECT_IDS+=("$project_id")

    if [ -z "$project_id" ]; then
        fail_test "Setup - Create project for clips" "Valid project ID" "$response"
        return 1
    fi

    # Create test video
    create_test_video "/tmp/test_video.mp4"

    # Test raw clips list (should be empty or have existing clips)
    response=$(curl -s "$API_BASE/api/clips/raw")
    if echo "$response" | grep -q '^\['; then
        pass_test "GET /api/clips/raw - List raw clips"
    else
        fail_test "GET /api/clips/raw - List raw clips" "Array response" "$response"
    fi

    # Upload clip to project
    response=$(curl -s -X POST "$API_BASE/api/clips/projects/$project_id/clips" \
        -F "file=@/tmp/test_video.mp4")

    clip1_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

    if [ -n "$clip1_id" ] && echo "$response" | grep -q '"progress":0'; then
        pass_test "POST /api/clips/projects/{id}/clips - Upload clip"
        TEST_CLIP_IDS+=("$clip1_id")
    else
        fail_test "POST /api/clips/projects/{id}/clips - Upload clip" "Clip with ID and progress=0" "$response"
    fi

    # List project clips
    response=$(curl -s "$API_BASE/api/clips/projects/$project_id/clips")
    if echo "$response" | grep -q "\"id\":$clip1_id"; then
        pass_test "GET /api/clips/projects/{id}/clips - List clips"
    else
        fail_test "GET /api/clips/projects/{id}/clips - List clips" "Clip in list" "$response"
    fi

    # Upload second clip for reorder test
    response=$(curl -s -X POST "$API_BASE/api/clips/projects/$project_id/clips" \
        -F "file=@/tmp/test_video.mp4")

    clip2_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

    if [ -n "$clip2_id" ] && echo "$response" | grep -q '"sort_order":1'; then
        pass_test "POST /api/clips/projects/{id}/clips - Second clip auto-ordered"
        TEST_CLIP_IDS+=("$clip2_id")
    else
        fail_test "POST /api/clips/projects/{id}/clips - Second clip auto-ordered" "sort_order: 1" "$response"
    fi

    # Update clip progress
    response=$(curl -s -X PUT "$API_BASE/api/clips/projects/$project_id/clips/$clip1_id" \
        -H "Content-Type: application/json" \
        -d '{"progress": 1}')

    if echo "$response" | grep -q '"success":true'; then
        pass_test "PUT /api/clips/projects/{id}/clips/{cid} - Update progress"
    else
        fail_test "PUT /api/clips/projects/{id}/clips/{cid} - Update progress" "success: true" "$response"
    fi

    # Verify progress update
    response=$(curl -s "$API_BASE/api/clips/projects/$project_id/clips")
    if echo "$response" | grep -q "\"id\":$clip1_id" && echo "$response" | grep -q '"progress":1'; then
        pass_test "GET /api/clips/projects/{id}/clips - Verify progress updated"
    else
        fail_test "GET /api/clips/projects/{id}/clips - Verify progress updated" "progress: 1 for clip $clip1_id" "$response"
    fi

    # Test reorder clips
    response=$(curl -s -X PUT "$API_BASE/api/clips/projects/$project_id/clips/reorder" \
        -H "Content-Type: application/json" \
        -d "[$clip2_id, $clip1_id]")

    if echo "$response" | grep -q '"success":true'; then
        pass_test "PUT /api/clips/projects/{id}/clips/reorder - Reorder clips"
    else
        fail_test "PUT /api/clips/projects/{id}/clips/reorder - Reorder clips" "success: true" "$response"
    fi

    # Verify reorder
    response=$(curl -s "$API_BASE/api/clips/projects/$project_id/clips")
    # Clip2 should now be first (sort_order: 0)
    first_clip_id=$(echo "$response" | grep -o '"id":[0-9]*,"project_id":[0-9]*,"raw_clip_id":null,"uploaded_filename":"[^"]*","filename":"[^"]*","progress":[0-9]*,"sort_order":0' | grep -o '"id":[0-9]*' | cut -d':' -f2)

    if [ "$first_clip_id" = "$clip2_id" ]; then
        pass_test "GET /api/clips/projects/{id}/clips - Verify reorder"
    else
        fail_test "GET /api/clips/projects/{id}/clips - Verify reorder" "clip2 ($clip2_id) first" "First clip: $first_clip_id"
    fi

    # Test file streaming
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/clips/projects/$project_id/clips/$clip1_id/file")
    if [ "$http_code" = "200" ]; then
        pass_test "GET /api/clips/projects/{id}/clips/{cid}/file - Stream clip"
    else
        fail_test "GET /api/clips/projects/{id}/clips/{cid}/file - Stream clip" "HTTP 200" "HTTP $http_code"
    fi

    # Test delete clip
    response=$(curl -s -X DELETE "$API_BASE/api/clips/projects/$project_id/clips/$clip1_id")
    if echo "$response" | grep -q '"success":true'; then
        pass_test "DELETE /api/clips/projects/{id}/clips/{cid} - Delete clip"
    else
        fail_test "DELETE /api/clips/projects/{id}/clips/{cid} - Delete clip" "success: true" "$response"
    fi

    # Verify delete (clip should not appear in list)
    response=$(curl -s "$API_BASE/api/clips/projects/$project_id/clips")
    if ! echo "$response" | grep -q "\"id\":$clip1_id"; then
        pass_test "GET /api/clips/projects/{id}/clips - Verify delete"
    else
        fail_test "GET /api/clips/projects/{id}/clips - Verify delete" "Clip $clip1_id not in list" "$response"
    fi

    # Test 404 for non-existent clip
    response=$(curl -s "$API_BASE/api/clips/projects/$project_id/clips/99999/file")
    if echo "$response" | grep -q "not found"; then
        pass_test "GET /api/clips/projects/{id}/clips/99999/file - Return 404"
    else
        fail_test "GET /api/clips/projects/{id}/clips/99999/file - Return 404" "Not found error" "$response"
    fi

    # Test project not found
    response=$(curl -s "$API_BASE/api/clips/projects/99999/clips")
    if echo "$response" | grep -q "not found"; then
        pass_test "GET /api/clips/projects/99999/clips - Project 404"
    else
        fail_test "GET /api/clips/projects/99999/clips - Project 404" "Not found error" "$response"
    fi

    # Test must provide file or raw_clip_id
    response=$(curl -s -X POST "$API_BASE/api/clips/projects/$project_id/clips")
    if echo "$response" | grep -q "Must provide"; then
        pass_test "POST /api/clips/projects/{id}/clips - Require file or raw_clip_id"
    else
        fail_test "POST /api/clips/projects/{id}/clips - Require file or raw_clip_id" "Validation error" "$response"
    fi
}

# ============================================================
# PROJECT PROGRESS TESTS
# ============================================================
test_progress() {
    echo ""
    echo "=========================================="
    echo "Testing Project Progress Calculation"
    echo "=========================================="

    # Create a project
    response=$(curl -s -X POST "$API_BASE/api/projects" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${TEST_PREFIX}ProgressProject\", \"aspect_ratio\": \"16:9\"}")

    project_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
    TEST_PROJECT_IDS+=("$project_id")

    # Create test video if not exists
    if [ ! -f /tmp/test_video.mp4 ]; then
        create_test_video "/tmp/test_video.mp4"
    fi

    # Add 2 clips
    curl -s -X POST "$API_BASE/api/clips/projects/$project_id/clips" -F "file=@/tmp/test_video.mp4" > /dev/null
    curl -s -X POST "$API_BASE/api/clips/projects/$project_id/clips" -F "file=@/tmp/test_video.mp4" > /dev/null

    # Check progress (0 clips framed, 2 total, no final = 0%)
    response=$(curl -s "$API_BASE/api/projects/$project_id")
    progress=$(echo "$response" | grep -o '"progress_percent":[0-9.]*' | cut -d':' -f2)

    if [ "$progress" = "0.0" ] || [ "$progress" = "0" ]; then
        pass_test "Project progress - 0% with no framed clips"
    else
        fail_test "Project progress - 0% with no framed clips" "0.0" "$progress"
    fi

    # Get clip IDs
    clips_response=$(curl -s "$API_BASE/api/clips/projects/$project_id/clips")
    clip_ids=$(echo "$clips_response" | grep -o '"id":[0-9]*' | cut -d':' -f2)
    clip_id_array=($clip_ids)

    # Mark first clip as framed
    curl -s -X PUT "$API_BASE/api/clips/projects/$project_id/clips/${clip_id_array[0]}" \
        -H "Content-Type: application/json" -d '{"progress": 1}' > /dev/null

    # Check progress (1 clip framed, 2 total, no final = 1/3 = 33.3%)
    response=$(curl -s "$API_BASE/api/projects/$project_id")
    progress=$(echo "$response" | grep -o '"progress_percent":[0-9.]*' | cut -d':' -f2)

    if [ "$progress" = "33.3" ]; then
        pass_test "Project progress - 33.3% with 1/2 clips framed"
    else
        fail_test "Project progress - 33.3% with 1/2 clips framed" "33.3" "$progress"
    fi

    # Mark second clip as framed
    curl -s -X PUT "$API_BASE/api/clips/projects/$project_id/clips/${clip_id_array[1]}" \
        -H "Content-Type: application/json" -d '{"progress": 1}' > /dev/null

    # Check progress (2 clips framed, 2 total, no final = 2/3 = 66.7%)
    response=$(curl -s "$API_BASE/api/projects/$project_id")
    progress=$(echo "$response" | grep -o '"progress_percent":[0-9.]*' | cut -d':' -f2)

    if [ "$progress" = "66.7" ]; then
        pass_test "Project progress - 66.7% with 2/2 clips framed"
    else
        fail_test "Project progress - 66.7% with 2/2 clips framed" "66.7" "$progress"
    fi
}

# ============================================================
# DELETE PROJECT TESTS
# ============================================================
test_delete_project() {
    echo ""
    echo "=========================================="
    echo "Testing Project Deletion"
    echo "=========================================="

    # Create a project with clips
    response=$(curl -s -X POST "$API_BASE/api/projects" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${TEST_PREFIX}DeleteProject\", \"aspect_ratio\": \"16:9\"}")

    project_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

    # Add a clip
    if [ ! -f /tmp/test_video.mp4 ]; then
        create_test_video "/tmp/test_video.mp4"
    fi
    curl -s -X POST "$API_BASE/api/clips/projects/$project_id/clips" -F "file=@/tmp/test_video.mp4" > /dev/null

    # Delete project
    response=$(curl -s -X DELETE "$API_BASE/api/projects/$project_id")
    if echo "$response" | grep -q '"success":true'; then
        pass_test "DELETE /api/projects/{id} - Delete project"
    else
        fail_test "DELETE /api/projects/{id} - Delete project" "success: true" "$response"
    fi

    # Verify project is deleted
    response=$(curl -s "$API_BASE/api/projects/$project_id")
    if echo "$response" | grep -q "not found"; then
        pass_test "GET /api/projects/{id} - Verify deleted"
    else
        fail_test "GET /api/projects/{id} - Verify deleted" "Not found error" "$response"
    fi

    # Note: Don't add to TEST_PROJECT_IDS since it's already deleted
}

# ============================================================
# MAIN TEST RUNNER
# ============================================================
main() {
    echo "=========================================="
    echo "Video Editor API Integration Tests"
    echo "=========================================="
    echo "API Base: $API_BASE"
    echo "Test Prefix: $TEST_PREFIX"
    echo ""

    # Check if server is running
    if ! curl -s "$API_BASE/" > /dev/null 2>&1; then
        echo -e "${RED}ERROR: Server is not running at $API_BASE${NC}"
        echo "Please start the server first:"
        echo "  cd src/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000"
        exit 1
    fi

    # Run all tests
    test_health
    test_projects
    test_clips
    test_progress
    test_delete_project

    # Summary
    echo ""
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="
    echo -e "${GREEN}Passed: $PASSED${NC}"
    echo -e "${RED}Failed: $FAILED${NC}"

    total=$((PASSED + FAILED))
    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}All $total tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}$FAILED of $total tests failed${NC}"
        exit 1
    fi
}

# Run main
main
