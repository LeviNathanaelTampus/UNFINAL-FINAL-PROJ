'use strict';
/** Syntax-check every JS file in server/ and public/js (no dependencies needed). */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(root);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✖ ${path.relative(root, f)}\n${err.stderr.toString()}`);
  }
}
console.log(failed ? `${failed} file(s) failed` : `✔ ${files.length} files OK`);
process.exit(failed ? 1 : 0);
