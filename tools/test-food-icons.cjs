const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const file = 'assets/scripts/GameFlow.ts';
const source = fs.readFileSync(file, 'utf8');
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const cls = tree.statements.find(ts.isClassDeclaration);
const methods = cls.members.filter(m => ['showFoodTips', 'showCatalogFood'].includes(m.name?.getText(tree)))
    .map(m => m.getText(tree)).join('\n');
let warnings = 0;
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow {${methods}}\nFlow;`,
    {compilerOptions: {target: ts.ScriptTarget.ES2018}}).outputText,
    {console: {warn() { warnings++; }}});
const catalog = JSON.parse(fs.readFileSync('assets/resources/configs/food-catalog.json', 'utf8'));
const flow = new Flow();
flow._foods = catalog.foods;
let calls = 0, payload, unlocked;
flow._foodTips = {present(details, newlyUnlocked) { calls++; payload = details; unlocked = newlyUnlocked; }};
const keys = new Set();
for (const food of catalog.foods) {
    assert(food.levelKey, `${food.name} must have an acquisition level`);
    assert(!keys.has(food.levelKey), `duplicate acquisition level: ${food.levelKey}`);
    keys.add(food.levelKey);
    const level = JSON.parse(fs.readFileSync(`assets/Bundle/levels/${food.levelKey}/differences.json`, 'utf8'));
    const cover = `levels/${food.levelKey}/icon/spriteFrame`;
    flow.showFoodTips({...level, key: food.levelKey, icon: cover}, true);
    assert.equal(payload.icon, food.icon);
    assert.notEqual(payload.icon, cover);
    assert.equal(payload.foodName, food.name);
    assert.equal(payload.key, food.levelKey);
    assert.equal(unlocked, true);
    const meta = JSON.parse(fs.readFileSync(`${food.assetPath}.meta`, 'utf8'));
    assert.equal(meta.subMetas.f9941.uuid, food.spriteFrameUuid);
    flow.showCatalogFood(food);
    assert.equal(payload.icon, food.icon);
    assert.equal(unlocked, false);
}
assert.equal(calls, 80);
flow.showFoodTips({key:'city-01-beijing/level-01', icon:'wrong-level-cover'}, true);
assert.equal(calls, 80, 'unconfigured food must never display the level cover');
assert.equal(warnings, 1);
console.log('PASS: all 40 acquisition popups and collection details use designed food SpriteFrames; missing mappings never fall back to level icons.');
