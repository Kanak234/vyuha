// VYUHA example — evaluating postfix with a stack, one frame per token.
//
// Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
// Needs vyuha.hpp in the same folder (VYUHA: Add Helper Library).

#include "vyuha.hpp"
#include <vector>
#include <string>
#include <sstream>

int main() {
    const std::string expr = "5 3 + 8 2 - *";
    std::vector<int> stack;
    std::istringstream in(expr);
    std::string tok;

    vyuha::stack(stack, "postfix machine", "evaluating  " + expr);

    while (in >> tok) {
        if (tok == "+" || tok == "-" || tok == "*" || tok == "/") {
            int b = stack.back(); stack.pop_back();
            int a = stack.back(); stack.pop_back();
            int r = tok == "+" ? a + b : tok == "-" ? a - b : tok == "*" ? a * b : a / b;
            stack.push_back(r);
            vyuha::stack(stack, "postfix machine", "apply " + tok + " -> " + std::to_string(r));
        } else {
            stack.push_back(std::atoi(tok.c_str()));
            vyuha::stack(stack, "postfix machine", "push " + tok);
        }
    }

    vyuha::stack(stack, "postfix machine", "result " + std::to_string(stack.back()));
    return 0;
}
