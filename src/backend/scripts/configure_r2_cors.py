#!/usr/bin/env python3
"""
Configure CORS for R2 bucket to enable proper video streaming.

This script sets up CORS rules that:
1. Allow GET/HEAD requests from the frontend origins
2. Expose headers needed for video streaming (Accept-Ranges, Content-Range, Content-Length)
3. Allow Range header for partial content requests

Run this script once to configure the R2 bucket:
    cd src/backend
    .venv/Scripts/python.exe scripts/configure_r2_cors.py

Requirements:
    - R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET env vars set

Additional R2 Performance Tips:
    1. Use a custom domain for R2 - this enables Cloudflare CDN caching
       (Go to R2 bucket settings > Custom Domains)

    2. Enable Cache Reserve ($5/month) for longer cache retention
       (Cloudflare Dashboard > Caching > Cache Reserve)

    3. Set Cache Rules for video files:
       - Match: URI Path contains "/games/" or "/raw_clips/"
       - Edge TTL: 1 month
       - Browser TTL: 1 week
       (Cloudflare Dashboard > Caching > Cache Rules)
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

def configure_cors():
    """Configure CORS on the R2 bucket."""
    import boto3
    from botocore.config import Config
    from dotenv import load_dotenv

    # Load .env file from project root
    env_path = Path(__file__).parent.parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"Loaded environment from: {env_path}")

    # Load environment variables
    R2_ENDPOINT = os.getenv("R2_ENDPOINT")
    R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
    R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
    R2_BUCKET = os.getenv("R2_BUCKET", "reel-ballers-users")

    if not all([R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY]):
        print("Error: R2 environment variables not set")
        print("Required: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
        sys.exit(1)

    print(f"Configuring CORS for bucket: {R2_BUCKET}")
    print(f"Endpoint: {R2_ENDPOINT}")

    # Create S3 client for R2
    client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"}
        ),
        region_name="auto"
    )

    # CORS configuration for video streaming
    cors_configuration = {
        'CORSRules': [
            {
                # Allow requests from development and production origins
                'AllowedOrigins': [
                    'http://localhost:5173',      # Vite dev server
                    'http://localhost:3000',      # Alternative dev port
                    'https://reelballers.com',    # Production
                    'https://www.reelballers.com', # Production with www
                ],
                # Allow GET for video streaming, HEAD for metadata checks
                'AllowedMethods': ['GET', 'HEAD'],
                # Allow Range header for partial content requests (streaming)
                'AllowedHeaders': ['Range', 'Content-Type', 'Authorization'],
                # Expose headers needed for video streaming
                # - Accept-Ranges: tells browser server supports range requests
                # - Content-Range: tells browser which bytes are being returned
                # - Content-Length: tells browser total file size
                'ExposeHeaders': [
                    'Accept-Ranges',
                    'Content-Range',
                    'Content-Length',
                    'Content-Type',
                    'ETag',
                ],
                # Cache preflight requests for 24 hours
                'MaxAgeSeconds': 86400
            }
        ]
    }

    try:
        # Apply CORS configuration
        client.put_bucket_cors(
            Bucket=R2_BUCKET,
            CORSConfiguration=cors_configuration
        )
        print("CORS configuration applied successfully!")

        # Verify by reading back the configuration
        response = client.get_bucket_cors(Bucket=R2_BUCKET)
        print("\nCurrent CORS rules:")
        for i, rule in enumerate(response.get('CORSRules', []), 1):
            print(f"\nRule {i}:")
            print(f"  AllowedOrigins: {rule.get('AllowedOrigins', [])}")
            print(f"  AllowedMethods: {rule.get('AllowedMethods', [])}")
            print(f"  AllowedHeaders: {rule.get('AllowedHeaders', [])}")
            print(f"  ExposeHeaders: {rule.get('ExposeHeaders', [])}")
            print(f"  MaxAgeSeconds: {rule.get('MaxAgeSeconds', 'not set')}")

    except Exception as e:
        print(f"Error configuring CORS: {e}")
        sys.exit(1)


if __name__ == "__main__":
    configure_cors()
