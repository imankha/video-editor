#!/usr/bin/env python
"""Clean up a game via API calls."""

import urllib.request
import json
import sys

BASE_URL = "http://localhost:8000/api"

def delete(url):
    req = urllib.request.Request(url, method='DELETE')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code

def get_json(url):
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())

# Get game ID from args or default to 13
game_id = int(sys.argv[1]) if len(sys.argv) > 1 else 13

print(f"Cleaning up game {game_id}...")

# Get game annotations
game = get_json(f"{BASE_URL}/games/{game_id}")
annotations = game.get('annotations', [])
print(f"Found {len(annotations)} clips to delete")

# Get all projects to find ones linked to this game's clips
projects = get_json(f"{BASE_URL}/projects")
clip_ids = {a['raw_clip_id'] for a in annotations}

# Find projects that might be from this game (check by clip ID pattern or name)
# Projects auto-created from 5-star clips will have names like "Clip N" or generated names
projects_to_delete = []
for p in projects:
    # Check if any working clip is from our raw clips
    # For now, delete projects with "Clip N" pattern from this game's clip range
    if p.get('name', '').startswith('Clip '):
        try:
            clip_num = int(p['name'].split()[1])
            if clip_num in clip_ids:
                projects_to_delete.append(p)
        except (ValueError, IndexError):
            pass

# Also check for projects linked via raw_clip auto_project_id
for a in annotations:
    # Find project by checking if clip has auto_project_id
    pass  # We'll delete clips which will handle projects

print(f"Found {len(projects_to_delete)} projects to delete")

# Delete projects first
for p in projects_to_delete:
    print(f"Deleting project {p['id']} ({p['name']})...")
    status = delete(f"{BASE_URL}/projects/{p['id']}")
    print(f"  Status: {status}")

# Delete all raw clips for this game
for a in annotations:
    clip_id = a['raw_clip_id']
    print(f"Deleting raw clip {clip_id}...")
    status = delete(f"{BASE_URL}/clips/raw/{clip_id}")
    print(f"  Status: {status}")

# Verify
print("\nVerifying...")
game = get_json(f"{BASE_URL}/games/{game_id}")
print(f"Game {game_id} clip_count: {game.get('clip_count')}")
print(f"Annotations count: {len(game.get('annotations', []))}")

print("\nDone!")
