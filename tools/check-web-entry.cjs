const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || 'build/web-mobile');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const references = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
references.push(...[...html.matchAll(/System\.import\(['"]([^'"]+)['"]\)/g)].map(match => match[1]));
assert.ok(references.length > 0);
for (const ref of references) {
    if (/^(https?:)?\/\//.test(ref)) continue;
    const file = decodeURIComponent(ref.split(/[?#]/)[0]);
    assert.ok(fs.existsSync(path.resolve(root, file)), `Web entry references missing build file: ${ref}`);
}
console.log(`PASS: ${references.length} Web entry CSS/script/import-map/module URLs all exist in ${root}.`);
