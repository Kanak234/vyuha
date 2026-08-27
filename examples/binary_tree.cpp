/*
 * Binary tree — built from preorder and inorder, then walked three ways.
 *
 * This is the ordinary coursework program with one addition: at each step it
 * prints a line describing the tree as it currently stands. VYUHA picks those
 * lines up and draws them, so the recursion becomes something you watch rather
 * than something you trace on paper.
 *
 * Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
 *
 * The tree built here is the classic one:
 *     preorder  A B D H E C F I G J K
 *     inorder   D B H E A I F C J G K
 *
 *              A
 *            /   \
 *           B     C
 *          / \   / \
 *         D   H F   G
 *              \  \  / \
 *               E  I J   K
 *
 * (Read the two traversals carefully and H really is B's right child, with E
 *  hanging off H. The picture the program draws is the one to trust.)
 */

#include <iostream>
#include <string>
#include <vector>
#include <map>
using namespace std;

struct Node {
    char data;
    Node* lchild;
    Node* rchild;
};

Node* createNode(char value) {
    Node* n = new Node;
    n->data = value;
    n->lchild = NULL;
    n->rchild = NULL;
    return n;
}

/* ── drawing ───────────────────────────────────────────────────────
 * One function, one printed line. That is the whole VYUHA protocol:
 *
 *     @vyuha {"kind":"tree","nodes":[...],"edges":[...]}
 *
 * Nothing to link, nothing to install. Any language that can print a line can
 * do this, which is why the same idea works in Python, Java or Go.
 *
 * The tree is kept in a flat list as it is built, so a half-built tree draws
 * correctly — the recursion attaches children on the way back up, and drawing
 * from the root alone would show nothing until the very end.
 */

static string g_nodes;                       // node letters, in creation order
static vector<pair<char, char> > g_edges;    // parent, child

static string state_of(char c, char active, const string& visited) {
    if (c == active) return "active";
    if (visited.find(c) != string::npos) return "visited";
    return "normal";
}

static void draw(char active, const string& visited,
                 const string& title, const string& note) {
    string nodes, edges;
    for (size_t i = 0; i < g_nodes.size(); i++) {
        char c = g_nodes[i];
        if (i) nodes += ",";
        nodes += string("{\"id\":\"") + c + "\",\"label\":\"" + c +
                 "\",\"state\":\"" + state_of(c, active, visited) + "\"}";
    }
    for (size_t i = 0; i < g_edges.size(); i++) {
        if (i) edges += ",";
        edges += string("{\"from\":\"") + g_edges[i].first +
                 "\",\"to\":\"" + g_edges[i].second + "\"}";
    }
    cout << "@vyuha {\"kind\":\"tree\",\"title\":\"" << title
         << "\",\"note\":\"" << note
         << "\",\"nodes\":[" << nodes
         << "],\"edges\":[" << edges << "]}" << endl;
}

/* ── building the tree from its two traversals ─────────────────── */

Node* build(const string& pre, int preStart, int preEnd,
            const string& in, int inStart, int inEnd,
            char parent, const char* side) {
    if (preStart > preEnd || inStart > inEnd) return NULL;

    char value = pre[preStart];
    Node* node = createNode(value);

    g_nodes += value;
    if (parent) g_edges.push_back(make_pair(parent, value));
    draw(value, g_nodes, "building the tree",
         parent ? string(1, value) + " goes " + side + " of " + parent
                : string(1, value) + " is the root");

    int mid = inStart;
    while (in[mid] != value) mid++;
    int leftSize = mid - inStart;

    node->lchild = build(pre, preStart + 1, preStart + leftSize,
                         in, inStart, mid - 1, value, "left");
    node->rchild = build(pre, preStart + leftSize + 1, preEnd,
                         in, mid + 1, inEnd, value, "right");
    return node;
}

/* ── the three walks ───────────────────────────────────────────── */

void preorder(Node* root, string& seen) {
    if (!root) return;
    seen += root->data;
    draw(root->data, seen, "preorder", string("visit ") + root->data + "   root, left, right");
    preorder(root->lchild, seen);
    preorder(root->rchild, seen);
}

void inorder(Node* root, string& seen) {
    if (!root) return;
    inorder(root->lchild, seen);
    seen += root->data;
    draw(root->data, seen, "inorder", string("visit ") + root->data + "   left, root, right");
    inorder(root->rchild, seen);
}

void postorder(Node* root, string& seen) {
    if (!root) return;
    postorder(root->lchild, seen);
    postorder(root->rchild, seen);
    seen += root->data;
    draw(root->data, seen, "postorder", string("visit ") + root->data + "   left, right, root");
}

int main() {
    string pre = "ABDHECFIGJK";
    string in  = "DBHEAIFCJGK";

    cout << "preorder given : " << pre << endl;
    cout << "inorder  given : " << in << endl << endl;

    Node* root = build(pre, 0, (int)pre.size() - 1, in, 0, (int)in.size() - 1, 0, "");

    // Each walk collects its letters and prints them once, so the terminal
    // stays readable while the panel does the animating.
    string seen;
    seen.clear();  preorder(root, seen);   cout << "preorder  : " << seen << endl;
    seen.clear();  inorder(root, seen);    cout << "inorder   : " << seen << endl;
    seen.clear();  postorder(root, seen);  cout << "postorder : " << seen << endl;

    draw(' ', g_nodes, "done", "all three walks finished");
    return 0;
}
