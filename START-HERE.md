# VYUHA — START HERE

Sab kuch ek package mein hai. Neeche sab steps hain, shuru se aakhir tak.

---

## STEP 1 — Install (do minute)

Zip ko kholiye, folder mein terminal kholiye, aur:

```bash
cd vyuha
./install.sh
```

Windows par:

```powershell
cd vyuha
.\install.ps1
```

Yeh apne aap sab karta hai — dependencies, three.js, TypeScript compile, chaaron test suites, `.vsix` packaging, aur VS Code mein install. Agar kahin rukega to saaf-saaf batayega kahan.

**Build skip karna ho** to prebuilt file already ready hai:

```bash
code --install-extension vyuha-2.1.0.vsix --force
```

Uske baad **VS Code ko poori tarah band karke dobara kholiye**. Chalta hua window nayi extension load nahi karta.

---

## STEP 2 — Pehli baar chalaiye

1. Koi bhi source file kholiye — Python, C++, Java, jo bhi.
2. **Ctrl+Alt+V** dabaiye. (Ya editor ke upar ▷ button, ya right-click → *Run and Visualize*.)
3. Neeche **terminal** mein program chalega, aur bagal ke panel mein graph banega.

**Aapko kuch bhi likhne ki zaroorat nahi hai.** Sirf `cout << "Hello World"` wala program bhi kuch dikhayega — VYUHA aapki source file padh kar uske functions, loops, if-else, aur print statements nikal leta hai, aur unhe compile → link → run → output ke saath ek graph mein jod deta hai. Program jaise-jaise chalta hai, stage jalte jaate hain aur har print hone wali line apne statement ko roshan kar deti hai.

Compile error aaya to compile wala stage **laal** ho jayega.

Sabse tez shuruaat: `Ctrl+Shift+P` → **VYUHA: Open an Example** → `binary_tree.cpp` → Ctrl+Alt+V. Ye aapka hi binary tree program hai — preorder aur inorder se tree banata hai, teenon traversal karta hai, aur har step par ek frame.

---

## STEP 2.5 — Input lene wale programs

Program terminal mein chalta hai, isliye `cin >>`, `input()`, `Scanner`, `fmt.Scan` sab kaam karte hain — bas terminal mein type kar dijiye, jaise haath se chalate waqt karte hain. Prompt bhi turant dikhta hai, aakhir mein ek saath nahi.

Har baar type nahi karna ho to input ko file mein rakh dijiye — source ke bagal mein `program.stdin`, ya `program.in`, ya `input.txt`. VYUHA khud utha lega.

Terminal nahi chahiye? Settings mein `vyuha.runInTerminal` ko `false` kar dijiye — tab program background mein chalega aur output sirf VYUHA output channel mein aayega.

---

## STEP 3 — Apne code se graph banaiye

Poora protocol yeh ek line hai:

```
@vyuha {"kind":"array","array":[5,3,8],"active":[1]}
```

Jo bhi language stdout par print kar sakti hai, wo supported hai. Koi library zaroori nahi.

Jaise hi aapka program pehli `@vyuha` line print karta hai, VYUHA apna andaza lagana band kar deta hai aur wahi dikhata hai jo aapne kaha. Sirf apne frames chahiye, source-wala graph nahi? `vyuha.autoVisualize` ko `false` kar dijiye.

Aasani ke liye helper de rakhe hain. `Ctrl+Shift+P` → **VYUHA: Add Helper Library** → apni language chuniye. File aapke project mein aa jayegi.

**Python:**
```python
from vyuha import array, tree, graph, linked_list, stack, queue, matrix

for i in range(len(a) - 1):
    array(a, active=[i, i + 1], title="bubble sort", note=f"compare {a[i]} and {a[i+1]}")
```

**JavaScript:**
```javascript
const v = require('./vyuha');
v.array(a, { active: [i, j], title: 'bubble sort' });
```

**Java:**
```java
Vyuha.array(a, "binary search", "probe " + a[mid], lo, mid, hi);
```

**C++:**
```cpp
#include "vyuha.hpp"
vyuha::array(a, {i, j}, "bubble sort", "pass 1");
```

**C:**
```c
#include "vyuha.h"
vyuha_array(a, n, (int[]){i, j}, 2, "bubble sort", "pass 1");
```

**Go:** (vyuha.go same folder mein rakhiye)
```go
VyuhaArray(a, []int{i, j}, "bubble sort", "pass 1")
```

**Koi aur language?** Bas print kar dijiye:
```ruby
puts '@vyuha {"array":[5,3,8],"active":[1]}'
```

---

## STEP 4 — Kya-kya draw hota hai

| kind | dikhta hai |
|---|---|
| `array` | bars ka row — height value ke hisaab se, isliye sorting saaf dikhti hai |
| `list` | linked list, cells ke beech arrows |
| `stack` | vertical column, pehla element neeche |
| `queue` | horizontal, front left mein |
| `matrix` | 2D grid |
| `tree` | depth ke hisaab se, parent apne children ke beech |
| `graph` | force-directed, weighted aur directed edges ke saath |

Rang ka matlab: neela = abhi chhua nahi, amber = abhi dekh rahe hain, violet = dekh chuke, hara = settle ho gaya, laal = problem.

Ye sab payloads chalte hain — jo aasan lage wahi use kijiye:

```jsonc
[5, 3, 8]
{"array": [5,3,8], "active": [1], "done": [2]}
{"matrix": [[1,2],[3,4]], "active": ["0,1"]}
{"list": [1,2,3]}   {"stack": [1,2]}   {"queue": [1,2]}
{"tree": {"value": 5, "left": {"value": 3}, "right": {"value": 8}}}
{"tree": {"value": 1, "children": [{"value": 2}]}}
{"adjacency": {"a": ["b"], "b": [["c", 4]]}}
{"nodes": [{"id":"x","state":"active"}], "edges": [{"from":"x","to":"y"}]}
```

Har payload mein `title`, `note` aur `line` bhi de sakte hain. `line` dene par node par click karne se seedha us line par pahunch jayenge.

---

## STEP 5 — Timeline

Har print ki hui line ek frame hai. Panel ke neeche:

- **Play / Pause** — ya `Space`
- **◀ ▶** — ek frame aage-peeche, ya `←` `→`
- **Scrub bar** — kahin bhi kood jaiye
- **Hold** — har frame kitni der ruke
- Sidebar mein saare frames list hote hain; kisi par click kijiye, wahi frame khul jayega

---

## STEP 6 — Language add karna

52 extensions pehle se mapped hain. Kuch chhoot gaya ho ya alag command chahiye:

Settings → `vyuha.runners`:

```json
{
  "kt": "kotlin \"${file}\"",
  "py": "conda run -n ml python -u \"${file}\"",
  "myext": "mytool run \"${file}\""
}
```

Placeholders: `${file}` `${dir}` `${fileBasename}` `${fileBasenameNoExt}` `${bin}`

`${bin}` compiled languages ke liye hai — temp executable ka path.

---

## STEP 7 — Kuch na dikhe to

**Panel kaala hai.** `Help → Toggle Developer Tools` → Console. Renderer ab apni error khud report karta hai, to VS Code notification aayegi. Nahi to `code --ignore-gpu-blocklist` se VS Code chalaiye, ya settings mein `vyuha.glow` band kar dijiye.

**Sirf stages dikhe, data structure nahi.** Ye galti nahi hai — aapke program ne koi `@vyuha` line print nahi ki, isliye VYUHA ne aapki source file padh kar uska dhaancha dikhaya. Linked list ya tree dekhna ho to Step 3 ke hisaab se print kijiye.

**Program input maang raha hai aur ruk gaya.** Terminal mein click karke jawab type kar dijiye. Ya `program.stdin` file bana dijiye (Step 2.5).

**Command hi nahi mila.** Us extension ke liye runner set nahi hai. VYUHA khud pooch lega ki add karna hai ya nahi.

**Program atak gaya.** `Ctrl+Alt+X` — terminal mein Ctrl+C bhej diya jayega. 120 second baad VYUHA yaad bhi dila dega (`vyuha.runTimeout`).

**Bahut zyada frames.** Default cap 2000 hai. `vyuha.maxFrames` badha dijiye, ya loop mein kam print kijiye.

---

## STEP 8 — Neural network wala hissa

Purana feature waisa hi hai, bas naam badal gaya. `.vyuha.json` ya `.netgraph.json` file kholiye — signal har layer se guzarta hai, decision lock hota hai, aur jis raste se aaya wo trace hota hai.

`Ctrl+Shift+P` → **VYUHA: New Network Spec File** se naya banaiye. Save karte waqt naam ke aakhir mein `.vyuha.json` zaroor rakhiye.

ERA se jodna ho to `vyuha.traceEndpoint` ko apne router par point kar dijiye — `{"act": [...], "probs": [...]}` return kariye, aur graph asli activations dikhane lagega.

---

## STEP 9 — Marketplace par publish (optional)

Abhi extension sirf aapki machine par hai. Duniya ko dena ho:

**9a. GitHub repo banaiye.** `package.json` mein `https://github.com/Kanak234/vyuha` likha hai. Ya to wo repo banakar push kijiye, ya `repository`, `bugs`, `homepage` fields badal dijiye.

**9b. Azure DevOps account** — dev.azure.com par sign in kijiye (Microsoft account se).

**9c. Personal Access Token** — upar right mein User settings → Personal access tokens → New Token.
- Organization: **All accessible organizations**
- Scopes: **Custom defined** → Marketplace → **Manage**
- Token sirf ek baar dikhta hai, copy kar leejiye.

**9d. Publisher banaiye** — marketplace.visualstudio.com/manage par jaiye. Publisher ID `package.json` ke `publisher` field se **bilkul match** karna chahiye. Abhi wahan `kanak` likha hai. Agar aapko dusra ID mila to package.json badal dijiye.

**9e. Publish:**
```bash
npx @vscode/vsce login kanak
npx @vscode/vsce publish
```

15–20 minute mein live ho jayegi.

---

## Commands ki list

| command | key |
|---|---|
| VYUHA: Run and Visualize | `Ctrl+Alt+V` |
| VYUHA: Stop Running Program | `Ctrl+Alt+X` |
| VYUHA: Re-run Last Program | |
| VYUHA: Play / Pause Timeline | panel mein `Space` |
| VYUHA: Next / Previous Frame | panel mein `←` `→` |
| VYUHA: Add Helper Library | |
| VYUHA: Open an Example | |
| VYUHA: Show Program Output | |
| VYUHA: New Network Spec File | |

---

## Package mein kya hai

```
vyuha-2.1.0.vsix         prebuilt — seedha install kar sakte hain
install.sh / install.ps1 ek command mein sab kuch
src/                     TypeScript — extension, runner, protocol, panels
media/                   dono renderers, bridge, stylesheet, icons
lib/                     6 languages ke helpers
examples/                Python, JS, Java, C++, Go ke chalne wale examples
tests/                   chaar test suites (render, ds, runner, auto)
tools/                   PyTorch model se network spec banane ka script
README.md                poora reference
```

Test khud chalakar dekhna ho:

```bash
npm run verify
```

Chaaron suites `PASSED` bolni chahiye.

---

## Aage kya

Do cheezein pending hain, dono aapke haath mein:

1. GitHub par `vyuha` repo banakar push karna (Step 9a)
2. Publisher ID confirm karke publish karna (Step 9d–9e)

Aur agar ERA ke saath jodna ho, wo Step 8 mein likha hai.
