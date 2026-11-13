const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText;
const now = Date.parse('2026-11-12T18:00:00+08:00');
class Clock extends Date { static now() { return now; } }
const storage = new Map(); let failWrite = false, writes = 0;
const exports_ = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: exports_, Date: Clock, console: { warn() {} }, require: () => ({ sys: { localStorage: {
        getItem: key => storage.get(key), setItem(key, value) { if (failWrite) throw Error('disk full'); writes++; storage.set(key, value); },
    } } }),
});
function saveAt(energy, updatedAt = now) {
    storage.clear(); failWrite = false;
    storage.set('find-difference.save.v3', JSON.stringify({ energy, energyUpdatedAt: updatedAt }));
    return new exports_.SaveService();
}
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('Flow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['finishLevel', 'revive', 'reviveBonusSeconds'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree)))
    .map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow {${body}}; Flow;`));
function round(save) {
    const f = new Flow(); f.isValid = true; f.save = save; f._foods = [];
    f._currentLevel = { key: 'stable/challenge', timeLimit: 150, differences: [{ id: 'a' }, { id: 'b' }] };
    f._foundIds = new Set(['a', 'b']); f._remainingTime = 100; f._elapsedTime = 50;
    f._playResultTone = f._stopResultTone = () => {}; f.findNextLevel = () => null;
    f.rankCalls = 0; f.rankProvider = { submitScore() { f.rankCalls++; } };
    f.platform = { onRoundFinished() {} }; f.resultModal = { present() {}, close() {} };
    f.messages = []; f.toast = text => f.messages.push(text);
    return f;
}
let save = saveAt(1), f = round(save);
assert.equal(save.consumeEnergy(), true); assert.equal(save.energy, 0);
const beforeWrite = writes;
f.finishLevel(true);
assert.equal(save.energy, 1, 'Winning returns one energy so a player with zero left can continue');
assert.equal(writes, beforeWrite + 1, 'Progress and energy use one persistence write');
assert.equal(save.totalScore, 1); assert.equal(f.rankCalls, 1);
f.finishLevel(true); f.finishLevel(false);
assert.equal(save.energy, 1, 'Duplicate result callbacks never grant twice');
save = new exports_.SaveService(); assert.equal(save.energy, 1, 'Reward survives reload');
assert.equal(save.consumeEnergy(), true);
f = round(save); f._remainingTime = 20; f._elapsedTime = 90; f.finishLevel(true);
assert.equal(save.energy, 1, 'Each successful replay earns one energy');
assert.equal(save.totalScore, 1, 'Replay does not increase the unique-clear score');
assert.equal(save.data.completed['stable/challenge'].stars, 3);
assert.equal(save.data.completed['stable/challenge'].bestTime, 50);

save = saveAt(1); assert.equal(save.consumeEnergy(), true); f = round(save);
f.finishLevel(false, 'time'); assert.equal(save.energy, 0, 'A loss grants no energy');
assert.equal(save.consumeEnergy(), false); assert.equal(save.totalScore, 0);
f.revive(); assert.equal(save.energy, 0, 'Revival itself grants no account energy');
f.finishLevel(true); assert.equal(save.energy, 1, 'A revived round that eventually wins earns one energy');
f.finishLevel(true); assert.equal(save.energy, 1);

save = saveAt(14, now - 120000); assert.ok(save.energyRecoverySeconds > 0);
save.completeLevel('at-cap', 1, 1, true);
assert.equal(save.energy, 15); assert.equal(save.energyRecoverySeconds, 0);
assert.equal(save.data.energyUpdatedAt, now);
save = saveAt(4, now - 120000); const recovery = save.energyRecoverySeconds;
save.completeLevel('below-cap', 1, 1, true);
assert.equal(save.energy, 5); assert.equal(save.energyRecoverySeconds, recovery, 'Keep partial recovery time below 15');
save = saveAt(99); save.completeLevel('storage-cap', 1, 1, true);
assert.equal(save.energy, 99, 'Reward cannot exceed the 99 storage cap');
save.completeLevel('historical-progress', 2, 10);
assert.equal(save.energy, 99, 'Default historical/fixture completion does not mint energy');
save = saveAt(4); save.completeLevel('historical-progress', 2, 10); assert.equal(save.energy, 4);

save = saveAt(1); save.consumeEnergy(); f = round(save);
const before = JSON.stringify(save.data), diskBefore = storage.get('find-difference.save.v3');
failWrite = true; f.finishLevel(true);
assert.equal(JSON.stringify(save.data), before, 'Failed persistence rolls back both completion and energy');
assert.equal(storage.get('find-difference.save.v3'), diskBefore);
assert.equal(f.rankCalls, 0, 'Do not submit a score that was not saved');
assert.ok(f.messages.some(text => text.includes('保存失败')));
failWrite = false;
assert.equal(save.completeLevel('stable/challenge', 2, 50, true), true); assert.equal(save.energy, 1);
save = saveAt(1); f = round(save); f.feed = { isPreview: true }; f.finishLevel(true);
assert.equal(save.energy, 1); assert.equal(save.totalScore, 0, 'Feed preview cannot settle a real reward');
console.log('PASS level-clear energy: start -1 / win +1, zero-energy continuation, replays, duplicate result guard, loss/revive/preview, caps/recovery, atomic persistence and score rollback.');
