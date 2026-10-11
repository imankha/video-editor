#!/bin/bash
# usage: run.sh NAME  (reads body from stdin)
N=$1; cd "$(dirname "$0")"
{ echo "// $(date +%s%N)"; cat; } > $N.cmd.js
echo PENDING > $N.out.tmp; 
sleep 1.5
for i in $(seq 1 ${2:-90}); do
  if head -c 4 $N.out 2>/dev/null | grep -q DONE && [ $N.out -nt $N.cmd.js ]; then cat $N.out; exit 0; fi
  sleep 1
done
echo "(still running)"; head -c 200 $N.out
