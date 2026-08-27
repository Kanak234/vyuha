"""
VYUHA example — building a binary search tree, one frame per insert.

Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
"""

from vyuha import tree


class Node:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None
        self.state = "normal"


def insert(root, value):
    if root is None:
        return Node(value)
    node = root
    while True:
        node.state = "active"
        tree(root, title="binary search tree", note=f"inserting {value} · at {node.value}")
        node.state = "visited"
        if value < node.value:
            if node.left is None:
                node.left = Node(value)
                break
            node = node.left
        else:
            if node.right is None:
                node.right = Node(value)
                break
            node = node.right
    return root


def settle(node):
    if node is None:
        return
    node.state = "done"
    settle(node.left)
    settle(node.right)


root = None
for v in [50, 30, 70, 20, 40, 60, 80, 35, 65, 10]:
    if root is None:
        root = Node(v)
        tree(root, title="binary search tree", note=f"root {v}")
        continue
    root = insert(root, v)
    tree(root, title="binary search tree", note=f"inserted {v}")

settle(root)
tree(root, title="binary search tree", note="10 keys, height 4")
