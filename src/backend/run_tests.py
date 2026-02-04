#!/usr/bin/env python
"""
Run all backend pytest tests.

This script exists because:
1. `pytest tests/` only discovers tests in tests/integration/, not tests/test_*.py
2. Direct pytest invocation has stdout capture issues in some shells

Usage:
    cd src/backend
    .venv/Scripts/python.exe run_tests.py
    # or: python run_tests.py (if venv is activated)
"""
import subprocess
import sys
import glob
import os

# Ensure we're in the backend directory
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

# Find all test files explicitly
test_files = glob.glob("tests/test_*.py")
print(f"Running {len(test_files)} test files...")

# Run pytest with capture=sys to avoid closed file handle issues
result = subprocess.run(
    [sys.executable, "-m", "pytest"] + test_files + ["-v", "--tb=short", "--capture=sys"],
    capture_output=True,
    text=True,
)

# Output results
print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr, file=sys.stderr)

sys.exit(result.returncode)
