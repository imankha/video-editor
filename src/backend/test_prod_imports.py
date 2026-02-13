#!/usr/bin/env python3
"""
Test script to verify app.main can be imported in production mode.

Run this after installing requirements.prod.txt in a fresh venv:
    python -m venv .venv-prod
    .venv-prod/Scripts/pip install -r requirements.prod.txt
    .venv-prod/Scripts/python test_prod_imports.py

If this passes, the app should start on Fly.io.
"""

import os
import sys

# Set production environment
os.environ["MODAL_ENABLED"] = "true"
os.environ["R2_ENABLED"] = "true"
os.environ["ENV"] = "production"

print("Testing production imports...")
print(f"Python: {sys.version}")
print()

# Test 1: Core imports
print("1. Testing core imports...")
try:
    from fastapi import FastAPI
    from starlette.middleware.base import BaseHTTPMiddleware
    import uvicorn
    print("   ✓ FastAPI, Starlette, Uvicorn")
except ImportError as e:
    print(f"   ✗ Failed: {e}")
    sys.exit(1)

# Test 2: Storage imports
print("2. Testing storage imports...")
try:
    import boto3
    print("   ✓ boto3 (R2)")
except ImportError as e:
    print(f"   ✗ Failed: {e}")
    sys.exit(1)

# Test 3: Modal client
print("3. Testing Modal client...")
try:
    import modal
    print("   ✓ modal")
except ImportError as e:
    print(f"   ✗ Failed: {e}")
    sys.exit(1)

# Test 4: OpenCV (headless)
print("4. Testing OpenCV...")
try:
    import cv2
    print(f"   ✓ cv2 (version {cv2.__version__})")
except ImportError as e:
    print(f"   ✗ Failed: {e}")
    sys.exit(1)

# Test 5: Main app import
print("5. Testing app.main import...")
try:
    # This is the critical test - can we import the app?
    from app.main import app
    print("   ✓ app.main imported successfully")
except ImportError as e:
    print(f"   ✗ Failed: {e}")
    print()
    print("   This likely means a module is importing GPU code at the top level.")
    print("   Check the traceback above for the specific import.")
    sys.exit(1)

print()
print("=" * 50)
print("All imports successful! Ready for Fly.io deployment.")
print("=" * 50)
