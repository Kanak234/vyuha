"""
VYUHA example — recursion drawn automatically as a call tree.

Just decorate a recursive function with @recursive and run it with
VYUHA: Run and Visualize (Ctrl+Alt+V). You do not draw anything yourself —
each call appears as a node the moment it is entered, turns active while it
runs, and settles carrying its return value as the recursion unwinds.

Try the timeline afterwards: play it, or step frame by frame to watch the
tree grow and collapse. Export GIF turns the whole thing into an animation.
"""

from vyuha import recursive


@recursive(name="fibonacci(6)")
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


if __name__ == "__main__":
    print("fib(6) =", fib(6))


# ── want mutual recursion? share one tracer between both functions ──
#
#     from vyuha import RecursionTracer
#     t = RecursionTracer("even/odd")
#
#     def is_even(n):
#         cid = t.enter("is_even", (n,), {})
#         r = True if n == 0 else is_odd(n - 1)
#         t.exit(cid, r); return r
#
#     def is_odd(n):
#         cid = t.enter("is_odd", (n,), {})
#         r = False if n == 0 else is_even(n - 1)
#         t.exit(cid, r); return r
#
#     is_even(6)
