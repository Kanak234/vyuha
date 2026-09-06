/* Compiler visualizer — real pipelines against whatever this machine has. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { visualizeCompilation } = require('../out/compilerviz.js');

let failures = 0;
function ok(name, cond) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failures++;
}
function has(cmd) {
  try { execSync('which ' + cmd, { stdio: 'ignore' }); return true; } catch { return false; }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-ct-'));

  if (has('g++')) {
    const cpp = path.join(dir, 'a.cpp');
    fs.writeFileSync(cpp, '#include <iostream>\nint add(int a,int b){return a+b;}\nint main(){std::cout<<add(2,3)<<"\\n";}\n');
    const frames = []; const out = [];
    const rep = await visualizeCompilation(cpp, undefined, 30000, f => frames.push(f), l => out.push(l));
    ok('c++: pipeline succeeds', rep.ok);
    ok('c++: tool detected with version', /g\+\+|clang\+\+/.test(rep.tool) && /\d/.test(rep.tool));
    ok('c++: six stages present', rep.stages.length === 6);
    ok('c++: every stage done', rep.stages.every(s => s.state === 'done'));
    ok('c++: a frame per stage transition', frames.length >= 5);
    ok('c++: asm instruction count measured', rep.stages[2].facts.some(f => /\d+ instructions/.test(f)));
    ok('c++: program output captured', out.join('\n').includes('5'));
    ok('c++: artifacts recorded', rep.artifacts.length >= 3);
    ok('c++: function bars in later frames', frames[frames.length - 1].nodes.some(n => n.group === 'functions'));

    const bad = path.join(dir, 'bad.cpp');
    fs.writeFileSync(bad, 'int main(){ nope; }\n');
    const rep2 = await visualizeCompilation(bad, undefined, 30000, () => {}, () => {});
    ok('c++ error: pipeline reports failure', !rep2.ok);
    ok('c++ error: stops at the compile stage', rep2.stages.find(s => s.id === 's:asm').state === 'error');
    ok('c++ error: later stages untouched', rep2.stages.find(s => s.id === 's:run').state === 'normal');
  } else console.log('  skip g++ not installed');

  if (has('python3')) {
    const py = path.join(dir, 'a.py');
    fs.writeFileSync(py, 'def f(n):\n    return n*2\nprint(f(21))\n');
    const frames = []; const out = [];
    const rep = await visualizeCompilation(py, undefined, 30000, f => frames.push(f), l => out.push(l));
    ok('python: pipeline succeeds', rep.ok);
    ok('python: interpreter version detected', /Python \d/.test(rep.tool));
    ok('python: bytecode counted', rep.stages[2].facts.some(f => /\d+ bytecode/.test(f)));
    ok('python: output captured', out.join('\n').includes('42'));
  } else console.log('  skip python3 not installed');

  if (has('node')) {
    const js = path.join(dir, 'a.js');
    fs.writeFileSync(js, 'console.log(6*7)\n');
    const out = [];
    const rep = await visualizeCompilation(js, undefined, 30000, () => {}, l => out.push(l));
    ok('js: pipeline succeeds', rep.ok);
    ok('js: node version detected', /v\d+/.test(rep.tool));
    ok('js: output captured', out.join('\n').includes('42'));
  }

  // A language whose tool is certainly absent → honest missing-tool picture.
  const zz = path.join(dir, 'a.qqq');
  fs.writeFileSync(zz, 'whatever\n');
  const rep3 = await visualizeCompilation(zz, 'qqq-runner "' + zz + '"', 8000, () => {}, () => {});
  ok('missing tool: reported, not crashed', !rep3.ok && rep3.stages.some(s => s.state === 'error'));

  console.log(failures ? '\nCOMPILER TEST FAILED (' + failures + ')' : '\nCOMPILER TEST PASSED');
  process.exit(failures ? 1 : 0);
})();
