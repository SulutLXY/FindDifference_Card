const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const root = 'assets/Bundle';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const imageFile = request => ['.jpg', '.png', '.jpeg'].map(ext => `${root}/${request.replace(/\/spriteFrame$/, '')}${ext}`).find(fs.existsSync);
class JsonAsset {}
class SpriteFrame {}
const requests = [];
const cities = read('assets/resources/configs/cities.json').cities;
assert.equal(cities[0], 'city-00-HotTips', 'HotTips must be the first chapter');
assert.equal(cities[1], 'city-01-2026Hotmeme');
assert.equal(cities[2], 'city-02-beijing');
const hotMeme = read(`${root}/configs/city-01-2026Hotmeme.json`);
assert.equal(hotMeme.name, '2026热梗');
assert.equal(hotMeme.levels.length, 30);
const hotTips = read(`${root}/configs/city-00-HotTips.json`);
assert.equal(hotTips.name, '网络热点');
assert.deepEqual(hotTips.levels, Array.from({ length: 30 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`));
const definitions = [['city-configs', 'configs'], ['city-thumbnails', 'thumbnails'], ...cities.map(key => [key, `levels/${key}`])];
const bundles = Object.fromEntries(definitions.map(([name, folder]) => [name, {
    name,
    getInfoWithPath(request) {
        const file = imageFile(`${folder}/${request}`);
        if (!file) return null;
        return { uuid: Object.values(read(file + '.meta').subMetas).find(m => m.importer === 'sprite-frame').uuid };
    },
    load(request, Type, done) {
        requests.push({ folder, request });
        if (Type === JsonAsset) {
            assert.equal(folder, 'configs', `JSON outside configs: ${request}`);
            done(null, { json: read(`${root}/configs/${request}.json`) });
        } else {
            const file = imageFile(`${folder}/${request}`);
            assert.ok(file, `Missing sprite: ${request}`);
            const meta = read(file + '.meta');
            assert.ok(Object.values(meta.subMetas).some(m => m.importer === 'sprite-frame'));
            done(null, { isValid: true, file, addRef() {} });
        }
    },
}]));
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_cityBundles', '_cityBundlePending', '_loadCityMeta', '_loadLevel', '_timeFor', '_loadCityBundle', '_loadBundleJson', 'loadSpriteFrame', '_loadSpriteFrom', '_levelImageTarget', 'acquireLevelFrame', 'preloadNextLevel'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
let bundleCalls = 0, localCalls = 0, delayBundle = false;
const pendingBundles = [], preloads = [];
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${body} }; Flow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, {
    JsonAsset, SpriteFrame,
    assetManager: { loadBundle(name, done) {
        assert.ok(bundles[name], `Unknown city Bundle: ${name}`);
        bundleCalls++;
        if (delayBundle) pendingBundles.push({ name, done });
        else done(null, bundles[name]);
    }, preloadAny(request, options, done) { preloads.push({ request, options }); done(null); } },
    resources: { load(request, Type, done) { localCalls++; done(null, { isValid: true, request, addRef() {} }); } },
});
(async () => {
    const flow = new Flow();
    flow._grades = read('assets/resources/configs/levels.json');
    flow._spriteFrameCache = new Map();
    const configs = await flow._loadCityBundle();
    assert.equal(bundleCalls, 1, 'Reading configuration must not load thumbnails or large images');
    for (const [name, folder] of definitions) {
        const meta = read(`${root}/${folder}.meta`).userData;
        assert.equal(meta.isBundle, true);
        assert.equal(meta.bundleName, name);
        const settings = read('settings/v2/packages/builder.json').bundleConfig.custom[meta.bundleConfigID].configs.miniGame;
        assert.equal(settings.fallbackOptions.isRemote, true);
        assert.equal(settings.overwriteSettings['bytedance-mini-game'].compressionType, 'merge_dep');
    }
    assert.ok(!read(`${root}.meta`).userData.isBundle, 'The organizing parent must not be another Bundle');
    assert.equal(read(`${root}/levels.meta`).userData.isBundle, false, 'levels must only be an organizing folder');
    const directories = fs.readdirSync(`${root}/levels`, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    assert.deepEqual(cities, directories);
    let levels = 0;
    for (const key of cities) {
        const city = await flow._loadCityMeta(configs, key);
        assert.equal(city.key, key);
        assert.equal(city.banner, `configs/${key}-icon/spriteFrame`);
        assert.ok(!city.levels.includes('level-00'));
        assert.ok(!fs.existsSync(`${root}/levels/${key}/city.json`));
        await flow.loadSpriteFrame(city.banner);
        assert.ok(!requests.some(p => p.folder.startsWith('levels/')), 'City metadata/icons must not load gameplay images');
        for (const dir of city.levels) {
            const config = read(`${root}/configs/${key}/${dir}/differences.json`);
            const level = await flow._loadLevel(configs, key, dir);
            assert.equal(level.key, `${key}/${dir}`, 'Save identity must remain stable');
            assert.equal(level.name, config.name);
            assert.equal(level.type, config.type);
            assert.equal(level.icon, `thumbnails/${key}/${dir}/icon/spriteFrame`);
            for (const field of ['topImage', 'bottomImage', 'icon']) assert.ok(imageFile(level[field]), `${level.key}: missing ${field}`);
            assert.ok(!fs.existsSync(`${root}/levels/${key}/${dir}/differences.json`));
            assert.ok(!fs.existsSync(`${root}/levels/${key}/${dir}/icon.jpg`));
            await flow.loadSpriteFrame(level.icon);
            levels++;
        }
    }
    const foods = read('assets/resources/configs/food-catalog.json').foods;
    for (const food of foods) {
        assert.ok(food.icon.startsWith(`thumbnails/${food.cityKey}/`));
        assert.equal(path.normalize(imageFile(food.icon)), path.normalize(food.assetPath));
        assert.equal(read(food.assetPath + '.meta').uuid, food.assetUuid);
        await flow.loadSpriteFrame(food.icon);
    }
    await flow.loadSpriteFrame(`levels/${cities[0]}/level-01/scene-a/spriteFrame`);
    const acquired = await flow.acquireLevelFrame(`levels/${cities[0]}/level-01/scene-b/spriteFrame`);
    assert.ok(acquired.file.includes(`/levels/${cities[0]}/`), 'Gameplay images must come from the requested city Bundle');
    assert.equal(localCalls, 0, 'City resources must load through their own Bundle');
    await flow.loadSpriteFrame('textures/local-ui/spriteFrame');
    assert.equal(localCalls, 1, 'Local UI must keep using resources');
    assert.equal(bundleCalls, 3, 'Load only configuration, thumbnails, and the current city');
    await flow.acquireLevelFrame(`levels/${cities[1]}/level-01/scene-a/spriteFrame`);
    assert.equal(bundleCalls, 4, 'Entering another city must load its own Bundle');
    assert.ok(!requests.some(p => p.folder.startsWith('levels/') && /^city-/.test(p.request)), 'City Bundle paths must also omit the city folder');
    assert.ok(!requests.some(({request}) => /^(configs|thumbnails|levels)\//.test(request)), 'Bundle-relative requests must omit the organizing folder prefix');
    flow.isValid = true;
    flow._currentCity = await flow._loadCityMeta(configs, cities[0]);
    flow._cities = [flow._currentCity];
    flow._currentLevel = await flow._loadLevel(configs, cities[0], 'level-01');
    flow.game = { node: { activeInHierarchy: true } };
    flow._levelLoadVersion = 1;
    await flow.preloadNextLevel(flow._currentLevel);
    assert.equal(preloads.length, 2);
    for (const {request, options} of preloads) {
        assert.equal(request.bundle, cities[0], 'Prefetch must look up image UUIDs in the target city Bundle');
        assert.ok(request.uuid);
        assert.equal(options.priority, -1);
    }
    flow._cities.push(await flow._loadCityMeta(configs, cities[1]));
    flow._currentLevel = await flow._loadLevel(configs, cities[0], flow._currentCity.levels.at(-1));
    preloads.length = 0;
    await flow.preloadNextLevel(flow._currentLevel);
    assert.equal(preloads.length, 2);
    assert.ok(preloads.every(p => p.request.bundle === cities[1]), 'Cross-city prefetch must select the next city Bundle');
    const retry = new Flow(); delayBundle = true;
    const first = retry._loadCityBundle(), overlap = retry._loadCityBundle();
    assert.equal(first, overlap, 'Concurrent configuration loads must share their request');
    const rejects = [assert.rejects(first), assert.rejects(overlap)];
    pendingBundles.shift().done(Error('offline'));
    await Promise.all(rejects);
    const recovered = retry._loadCityBundle();
    pendingBundles.shift().done(null, bundles['city-configs']);
    assert.equal(await recovered, bundles['city-configs'], 'Failed loads must allow retry');
    const cityFirst = retry._loadCityBundle('levels', cities[0]);
    const cityRepeat = retry._loadCityBundle('levels', cities[0]);
    const anotherCity = retry._loadCityBundle('levels', cities[1]);
    assert.equal(cityFirst, cityRepeat);
    assert.notEqual(cityFirst, anotherCity, 'Different cities must not share a pending request');
    for (const {name, done} of pendingBundles.splice(0)) done(null, bundles[name]);
    assert.equal(await cityFirst, bundles[cities[0]]);
    assert.equal(await anotherCity, bundles[cities[1]]);
    console.log(`PASS: ${cities.length} cities, ${levels} levels, ${foods.length} food icons, new JSON/image paths, lazy image loading and stable save keys.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
