#!/usr/bin/env python
"""Delete corrupted clips from game 13 (5-star with no tags)."""

import urllib.request
import json

BASE_URL = "http://localhost:8000/api"

def get_json(url):
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())

def delete(url):
    req = urllib.request.Request(url, method='DELETE')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code

# Get game 13 annotations
game = get_json(f"{BASE_URL}/games/13")
annotations = game.get('annotations', [])

# Find 5-star clips with no tags (corrupted from TSV import)
corrupted = [a for a in annotations if a['rating'] == 5 and not a.get('tags')]

print(f"Found {len(corrupted)} corrupted 5-star clips with no tags:")
for c in corrupted:
    print(f"  Clip {c['raw_clip_id']}: {c['start_time']:.0f}s name={c.get('name')!r} notes={c.get('notes')!r}")

if not corrupted:
    print("Nothing to delete!")
    exit(0)

# Get projects to find which ones are linked to these clips
projects = get_json(f"{BASE_URL}/projects")
clip_ids = {c['raw_clip_id'] for c in corrupted}

# Find projects that match "Clip N" pattern (auto-created from corrupted clips)
projects_to_delete = []
for p in projects:
    # Check if project name matches "Clip N" pattern and is from game 13
    if p.get('name', '').startswith('Clip ') and p.get('name', '')[5:].isdigit():
        projects_to_delete.append(p)

print(f"\nFound {len(projects_to_delete)} projects with 'Clip N' names:")
for p in projects_to_delete:
    print(f"  Project {p['id']}: {p['name']}")

# Delete projects first
print("\nDeleting projects...")
for p in projects_to_delete:
    status = delete(f"{BASE_URL}/projects/{p['id']}")
    print(f"  Project {p['id']}: {status}")

# Delete raw clips
print("\nDeleting raw clips...")
for c in corrupted:
    status = delete(f"{BASE_URL}/clips/raw/{c['raw_clip_id']}")
    print(f"  Clip {c['raw_clip_id']}: {status}")

# Verify
print("\nVerifying...")
game = get_json(f"{BASE_URL}/games/13")
remaining_corrupted = [a for a in game.get('annotations', []) if a['rating'] == 5 and not a.get('tags')]
print(f"Remaining corrupted clips: {len(remaining_corrupted)}")
print(f"Total clips now: {game.get('clip_count')}")

print("\nDone!")
