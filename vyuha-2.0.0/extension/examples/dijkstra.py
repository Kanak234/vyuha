"""
VYUHA example — Dijkstra's shortest path, one frame per settled node.

Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
"""

import heapq
from vyuha import graph

WEIGHTS = {
    "A": [("B", 4), ("C", 2)],
    "B": [("C", 5), ("D", 10)],
    "C": [("E", 3)],
    "D": [("F", 11)],
    "E": [("D", 4)],
    "F": [],
}

dist = {n: float("inf") for n in WEIGHTS}
dist["A"] = 0
visited = []
heap = [(0, "A")]

graph(WEIGHTS, active=["A"], title="Dijkstra", note="start at A")

while heap:
    d, node = heapq.heappop(heap)
    if node in visited:
        continue
    visited.append(node)
    graph(WEIGHTS, active=[node], visited=visited,
          title="Dijkstra", note=f"settled {node} at distance {d}")
    for nb, w in WEIGHTS[node]:
        if d + w < dist[nb]:
            dist[nb] = d + w
            heapq.heappush(heap, (dist[nb], nb))

graph(WEIGHTS, visited=visited, title="Dijkstra",
      note="  ".join(f"{k}={v}" for k, v in sorted(dist.items())))
