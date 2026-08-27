// VYUHA — draw your data structures from C++.
//
// The protocol is one printed line, so this header is a convenience:
//
//     std::cout << "@vyuha {\"array\":[3,1,2],\"active\":[0]}\n";
//
// Usage:
//     #include "vyuha.hpp"
//     vyuha::array(a, {i, j}, "bubble sort", "pass " + std::to_string(p));
//
// Header only. C++11 or newer.

#ifndef VYUHA_HPP
#define VYUHA_HPP

#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <utility>

namespace vyuha {

inline std::string esc(const std::string& s) {
    std::ostringstream o;
    for (char c : s) {
        switch (c) {
            case '"':  o << "\\\""; break;
            case '\\': o << "\\\\"; break;
            case '\n': o << "\\n";  break;
            case '\r': o << "\\r";  break;
            case '\t': o << "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) o << "\\u00" << std::hex << (int)c;
                else o << c;
        }
    }
    return o.str();
}

/** Everything here funnels through this one line. */
inline void emit(const std::string& json) {
    std::cout << "@vyuha " << json << std::endl;
}

namespace detail {

inline std::string meta(const std::string& title, const std::string& note) {
    std::ostringstream o;
    if (!title.empty()) o << ",\"title\":\"" << esc(title) << "\"";
    if (!note.empty())  o << ",\"note\":\"" << esc(note) << "\"";
    return o.str();
}

template <typename T>
std::string numbers(const std::vector<T>& v) {
    std::ostringstream o;
    o << "[";
    for (size_t i = 0; i < v.size(); ++i) { if (i) o << ","; o << v[i]; }
    o << "]";
    return o.str();
}

inline std::string indices(const std::vector<int>& v, const char* key) {
    if (v.empty()) return "";
    std::ostringstream o;
    o << ",\"" << key << "\":[";
    for (size_t i = 0; i < v.size(); ++i) { if (i) o << ","; o << v[i]; }
    o << "]";
    return o.str();
}

} // namespace detail

/* ── array: a row of bars whose heights follow the values ────── */

template <typename T>
void array(const std::vector<T>& values,
           const std::vector<int>& active = {},
           const std::string& title = "",
           const std::string& note = "",
           const std::vector<int>& done = {}) {
    std::ostringstream o;
    o << "{\"kind\":\"array\",\"array\":" << detail::numbers(values)
      << detail::meta(title, note)
      << detail::indices(active, "active")
      << detail::indices(done, "done") << "}";
    emit(o.str());
}

/* ── stack, queue, linked list ───────────────────────────────── */

template <typename T>
void sequence(const std::vector<T>& values, const char* kind,
              const std::vector<int>& active = {},
              const std::string& title = "", const std::string& note = "") {
    std::ostringstream o;
    o << "{\"kind\":\"" << kind << "\",\"" << kind << "\":" << detail::numbers(values)
      << detail::meta(title, note) << detail::indices(active, "active") << "}";
    emit(o.str());
}

template <typename T>
void stack(const std::vector<T>& v, const std::string& title = "", const std::string& note = "") {
    sequence(v, "stack", {}, title, note);
}

template <typename T>
void queue(const std::vector<T>& v, const std::string& title = "", const std::string& note = "") {
    sequence(v, "queue", {}, title, note);
}

template <typename T>
void list(const std::vector<T>& v, const std::vector<int>& active = {},
          const std::string& title = "", const std::string& note = "") {
    sequence(v, "list", active, title, note);
}

/* ── matrix ──────────────────────────────────────────────────── */

template <typename T>
void matrix(const std::vector<std::vector<T> >& rows,
            const std::vector<std::string>& active = {},
            const std::string& title = "", const std::string& note = "") {
    std::ostringstream o;
    o << "{\"kind\":\"matrix\",\"matrix\":[";
    for (size_t r = 0; r < rows.size(); ++r) {
        if (r) o << ",";
        o << detail::numbers(rows[r]);
    }
    o << "]" << detail::meta(title, note);
    if (!active.empty()) {
        o << ",\"active\":[";
        for (size_t i = 0; i < active.size(); ++i) {
            if (i) o << ",";
            o << "\"" << esc(active[i]) << "\"";
        }
        o << "]";
    }
    o << "}";
    emit(o.str());
}

/* ── tree ────────────────────────────────────────────────────── */

struct TreeNode {
    std::string value;
    TreeNode* left;
    TreeNode* right;
    std::string state;
    explicit TreeNode(const std::string& v) : value(v), left(0), right(0) {}
};

inline std::string treeJson(const TreeNode* n) {
    if (!n) return "null";
    std::ostringstream o;
    o << "{\"value\":\"" << esc(n->value) << "\"";
    if (!n->state.empty()) o << ",\"state\":\"" << esc(n->state) << "\"";
    if (n->left)  o << ",\"left\":"  << treeJson(n->left);
    if (n->right) o << ",\"right\":" << treeJson(n->right);
    o << "}";
    return o.str();
}

inline void tree(const TreeNode* root, const std::string& title = "", const std::string& note = "") {
    std::ostringstream o;
    o << "{\"kind\":\"tree\",\"tree\":" << treeJson(root) << detail::meta(title, note) << "}";
    emit(o.str());
}

/* ── graph ───────────────────────────────────────────────────── */

/** adjacency: node -> list of (neighbour, weight). Weight 0 draws unlabelled. */
inline void graph(const std::map<std::string, std::vector<std::pair<std::string, double> > >& adj,
                  const std::vector<std::string>& active = {},
                  const std::string& title = "", const std::string& note = "",
                  bool directed = true) {
    std::ostringstream o;
    o << "{\"kind\":\"graph\",\"directed\":" << (directed ? "true" : "false") << ",\"adjacency\":{";
    bool first = true;
    for (std::map<std::string, std::vector<std::pair<std::string, double> > >::const_iterator
             it = adj.begin(); it != adj.end(); ++it) {
        if (!first) o << ",";
        first = false;
        o << "\"" << esc(it->first) << "\":[";
        for (size_t i = 0; i < it->second.size(); ++i) {
            if (i) o << ",";
            if (it->second[i].second != 0.0)
                o << "[\"" << esc(it->second[i].first) << "\"," << it->second[i].second << "]";
            else
                o << "\"" << esc(it->second[i].first) << "\"";
        }
        o << "]";
    }
    o << "}" << detail::meta(title, note);
    if (!active.empty()) {
        o << ",\"active\":[";
        for (size_t i = 0; i < active.size(); ++i) {
            if (i) o << ",";
            o << "\"" << esc(active[i]) << "\"";
        }
        o << "]";
    }
    o << "}";
    emit(o.str());
}

} // namespace vyuha

#endif // VYUHA_HPP
