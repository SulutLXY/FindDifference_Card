const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const indexData = read('assets/resources/configs/cities.json');
const cities = indexData.cities.map(key => indexData.chapters[key]);
const config = read('assets/resources/configs/chapter-rules.json');
// 顺序与迁移配置必须随本地首包更新，不能落入远程配置 Bundle。
const resourcesMeta = read('assets/resources.meta').userData;
assert.equal(resourcesMeta.bundleName, 'resources');
const buildPolicy = read('settings/v2/packages/builder.json').bundleConfig.custom[resourcesMeta.bundleConfigID].configs;
assert.equal(buildPolicy.miniGame.overwriteSettings['bytedance-mini-game'].isRemote, false);
assert.notEqual(read('assets/resources/configs.meta').userData.isBundle, true);
for (const name of ['cities', 'chapter-rules']) {
    assert.equal(read(`assets/resources/configs/${name}.json.meta`).importer, 'json');
    assert.equal(fs.existsSync(`assets/Bundle/configs/${name}.json`), false, 'Do not keep conflicting remote copies of the startup config');
}
const data = new Map(); let failWrite = false;
const storage = { getItem: key => data.get(key), setItem(key, value) { if (failWrite) throw Error('disk full'); data.set(key, value); }, removeItem: key => data.delete(key) };
const output = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: output, require: () => ({ sys: { localStorage: storage } }), console: { warn() {}, log() {} },
});
const { SaveService } = output;
const flowSource = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', flowSource, ts.ScriptTarget.Latest, true);
const names = ['isCityUnlocked', 'isLevelUnlocked', '_nextLevelTarget', 'findContinueTarget', 'findNextLevel'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow { ${body} }; Flow;`));
const index = key => cities.findIndex(city => city.key === key);
const hot = cities[index('city-00-HotTips')], meme = cities[index('city-01-2026Hotmeme')], pet = cities[index('city-PetStory')];
const beijing = cities[index('city-02-beijing')], shanghai = cities[index('city-03-shanghai')];
const key = 'find-difference.save.v3';
function oldSave(completed = {}, unlockedCities = []) {
    data.clear(); data.set(key, JSON.stringify({ version: 3, completed, unlockedCities, freeHints: 7, freeAddTimes: 5, foodReviews: { review: '保留评价' } }));
    return new SaveService();
}
function flow(save) { const f = new Flow(); f.save = save; f._cities = cities; f._ensureLevel = async (city, i) => ({ key: `${city.key}/${city.levels[i]}` }); return f; }
const completedChapter = city => Object.fromEntries(city.levels.map(dir => [`${city.key}/${dir}`, { stars: 3, bestTime: 20 }]));
(async () => {
    data.clear(); const fresh = new SaveService();
    assert.equal(fresh.data.chapterRulesVersion, 2);
    assert.equal(fresh.migrateChapterRules(config, cities), true);
    const f = flow(fresh);
    assert.equal(f.isCityUnlocked(index(hot.key)), true);
    assert.equal(f.isCityUnlocked(index(meme.key)), true);
    for (const city of cities) assert.equal(f.isCityUnlocked(index(city.key)), true, `${city.key}: entry requires no ad or completion`);
    assert.equal(f.isLevelUnlocked(index(meme.key), 0), true);
    assert.equal(f.isLevelUnlocked(index(meme.key), 1), false);
    for (const city of cities) {
        assert.equal(city.unlockMode, 'sequential');
        for (let li = 0; li < city.levels.length; li++) {
            assert.equal(f.isLevelUnlocked(index(city.key), li), li === 0, `${city.key}: only the first level starts open`);
        }
        for (const li of [-1, city.levels.length, 0.5, NaN]) assert.equal(f.isLevelUnlocked(index(city.key), li), false);
    }
    fresh.completeLevel(`${hot.key}/${hot.levels[0]}`, 2, 15);
    assert.equal(f.isLevelUnlocked(0, 1), true); assert.equal(f.isLevelUnlocked(0, 2), false);
    for (const dir of hot.levels) fresh.completeLevel(`${hot.key}/${dir}`, 2, 15);
    assert.equal(f.isCityUnlocked(index(meme.key)), true);
    for (const dir of meme.levels) fresh.completeLevel(`${meme.key}/${dir}`, 2, 15);
    assert.equal(f.isCityUnlocked(index(pet.key)), true);
    assert.equal(f.isLevelUnlocked(index(pet.key), 19), false, 'Entering a chapter does not skip its progression');
    fresh.completeLevel(`${pet.key}/${pet.levels[0]}`, 2, 15);
    assert.equal(f.isLevelUnlocked(index(pet.key), 1), true);
    assert.equal(f.isLevelUnlocked(index(pet.key), 2), false);
    assert.equal(f.isLevelUnlocked(index(pet.key), 20), false);
    assert.equal(f._nextLevelTarget(pet, 19, true), null, 'No skip fallback into another independent chapter');
    assert.equal(f._nextLevelTarget(meme, 29), null);
    assert.equal(f._nextLevelTarget(hot, 29).city.key, meme.key);
    fresh.setLastPlayedCity(pet.key);
    const restored = new SaveService();
    const resume = await flow(restored).findContinueTarget(); assert.equal(resume.city.key, pet.key);
    const before = JSON.stringify(fresh.data.completed);
    assert.equal(fresh.migrateChapterRules(config, cities), true);
    assert.equal(JSON.stringify(fresh.data.completed), before);
    assert.equal(fresh.isCityUnlocked(beijing.key), false, 'New users must never receive legacy grants');

    const progress = { ...completedChapter(hot), ...completedChapter(meme), ...completedChapter(beijing),
        [`${shanghai.key}/${shanghai.levels[0]}`]: { stars: 2, bestTime: 36 } };
    const legacy = oldSave(progress, [pet.key]);
    assert.equal(legacy.data.chapterRulesVersion, 1);
    assert.equal(legacy.migrateChapterRules(config, cities), true);
    for (const city of [hot, meme, pet, beijing, shanghai]) assert.equal(legacy.isCityUnlocked(city.key), true);
    assert.equal(legacy.data.lastPlayedCityKey, shanghai.key, 'Prefer the partially completed old chapter over an untouched chapter');
    assert.equal(legacy.data.freeHints, 7); assert.equal(legacy.data.freeAddTimes, 5);
    assert.equal(legacy.getFoodReview('review'), '保留评价');
    assert.equal(legacy.progressOf(`${shanghai.key}/${shanghai.levels[0]}`).bestTime, 36);
    assert.equal((await flow(legacy).findContinueTarget()).levelIndex, 1, 'Continue exactly after prior completed levels');
    const stored = data.get(key); new SaveService().migrateChapterRules(config, cities);
    assert.equal(data.get(key), stored, 'Migration is one-time and stable across restarts');

    // Preserve an old implicit unlock even if that chapter itself has no completion yet.
    const implicit = oldSave(completedChapter(beijing)); implicit.migrateChapterRules(config, cities);
    assert.equal(implicit.isCityUnlocked(shanghai.key), true);
    const rollback = oldSave(progress); const original = data.get(key); failWrite = true;
    assert.equal(rollback.migrateChapterRules(config, cities), false);
    assert.equal(rollback.data.chapterRulesVersion, 1); assert.equal(data.get(key), original);
    failWrite = false; assert.equal(rollback.migrateChapterRules(config, cities), true);
    data.clear();
    data.set('find-difference.save.v2', JSON.stringify({ unlockedLevel: 16 }));
    const v2 = new SaveService();
    const keys = config.legacyOrders[0].flatMap(key => {
        const city = cities.find(city => city.key === key); return city.levels.map(dir => `${key}/${dir}`);
    });
    assert.equal(v2.migrateLegacy(keys), true);
    assert.equal(v2.migrateChapterRules(config, cities, true), true);
    assert.equal(v2.isCompleted(`${shanghai.key}/${shanghai.levels[0]}`), true);
    assert.equal(v2.data.lastPlayedCityKey, shanghai.key, 'v2 progress also continues in the old partial chapter');
    const layout = fs.readFileSync('assets/scripts/ui/CitySelectScreen.ts', 'utf8');
    assert.ok(layout.includes("'关卡选择'")); assert.ok(layout.includes('`${city.name}1-${progress.total}关`'));
    console.log('PASS: all chapters free, first levels open, progression unlocks next levels without ads, local numbering, old implicit/ad unlocks, exact continuation, save preservation, one-time migration and failed-write retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
