const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
const data = new Map(); let fail = false;
const storage = { getItem: key => data.get(key), setItem(key, value) { if (fail) throw Error('disk'); data.set(key, value); } };
const exports_ = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: exports_, require: () => ({ sys: { localStorage: storage } }), console: { warn() {} },
});
const { SaveService } = exports_;
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_loadCityMeta', '_loadLevel', '_timeFor', 'isCityUnlocked', 'isLevelUnlocked', 'findContinueTarget', 'findNextLevel', '_nextLevelTarget', 'cityProgress', 'watchLevelUnlockVideo'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow {${body}};Flow;`));
(async () => {
    const old = { 'old-a': ['stable-a', 'stable-b', 'stable-c'], 'old-b': ['stable-d', 'stable-e'] };
    const meta = { key: 'merged-chapter', name: '合并章节', levels: [
        { id: 'stable-e', name: '新首关', folder: 'xin-shou-guan' },
        { id: 'stable-a', name: '改名后的关卡', folder: 'gai-ming' },
        { id: 'stable-c', name: '被移动的关卡', folder: 'yi-dong' },
        { id: 'stable-d', name: '旧章首关', folder: 'jiu-shou-guan' },
        { id: 'stable-b', name: '旧章第二关', folder: 'di-er-guan' },
        { id: 'stable-f', name: '新增关卡', folder: 'xin-guan-ka' },
    ] };
    const f = new Flow(); f._cityIndex = { chapters: { [meta.key]: meta } };
    const city = await f._loadCityMeta(null, meta.key); f._cities = [city];
    let requested;
    f._grades = { baseTimeSeconds: 120, baseDifferenceCount: 4, secondsPerExtraDifference: 15, maxLives: 3 };
    f._contentBundles = { use: async (key, callback) => { assert.equal(key, meta.key); return callback({}); } };
    f._loadBundleJson = async (_, path) => { requested = path; return { json: { name: '旧素材名', differences: [{}] }, decRef() {} }; };
    const level = await f._loadLevel(null, meta.key, 'gai-ming');
    assert.equal(level.key, 'stable-a'); assert.equal(level.name, '改名后的关卡');
    assert.equal(requested, 'configs/gai-ming/differences');
    assert.equal(level.topImage, 'levels/merged-chapter/gai-ming/scene-a/spriteFrame');
    assert.equal(level.bottomImage, 'levels/merged-chapter/gai-ming/scene-b/spriteFrame');
    const key = 'find-difference.save.v3';
    data.set(key, JSON.stringify({ completed: { 'stable-a': { stars: 3, bestTime: 12 } }, unlockedLevels: ['stable-c'], lastPlayedCityKey: 'old-a', lastPlayedLevelKey: 'stable-b', energy: 7, freeHints: 9, foodReviews: { 'stable-a': '旧评价' } }));
    let save = new SaveService(); f.save = save;
    fail = true; const before = JSON.stringify(save.data);
    assert.equal(save.migrateContentLayout([city], old), false); assert.equal(JSON.stringify(save.data), before);
    fail = false; assert.equal(save.migrateContentLayout([city], old), true);
    for (const id of ['stable-a', 'stable-b', 'stable-c', 'stable-d']) assert.equal(save.isLevelUnlocked(id), true, id);
    assert.equal(save.isLevelUnlocked('stable-e'), false, 'No extra reward for previously locked levels');
    assert.equal(save.data.lastPlayedCityKey, meta.key); assert.equal(save.data.energy, 7);
    assert.equal(save.freeHints, 9); assert.equal(save.data.foodReviews['stable-a'], '旧评价');
    assert.equal(save.progressOf('stable-a').bestTime, 12); assert.equal(save.totalScore, 1);
    save = new SaveService(); f.save = save;
    assert.equal(save.migrateContentLayout([city], old), true);
    assert.equal(f.isLevelUnlocked(0, 4), true, 'Old next-level access survives new predecessor');
    f._ensureLevel = async (chapter, i) => ({ key: chapter.levelIds[chapter.levels[i]] });
    const target = await f.findContinueTarget(); assert.equal(target.city.key, meta.key); assert.equal(target.level.key, 'stable-b');
    assert.equal(f.cityProgress(city).done, 1); assert.equal(f.findNextLevel(level), null, 'No active chapter yet');
    f._currentCity = city; assert.equal(f.findNextLevel(level).levelIndex, 2, 'Next follows config position');
    f.requestReward = async () => { throw Error('Free first level does not need video'); };
    await f.watchLevelUnlockVideo(city, 0);
    f.requestReward = async (_, grant) => grant();
    assert.equal(await f.watchLevelUnlockVideo(city, 5), true);
    assert.equal(save.isLevelUnlocked('stable-f'), true, 'Video rewards use permanent ID, not new folder');
    assert.equal(save.isLevelUnlocked('merged-chapter/xin-guan-ka'), false);
    data.clear(); const fresh = new SaveService();
    assert.equal(fresh.migrateContentLayout([city], old), true);
    assert.equal(fresh.isLevelUnlocked('stable-d'), false, 'New users must not inherit old chapter entry privileges');
    // A second layout change must use the saved layout, not the frozen pre-upgrade table.
    fresh.completeLevel('stable-e', 2, 20);
    const reordered = { ...city, levels: [...city.levels].reverse() };
    assert.equal(fresh.migrateContentLayout([reordered], old), true);
    assert.equal(fresh.isLevelUnlocked('stable-a'), true, 'Previously open next level is retained on later updates');
    console.log('PASS: renamed folders/titles, merged chapters, stable keys, reordered progression, old availability, resume, rewards/reviews, reload and atomic rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
