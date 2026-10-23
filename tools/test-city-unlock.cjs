const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
const data = new Map();
let failWrite = false;
const storage = { getItem: k => data.get(k), setItem(k, v) { if (failWrite) throw Error('disk full'); data.set(k, v); } };
const exportsSave = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: exportsSave, require: () => ({ sys: { localStorage: storage } }), console: { warn() {} },
});
const { SaveService } = exportsSave;
let save = new SaveService();
assert.equal(save.isCityUnlocked('c'), false);
assert.equal(save.unlockCity('c'), true);
save = new SaveService();
assert.equal(save.isCityUnlocked('c'), true);
assert.equal(save.totalScore, 0);
failWrite = true;
assert.equal(save.unlockCity('b'), false);
assert.equal(save.isCityUnlocked('b'), false);
failWrite = false;
const flowSource = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const rules = flowSource.slice(flowSource.indexOf('    public isCityUnlocked('), flowSource.indexOf('    /** 城市进度'));
const Rules = vm.runInNewContext(compile(`class Rules { ${rules} }; Rules;`));
const flow = new Rules();
flow.save = save;
flow._cities = ['a', 'b', 'c', 'd'].map((key, index) => ({ key, levels: ['1', '2'],
    unlockMode: index < 2 ? 'sequential' : 'open' }));
assert.equal(flow.isCityUnlocked(0), true);
assert.equal(flow.isCityUnlocked(1), true);
assert.equal(flow.isCityUnlocked(2), true);
assert.equal(flow.isCityUnlocked(3), true);
for (const index of [-1, 4, 0.5, NaN]) assert.equal(flow.isCityUnlocked(index), false);
assert.equal(flow.isLevelUnlocked(1, 0), true);
assert.equal(flow.isLevelUnlocked(1, 1), false);
save.completeLevel('b/1', 2, 15);
assert.equal(flow.isLevelUnlocked(1, 1), true, 'Completion opens the next level without an ad');
assert.equal(flow.isLevelUnlocked(2, 0), true);
assert.equal(flow.isLevelUnlocked(2, 1), false, 'Old chapter unlock records do not bypass level progression');
save.completeLevel('c/1', 2, 15);
assert.equal(flow.isLevelUnlocked(2, 1), true);
const source = fs.readFileSync('assets/scripts/ui/CitySelectScreen.ts', 'utf8');
const tree = ts.createSourceFile('screen.ts', source, ts.ScriptTarget.Latest, true);
const body = tree.statements.find(ts.isClassDeclaration).members
    .filter(m => m.name?.getText(tree) === '_fillCard').map(m => m.getText(tree)).join('\n');
class Label {} class Sprite {} class UITransform {}
const Screen = vm.runInNewContext(compile(`class Screen { ${body} }; Screen;`),
    { Label, Sprite, UITransform, Input: { EventType: { TOUCH_END: 'touch' } } });
const screen = new Screen();
let entered = null;
screen.flow = { cityProgress: () => ({ done: 0, total: 2 }), enterCity: city => { entered = city; },
    requestReward() { throw Error('Chapter entry must never request a video'); } };
const nodes = new Map(['ProgressPoint', 'BtnUnlock', 'LockIcon', 'CityLockTip'].map(name => [name, { active: true, off() {} }]));
screen.findChildDeep = (_, name) => nodes.get(name);
screen._setCardLabel = screen._loadBanner = () => {};
let click;
const card = { off() {}, on(_, handler) { click = handler; } };
for (const city of flow._cities) {
    screen._fillCard(card, city);
    assert.equal(nodes.get('ProgressPoint').active, true);
    for (const name of ['BtnUnlock', 'LockIcon', 'CityLockTip']) assert.equal(nodes.get(name).active, false);
    click(); assert.equal(entered, city, 'Clicking any chapter enters directly');
}
assert.ok(!source.includes('_unlockCity') && !source.includes('requestReward'), 'Remove chapter ad callbacks');
save.reset();
assert.equal(new SaveService().isCityUnlocked('c'), false);
flow.save = new SaveService();
for (let i = 0; i < flow._cities.length; i++) assert.equal(flow.isCityUnlocked(i), true, 'Reset does not lock chapters');
console.log('PASS: free chapter entry, hidden chapter locks/ad buttons, free sequential progression, legacy unlock storage and reset.');
