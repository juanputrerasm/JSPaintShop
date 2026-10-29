"""Query the call graph built by postprocess.py.

    python3 tools/re/cg.py calls FUN_00470810
    python3 tools/re/cg.py callers FUN_00477eb0
    python3 tools/re/cg.py tree FUN_00470810        (callees, recursively, inside the game code)
"""
import sys

from recommon import TARGET, call_graph

# the game code, without the MFC and C runtime that follow it
GAME = (0x401000, 0x7fffffff)


def tree(graph, name, depth=0, seen=None):
    seen = set() if seen is None else seen
    print("  " * depth + name + (" (seen)" if name in seen else ""))
    if name in seen:
        return
    seen.add(name)
    for callee in graph["calls"].get(name, []):
        if GAME[0] <= int(callee[4:], 16) < GAME[1]:
            tree(graph, callee, depth + 1, seen)


graph = call_graph()
mode, names = sys.argv[1], sys.argv[2:]
for n in names:
    if mode == "tree":
        tree(graph, n)
    else:
        print(n, mode + ":", " ".join(graph[mode].get(n, [])))
