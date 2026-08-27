"""
VYUHA example — bubble sort, one frame per comparison.

Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)

The helper is optional. This is the entire protocol:
    print('@vyuha ' + json.dumps({"array": a, "active": [i, j]}))
"""

import random
from vyuha import array

a = [random.randint(4, 60) for _ in range(14)]
array(a, title="bubble sort", note="unsorted")

n = len(a)
sorted_tail = []
for end in range(n - 1, 0, -1):
    swapped = False
    for i in range(end):
        array(a, active=[i, i + 1], done=sorted_tail,
              title="bubble sort", note=f"compare {a[i]} and {a[i+1]}")
        if a[i] > a[i + 1]:
            a[i], a[i + 1] = a[i + 1], a[i]
            swapped = True
            array(a, active=[i, i + 1], done=sorted_tail,
                  title="bubble sort", note="swap")
    sorted_tail.append(end)
    if not swapped:
        break

array(a, done=list(range(n)), title="bubble sort", note="sorted")
