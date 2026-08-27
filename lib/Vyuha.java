import java.util.*;

/**
 * VYUHA — draw your data structures from Java.
 *
 * The protocol is one printed line, so this class is a convenience:
 *
 *     System.out.println("@vyuha {\"array\":[3,1,2],\"active\":[0]}");
 *
 * Usage:
 *     Vyuha.array(a, "bubble sort", "pass " + p, i, j);
 */
public final class Vyuha {

    private Vyuha() {}

    /* ── the one call everything funnels through ─────────────── */

    public static void emit(String json) {
        System.out.println("@vyuha " + json);
        System.out.flush();
    }

    /* ── array ───────────────────────────────────────────────── */

    public static void array(int[] values, int... active) {
        array(values, null, null, active);
    }

    public static void array(int[] values, String title, String note, int... active) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"kind\":\"array\",\"array\":").append(ints(values));
        sb.append(meta(title, note)).append(activeList(active)).append("}");
        emit(sb.toString());
    }

    public static void array(List<?> values, String title, String note, int... active) {
        emit("{\"kind\":\"array\",\"array\":" + list(values) + meta(title, note) + activeList(active) + "}");
    }

    /* ── stack and queue ─────────────────────────────────────── */

    public static void stack(List<?> values, String title, String note) {
        emit("{\"kind\":\"stack\",\"stack\":" + list(values) + meta(title, note) + "}");
    }

    public static void queue(List<?> values, String title, String note) {
        emit("{\"kind\":\"queue\",\"queue\":" + list(values) + meta(title, note) + "}");
    }

    /* ── linked list ─────────────────────────────────────────── */

    public static void linkedList(List<?> values, String title, String note, int... active) {
        emit("{\"kind\":\"list\",\"list\":" + list(values) + meta(title, note) + activeList(active) + "}");
    }

    /* ── matrix ──────────────────────────────────────────────── */

    public static void matrix(int[][] rows, String title, String note, String... active) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < rows.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(ints(rows[i]));
        }
        sb.append(']');
        StringBuilder act = new StringBuilder();
        if (active != null && active.length > 0) {
            act.append(",\"active\":[");
            for (int i = 0; i < active.length; i++) {
                if (i > 0) act.append(',');
                act.append('"').append(esc(active[i])).append('"');
            }
            act.append(']');
        }
        emit("{\"kind\":\"matrix\",\"matrix\":" + sb + meta(title, note) + act + "}");
    }

    /* ── tree ────────────────────────────────────────────────── */

    /** A binary node: give it a value and optional children. */
    public static final class Node {
        public final Object value;
        public Node left, right;
        public String state;
        public Node(Object value) { this.value = value; }
        public Node(Object value, Node left, Node right) {
            this.value = value; this.left = left; this.right = right;
        }
    }

    public static void tree(Node root, String title, String note) {
        emit("{\"kind\":\"tree\",\"tree\":" + treeJson(root) + meta(title, note) + "}");
    }

    private static String treeJson(Node n) {
        if (n == null) return "null";
        StringBuilder sb = new StringBuilder("{\"value\":").append(value(n.value));
        if (n.state != null) sb.append(",\"state\":\"").append(esc(n.state)).append('"');
        if (n.left != null) sb.append(",\"left\":").append(treeJson(n.left));
        if (n.right != null) sb.append(",\"right\":").append(treeJson(n.right));
        return sb.append('}').toString();
    }

    /* ── graph ───────────────────────────────────────────────── */

    /** adjacency: node -> neighbours. Weighted edges use "b:4" as a neighbour. */
    public static void graph(Map<String, List<String>> adjacency,
                             String title, String note, String... active) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, List<String>> e : adjacency.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(esc(e.getKey())).append("\":[");
            for (int i = 0; i < e.getValue().size(); i++) {
                if (i > 0) sb.append(',');
                String nb = e.getValue().get(i);
                int c = nb.lastIndexOf(':');
                if (c > 0 && isNumber(nb.substring(c + 1))) {
                    sb.append("[\"").append(esc(nb.substring(0, c))).append("\",")
                      .append(nb.substring(c + 1)).append(']');
                } else {
                    sb.append('"').append(esc(nb)).append('"');
                }
            }
            sb.append(']');
        }
        sb.append('}');
        StringBuilder act = new StringBuilder();
        if (active != null && active.length > 0) {
            act.append(",\"active\":[");
            for (int i = 0; i < active.length; i++) {
                if (i > 0) act.append(',');
                act.append('"').append(esc(active[i])).append('"');
            }
            act.append(']');
        }
        emit("{\"kind\":\"graph\",\"adjacency\":" + sb + meta(title, note) + act + "}");
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private static String meta(String title, String note) {
        StringBuilder sb = new StringBuilder();
        if (title != null) sb.append(",\"title\":\"").append(esc(title)).append('"');
        if (note != null) sb.append(",\"note\":\"").append(esc(note)).append('"');
        return sb.toString();
    }

    private static String activeList(int[] active) {
        if (active == null || active.length == 0) return "";
        StringBuilder sb = new StringBuilder(",\"active\":[");
        for (int i = 0; i < active.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(active[i]);
        }
        return sb.append(']').toString();
    }

    private static String ints(int[] a) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < a.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(a[i]);
        }
        return sb.append(']').toString();
    }

    private static String list(List<?> a) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < a.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(value(a.get(i)));
        }
        return sb.append(']').toString();
    }

    private static String value(Object v) {
        if (v == null) return "null";
        if (v instanceof Number || v instanceof Boolean) return v.toString();
        return "\"" + esc(v.toString()) + "\"";
    }

    private static boolean isNumber(String s) {
        try { Double.parseDouble(s); return true; } catch (Exception e) { return false; }
    }

    private static String esc(String s) {
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}
