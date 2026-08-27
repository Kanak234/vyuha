package main

// VYUHA example — the Sieve of Eratosthenes on a grid, one frame per prime.
//
// Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
// Needs vyuha.go in the same folder (VYUHA: Add Helper Library).

import "fmt"

func main() {
	const n = 60
	const cols = 10

	composite := make([]bool, n+1)
	grid := func() [][]int {
		rows := [][]int{}
		for r := 0; r*cols < n; r++ {
			row := []int{}
			for c := 0; c < cols; c++ {
				v := r*cols + c + 1
				if v > n {
					break
				}
				if composite[v] {
					row = append(row, 0)
				} else {
					row = append(row, v)
				}
			}
			rows = append(rows, row)
		}
		return rows
	}

	VyuhaMatrix(grid(), nil, "sieve of eratosthenes", "1 to 60")

	for p := 2; p*p <= n; p++ {
		if composite[p] {
			continue
		}
		for m := p * p; m <= n; m += p {
			composite[m] = true
		}
		VyuhaMatrix(grid(), nil, "sieve of eratosthenes",
			fmt.Sprintf("crossed out the multiples of %d", p))
	}

	primes := []int{}
	for v := 2; v <= n; v++ {
		if !composite[v] {
			primes = append(primes, v)
		}
	}
	VyuhaArray(primes, nil, "sieve of eratosthenes",
		fmt.Sprintf("%d primes below %d", len(primes), n))
}
