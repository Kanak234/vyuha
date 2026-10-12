/*
 * tests/extension-test.js — VYUHA ka activate + "Python missing" flow, mock VS Code par.
 * Rahul jaisa PC simulate: PATH par sirf Store stub. Pehle raw "Python was not found"
 * terminal mein aata tha; ab VYUHA program chalaane se PEHLE saaf message + fix deta hai.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const mock = require('./vscode-mock');
let failures = 0;
const ok = (l, c, d) => { console.log((c ? 'OK   ' : 'FAIL ') + l + (d ? '  ' + d : '')); if (!c) failures++; };

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-stub-'));
const win = process.platform === 'win32';
for (const n of ['python', 'python3']) {
  if (win) fs.writeFileSync(path.join(stubDir, n + '.cmd'), '@echo Python was not found; run without arguments to install from the Microsoft Store 1>&2\r\n@exit /b 9009\r\n');
  else { const f = path.join(stubDir, n); fs.writeFileSync(f, '#!/bin/sh\necho "Python was not found; run without arguments to install from the Microsoft Store" >&2\nexit 9009\n'); fs.chmodSync(f, 0o755); }
}
const answers = [];
const vscode = mock.install({ answer: (m, b) => { answers.push({ m, b }); return undefined; } });
const ext = require(path.join(__dirname, '..', 'out', 'extension.js'));
(async () => {
  ext.activate(mock.context(path.join(__dirname, '..')));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const missing = pkg.contributes.commands.map(c => c.command).filter(c => !vscode._commands.has(c));
  ok('every command in package.json is registered', missing.length === 0, missing.join(', '));

  const file = path.join(os.tmpdir(), 'rahul_' + process.pid + '.py');
  fs.writeFileSync(file, 'print("hi")\n');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  const savedPath = process.env.PATH;
  process.env.PATH = stubDir;                  // Rahul ka PC: sirf Store stub
  require(path.join(__dirname, '..', 'out', 'interpreters.js')).clearInterpreterCache();
  await vscode.commands.executeCommand('vyuha.runAndVisualize', doc.uri);
  process.env.PATH = savedPath;
  const err = vscode._messages.find(m => m.level === 'error');
  ok('a clear "Python 3 is not installed / not found" message is shown', err && /Python 3/.test(err.m), err && err.m);
  ok('…with a fix offered (download / one-command install / set path)', answers.some(a => a.b.includes('Download Python') && a.b.includes('I have Python — set path')));
  ok('no terminal was started with the broken command', vscode._terminals.filter(t => /VYUHA/.test(t.name) && !/install/.test(t.name)).length === 0);
  fs.unlinkSync(file);
  fs.rmSync(stubDir, { recursive: true, force: true });
  if (failures) { console.log('\nEXTENSION TEST FAILED'); process.exit(1); }
  console.log('\nEXTENSION TEST PASSED');
  setTimeout(() => process.exit(0), 100);
})().catch(e => { console.error(e); process.exit(1); });
