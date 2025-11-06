#!/bin/bash
# Generate version info from git

# Get git info
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
COMMIT_FULL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Create version.json
cat > src/version.json << EOF
{
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "commitFull": "$COMMIT_FULL",
  "buildTime": "$TIMESTAMP"
}
EOF

echo "Generated version info:"
cat src/version.json
