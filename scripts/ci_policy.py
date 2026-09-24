"""Extracted legacy Branch CI selection, before routing improvements."""
import re


def required_jobs(paths):
    jobs = set()
    for path in paths:
        if re.match(r'^(src/frontend/|scripts/|\.github/workflows/branch-ci\.yml)', path):
            jobs.add('frontend')
        if re.match(r'^(src/backend/|\.github/workflows/branch-ci\.yml)', path):
            jobs.add('backend')
    return jobs
