const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function load(file, names, globals = {}) {
    const text = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const body = ast.statements.find(ts.isClassDeclaration).members
        .filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Test {${body}}; Test;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, globals);
}
const json = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const Flow = load('assets/scripts/GameFlow.ts', ['cities', '_loadCityMeta', 'selectionHasCollectibles']);
const Screen = load('assets/scripts/ui/CitySelectScreen.ts', ['_fillCard'], {
    Label: class {}, Sprite: class {}, UITransform: class {}, Input: { EventType: { TOUCH_END: 'touch' } },
});
(async () => {
    const flow = new Flow();
    flow._cityIndex = json('assets/resources/configs/cities.json');
    flow._cities = await Promise.all(flow._cityIndex.cities.map(key => flow._loadCityMeta(null, key)));
    flow._foods = [...json('assets/resources/configs/food-catalog.json').foods,
        ...json('assets/resources/configs/porcelain-catalog.json').items];
    const expected = new Set(['qing-hua-ci', 'bei-jing', 'shang-hai', 'nan-jing', 'xia-men', 'chang-sha', 'guang-zhou', 'cheng-du', 'xi-an']);
    for (const city of flow._cities) assert.equal(flow.selectionHasCollectibles(city), expected.has(city.key), city.key);
    const topic = flow._cityIndex.topics.find(item => item.key === 'lian-ai-mei-shi');
    assert.equal(flow.selectionHasCollectibles(topic), true, 'Food parent inherits its child chapters\' collectibles');
    assert.equal(flow.selectionHasCollectibles({ chapters: ['missing'] }), false);

    const screen = new Screen(), icon = { active: true };
    screen.flow = flow;
    flow.isCityUnlocked = () => false;
    flow.selectionProgress = () => ({ done: 0, total: 0 });
    screen.findChildDeep = (_, name) => name === 'icon_treasure_chest' ? icon : null;
    screen._setHeatBadge = screen._setCardLabel = screen._loadBanner = () => {};
    const card = { off() {}, on() {} };
    for (const city of [...flow._cities, topic]) {
        screen._fillCard(card, city);
        assert.equal(icon.active, city === topic || expected.has(city.key), 'Locked chapters also advertise collectibles');
    }
    screen.findChildDeep = () => null;
    assert.doesNotThrow(() => screen._fillCard(card, flow._cities[0]), 'Older/custom templates without the optional icon work');

    // Permanent IDs keep membership correct after moving content; catalog cityKey may remain legacy metadata.
    const oldChapter = { key: 'old', levels: ['remaining'], levelIds: { remaining: 'stable-other' } };
    const merged = { key: 'merged', levels: ['renamed'], levelIds: { renamed: 'stable-collectible' } };
    flow._cities = [oldChapter, merged];
    flow._foods = [{ cityKey: 'old', levelKey: 'stable-collectible' }];
    assert.equal(flow.selectionHasCollectibles(oldChapter), false);
    assert.equal(flow.selectionHasCollectibles(merged), true);
    assert.equal(flow.selectionHasCollectibles({ chapters: ['merged'] }), true);
    assert.equal(flow.selectionHasCollectibles({ chapters: ['old'] }), false);
    flow._foods = [{ levelKey: 'legacy/level-03' }];
    assert.equal(flow.selectionHasCollectibles({ key: 'legacy', levels: ['level-03'] }), true);
    flow._foods = [];
    assert.equal(flow.selectionHasCollectibles(merged), false);

    const prefab = json('assets/LobbySources/prefabs/CitySelectScreen.prefab');
    const nodes = prefab.filter(n => n.__type__ === 'cc.Node' && n._name === 'icon_treasure_chest');
    assert.equal(nodes.length, 1);
    const authored = nodes[0];
    assert.equal(prefab[authored._parent.__id__]._name, 'CityCard');
    const sprite = authored._components.map(c => prefab[c.__id__]).find(c => c.__type__ === 'cc.Sprite');
    const meta = json('assets/LobbySources/textures/UI_Sprite/icons/icon_chest.png.meta');
    assert.equal(sprite._spriteFrame.__uuid__, meta.subMetas.f9941.uuid);
    console.log('PASS chapter chest: real food/porcelain catalogs, parent grouping, locked chapters, moved permanent IDs, legacy paths and optional authored prefab icon.');
})().catch(error => { console.error(error); process.exitCode = 1; });
