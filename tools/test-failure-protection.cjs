const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
let raw = null, failWrite = false;
const storage = { getItem: () => raw, setItem: (_, value) => { if (failWrite) throw Error('disk full'); raw = value; } };
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, { exports: exportsObject, require: () => ({ sys: { localStorage: storage } }), console: { warn() {} } });
const { SaveService } = exportsObject;
let save = new SaveService();
assert.equal(save.protectFirstFailure('2026-10-02'), true);
assert.equal(save.protectFirstFailure('2026-10-02'), false);
save = new SaveService();
assert.equal(save.protectFirstFailure('2026-10-02'), false, 'same-day restart keeps marker');
assert.equal(save.protectFirstFailure('2026-10-03'), true, 'new day protects first failure');
assert.equal(save.protectFirstFailure('2026-10-03'), false);
failWrite = true;
assert.equal(save.protectFirstFailure('2026-10-04'), true, 'storage failure still protects');
assert.equal(save.protectFirstFailure('2026-10-04'), false, 'in-memory marker survives');
save = new SaveService();
assert.equal(save.protectFirstFailure('2026-10-04'), true, 'failed storage conservatively protects on restart');
console.log('PASS: daily first failure, repeat failures, restart, next day, and storage failure protection.');
