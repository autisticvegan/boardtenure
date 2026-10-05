"""Print the visible text of a cached filing (the same text quote verification uses).

Usage (from the pipeline venv):
  uv --directory pipeline run python ../scripts/sec_text.py PATH                  # whole document
  uv --directory pipeline run python ../scripts/sec_text.py PATH -g 'Director since' -C 3   # grep with context
"""

import argparse
import re
from pathlib import Path

from bt.text import document_text

p = argparse.ArgumentParser()
p.add_argument("path")
p.add_argument("-g", "--grep", help="case-insensitive regex; print matching lines only")
p.add_argument("-C", "--context", type=int, default=0, help="lines of context around matches")
a = p.parse_args()

path = Path(a.path)
lines = document_text(path.read_bytes(), path.name).splitlines()
if not a.grep:
    print("\n".join(lines))
else:
    rx = re.compile(a.grep, re.I)
    shown = set()
    for i, line in enumerate(lines):
        if rx.search(line):
            for j in range(max(0, i - a.context), min(len(lines), i + a.context + 1)):
                if j not in shown:
                    print(f"{j}: {lines[j]}")
                    shown.add(j)
            print("--")
