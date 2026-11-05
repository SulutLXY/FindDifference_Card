const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', source, ts.ScriptTarget.Latest, true);
const bootMethod = tree.statements.find(ts.isClassDeclaration).members.find(member => member.name?.getText(tree) === '_bootstrap').getText(tree);
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${bootMethod} } Flow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, { console });
const publishedIndex = read('assets/resources/configs/cities.json');
const baseIndex = { ...publishedIndex, cities: publishedIndex.cities.filter(key => key !== 'qing-hua-ci') };
const porcelain = read('assets/resources/configs/porcelain-catalog.json');
const food = read('assets/resources/configs/food-catalog.json');
const chapter = read('assets/Bundle/levels/qing-hua-ci/configs/city.json');
let currentIndex = baseIndex, starts = 0;
const flow = new Flow();
Object.assign(flow, { isValid: true, _comboClips: new Map(), platform: { configure() {} },
    _setLoadingProgress(value) { assert.ok(value >= 0 && value <= 1); },
    save: { migrateLegacy() {}, migrateChapterRules: () => true, migrateContentLayout: () => true },
    async _loadJson(path) { return { json: path === 'configs/cities' ? currentIndex
        : path === 'configs/food-catalog' ? food : path === 'configs/porcelain-catalog' ? porcelain
            : read(`assets/resources/${path}.json`) }; },
    async _loadCityMeta(_, key) { return currentIndex.chapters[key]; },
    async startContinue() { starts++; },
    _returnToLobbyOnLoadError(message) { throw Error(message); },
});
(async () => {
    await flow._bootstrap();
    assert.equal(flow._foods.length, 40, 'draft porcelain must not offer rewards for unpublished levels');
    currentIndex = { ...baseIndex, cities: [...baseIndex.cities, 'qing-hua-ci'], chapters: { ...baseIndex.chapters, 'qing-hua-ci': chapter } };
    await flow._bootstrap();
    assert.equal(flow._foods.length, 60);
    assert.equal(flow._foods.filter(item => item.category === 'porcelain').length, 20);
    assert.equal(food.foods.length, 40, 'loading must not mutate the cached food JsonAsset');
    await flow._bootstrap();
    assert.equal(flow._foods.length, 60, 'bootstrap retry must not duplicate collection records');
    currentIndex = { ...currentIndex, chapters: { ...currentIndex.chapters, 'qing-hua-ci': { ...chapter, levels: [chapter.levels[2]] } } };
    await flow._bootstrap();
    assert.equal(flow._foods.length, 41, 'only published stable level IDs enter the catalog');
    assert.equal(flow._foods.at(-1).id, porcelain.items[0].id);
    currentIndex.chapters['qing-hua-ci'].levels = [chapter.levels[2].folder];
    await flow._bootstrap();
    assert.equal(flow._foods.length, 41, 'legacy string chapter entries remain compatible');
    assert.equal(starts, 5, 'catalog loading must keep direct gameplay startup');
    console.log('PASS porcelain loading: draft isolation, 20 published mappings, safe partial release, legacy entries, cached JSON immutability and bootstrap retries');
})().catch(error => { console.error(error); process.exitCode = 1; });
