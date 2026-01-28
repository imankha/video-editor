#!/usr/bin/env python
"""Plot average clip ratings by game."""

import sqlite3
import matplotlib.pyplot as plt
from pathlib import Path

db_path = Path(__file__).parent.parent.parent / 'user_data' / 'a' / 'database.sqlite'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Get games with their clips and average ratings
cursor.execute('''
    SELECT g.id, g.name, AVG(rc.rating) as avg_rating, COUNT(rc.id) as clip_count
    FROM games g
    JOIN raw_clips rc ON g.id = rc.game_id
    GROUP BY g.id
    ORDER BY g.id
''')

games = cursor.fetchall()

# Extract dates from game names and create labels
game_data = []
for g in games:
    name = g['name']
    # Extract date like 2025-10-25 from name
    parts = name.split('-')
    date_str = None
    for i, p in enumerate(parts):
        if p == '2025' and i+2 < len(parts):
            date_str = f"{parts[i+1]}/{parts[i+2]}"
            break
    if not date_str:
        date_str = name[:15]

    game_data.append({
        'label': date_str,
        'avg': g['avg_rating'],
        'count': g['clip_count']
    })

# Sort by date
game_data.sort(key=lambda x: x['label'])

labels = [d['label'] for d in game_data]
avgs = [d['avg'] for d in game_data]
counts = [d['count'] for d in game_data]

fig, ax = plt.subplots(figsize=(10, 6))
bars = ax.bar(labels, avgs, color='steelblue', edgecolor='black')

# Add count labels on bars
for bar, count, avg in zip(bars, counts, avgs):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.05,
            f'n={count}', ha='center', va='bottom', fontsize=9)
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height()/2,
            f'{avg:.2f}', ha='center', va='center', fontsize=11, color='white', fontweight='bold')

ax.set_ylabel('Average Rating')
ax.set_xlabel('Game Date (MM/DD)')
ax.set_title('Average Clip Rating by Game')
ax.set_ylim(0, 5.5)
ax.axhline(y=3, color='gray', linestyle='--', alpha=0.5, label='Interesting (3)')
ax.axhline(y=4, color='orange', linestyle='--', alpha=0.5, label='Good (4)')
ax.axhline(y=5, color='green', linestyle='--', alpha=0.5, label='Brilliant (5)')

plt.tight_layout()
output_path = Path(__file__).parent.parent.parent / 'clip_ratings_by_game.png'
plt.savefig(output_path, dpi=150)
print(f'Saved to {output_path}')
conn.close()
