package main

// VYUHA — draw your data structures from Go.
//
// The protocol is one printed line, so this file is a convenience:
//
//	fmt.Println(`@vyuha {"array":[3,1,2],"active":[0]}`)
//
// Usage: drop this file next to your program (same package main) and call
//
//	VyuhaArray(a, []int{i, j}, "bubble sort", fmt.Sprintf("pass %d", p))

import (
	"encoding/json"
	"fmt"
	"os"
)

// VyuhaEmit writes one frame. Everything else here funnels through it.
func VyuhaEmit(payload map[string]interface{}) {
	b, err := json.Marshal(payload)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vyuha: could not encode frame:", err)
		return
	}
	fmt.Println("@vyuha " + string(b))
}

func vyuhaMeta(p map[string]interface{}, title, note string, active []int) {
	if title != "" {
		p["title"] = title
	}
	if note != "" {
		p["note"] = note
	}
	if len(active) > 0 {
		p["active"] = active
	}
}

// VyuhaArray draws a row of bars whose heights follow the values.
func VyuhaArray(values []int, active []int, title, note string) {
	p := map[string]interface{}{"kind": "array", "array": values}
	vyuhaMeta(p, title, note, active)
	VyuhaEmit(p)
}

// VyuhaList draws a linked list with arrows between the cells.
func VyuhaList(values []int, active []int, title, note string) {
	p := map[string]interface{}{"kind": "list", "list": values}
	vyuhaMeta(p, title, note, active)
	VyuhaEmit(p)
}

// VyuhaStack draws a vertical stack, first element at the bottom.
func VyuhaStack(values []int, title, note string) {
	p := map[string]interface{}{"kind": "stack", "stack": values}
	vyuhaMeta(p, title, note, nil)
	VyuhaEmit(p)
}

// VyuhaQueue draws a queue, front element on the left.
func VyuhaQueue(values []int, title, note string) {
	p := map[string]interface{}{"kind": "queue", "queue": values}
	vyuhaMeta(p, title, note, nil)
	VyuhaEmit(p)
}

// VyuhaMatrix draws a 2D grid. Active cells are "row,col" strings.
func VyuhaMatrix(rows [][]int, active []string, title, note string) {
	p := map[string]interface{}{"kind": "matrix", "matrix": rows}
	vyuhaMeta(p, title, note, nil)
	if len(active) > 0 {
		p["active"] = active
	}
	VyuhaEmit(p)
}

// VyuhaTreeNode is a binary node for VyuhaTree.
type VyuhaTreeNode struct {
	Value interface{}    `json:"value"`
	State string         `json:"state,omitempty"`
	Left  *VyuhaTreeNode `json:"left,omitempty"`
	Right *VyuhaTreeNode `json:"right,omitempty"`
}

// VyuhaTree draws a tree laid out by depth.
func VyuhaTree(root *VyuhaTreeNode, title, note string) {
	p := map[string]interface{}{"kind": "tree", "tree": root}
	vyuhaMeta(p, title, note, nil)
	VyuhaEmit(p)
}

// VyuhaGraph draws a graph from neighbour lists.
// A neighbour may be a plain string, or []interface{}{"b", 4} for a weight.
func VyuhaGraph(adjacency map[string][]interface{}, active []string, directed bool, title, note string) {
	p := map[string]interface{}{"kind": "graph", "adjacency": adjacency, "directed": directed}
	vyuhaMeta(p, title, note, nil)
	if len(active) > 0 {
		p["active"] = active
	}
	VyuhaEmit(p)
}

// VyuhaFrame gives full control: supply the nodes and edges yourself.
func VyuhaFrame(kind string, nodes, edges []interface{}, title, note string) {
	p := map[string]interface{}{"kind": kind, "nodes": nodes, "edges": edges}
	vyuhaMeta(p, title, note, nil)
	VyuhaEmit(p)
}
