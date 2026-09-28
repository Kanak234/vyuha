/*
 * VYUHA — draw your data structures from C.
 *
 * The protocol is one printed line, so this header is a convenience:
 *
 *     printf("@vyuha {\"array\":[3,1,2],\"active\":[0]}\n");
 *
 * Usage:
 *     #include "vyuha.h"
 *     vyuha_array(a, n, (int[]){i, j}, 2, "bubble sort", "pass 1");
 *
 * Header only. C99 or newer.
 */

#ifndef VYUHA_H
#define VYUHA_H

#include <stdio.h>
#include <string.h>

/*
 * VYUHA 4.1.0 -- source line of the call, for "double-tap a node to open its line".
 * WHY: C has no stack traces, so the line is captured at compile time with
 *      __LINE__ by the macros at the bottom of this header.
 * HOW: each macro sets vyuha__line, then calls the real function; vyuha_close()
 *      writes it into the JSON and resets it to 0, so a call made without the
 *      macro (e.g. through a function pointer) never reuses an old line.
 * NOTE: the line belongs to the file that made the call. If you call the helper
 *      from a second .c file, VYUHA will open that line number in the run file.
 */
static int vyuha__line = 0;

static inline void vyuha_begin(void) { printf("@vyuha "); }
static inline void vyuha_end(void)   { printf("\n"); fflush(stdout); }

/* Closes the JSON object: adds "line" when a macro captured one. */
static inline void vyuha_close(void) {
    if (vyuha__line > 0) printf(",\"line\":%d", vyuha__line);
    vyuha__line = 0;
    putchar('}');
    vyuha_end();
}

static inline void vyuha_str(const char *s) {
    putchar('"');
    for (; s && *s; ++s) {
        if (*s == '"' || *s == '\\') { putchar('\\'); putchar(*s); }
        else if (*s == '\n') { fputs("\\n", stdout); }
        else if ((unsigned char)*s < 0x20) { printf("\\u%04x", (unsigned char)*s); }
        else putchar(*s);
    }
    putchar('"');
}

static inline void vyuha_meta(const char *title, const char *note) {
    if (title && *title) { fputs(",\"title\":", stdout); vyuha_str(title); }
    if (note  && *note)  { fputs(",\"note\":",  stdout); vyuha_str(note);  }
}

static inline void vyuha_idx(const char *key, const int *v, int n) {
    int i;
    if (!v || n <= 0) return;
    printf(",\"%s\":[", key);
    for (i = 0; i < n; ++i) printf(i ? ",%d" : "%d", v[i]);
    putchar(']');
}

/* ── array: a row of bars whose heights follow the values ────── */
static inline void vyuha_array(const int *values, int n,
                        const int *active, int na,
                        const char *title, const char *note) {
    int i;
    vyuha_begin();
    fputs("{\"kind\":\"array\",\"array\":[", stdout);
    for (i = 0; i < n; ++i) printf(i ? ",%d" : "%d", values[i]);
    putchar(']');
    vyuha_meta(title, note);
    vyuha_idx("active", active, na);
    vyuha_close();
}

/* ── stack / queue / linked list ─────────────────────────────── */
static inline void vyuha_sequence(const char *kind, const int *values, int n,
                           const int *active, int na,
                           const char *title, const char *note) {
    int i;
    vyuha_begin();
    printf("{\"kind\":\"%s\",\"%s\":[", kind, kind);
    for (i = 0; i < n; ++i) printf(i ? ",%d" : "%d", values[i]);
    putchar(']');
    vyuha_meta(title, note);
    vyuha_idx("active", active, na);
    vyuha_close();
}

static inline void vyuha_list(const int *v, int n, const int *active, int na,
                       const char *title, const char *note) {
    vyuha_sequence("list", v, n, active, na, title, note);
}
static inline void vyuha_stack(const int *v, int n, const char *title, const char *note) {
    vyuha_sequence("stack", v, n, 0, 0, title, note);
}
static inline void vyuha_queue(const int *v, int n, const char *title, const char *note) {
    vyuha_sequence("queue", v, n, 0, 0, title, note);
}

/* ── matrix ──────────────────────────────────────────────────── */
static inline void vyuha_matrix(const int *cells, int rows, int cols,
                         const char *title, const char *note) {
    int r, c;
    vyuha_begin();
    fputs("{\"kind\":\"matrix\",\"matrix\":[", stdout);
    for (r = 0; r < rows; ++r) {
        if (r) putchar(',');
        putchar('[');
        for (c = 0; c < cols; ++c) printf(c ? ",%d" : "%d", cells[r * cols + c]);
        putchar(']');
    }
    putchar(']');
    vyuha_meta(title, note);
    vyuha_close();
}

/*
 * ── graph ────────────────────────────────────────────────────
 * Edges as flat triples: from, to, weight (weight 0 = unlabelled).
 * Node names are the integers themselves.
 */
static inline void vyuha_graph(int node_count, const int *edges, int edge_count,
                        const int *active, int na,
                        const char *title, const char *note) {
    int i;
    vyuha_begin();
    fputs("{\"kind\":\"graph\",\"nodes\":[", stdout);
    for (i = 0; i < node_count; ++i) printf(i ? ",{\"id\":\"%d\"}" : "{\"id\":\"%d\"}", i);
    fputs("],\"edges\":[", stdout);
    for (i = 0; i < edge_count; ++i) {
        const int *e = edges + i * 3;
        if (i) putchar(',');
        printf("{\"from\":\"%d\",\"to\":\"%d\"", e[0], e[1]);
        if (e[2]) printf(",\"weight\":%d", e[2]);
        putchar('}');
    }
    putchar(']');
    vyuha_meta(title, note);
    vyuha_idx("active", active, na);
    vyuha_close();
}

/*
 * VYUHA 4.1.0 -- call-site macros. Defined AFTER the functions on purpose: a
 * macro named like a function would otherwise rewrite the function definitions
 * above. Inside the macro body the name refers to the real function (the C
 * preprocessor never expands a macro inside its own expansion), so user code
 * keeps calling vyuha_array(...) exactly as before -- now with its line.
 * The comma expression works in C99 and C++ and costs nothing at run time.
 */
#define vyuha_array(...)    (vyuha__line = __LINE__, vyuha_array(__VA_ARGS__))
#define vyuha_sequence(...) (vyuha__line = __LINE__, vyuha_sequence(__VA_ARGS__))
#define vyuha_list(...)     (vyuha__line = __LINE__, vyuha_list(__VA_ARGS__))
#define vyuha_stack(...)    (vyuha__line = __LINE__, vyuha_stack(__VA_ARGS__))
#define vyuha_queue(...)    (vyuha__line = __LINE__, vyuha_queue(__VA_ARGS__))
#define vyuha_matrix(...)   (vyuha__line = __LINE__, vyuha_matrix(__VA_ARGS__))
#define vyuha_graph(...)    (vyuha__line = __LINE__, vyuha_graph(__VA_ARGS__))

#endif /* VYUHA_H */
