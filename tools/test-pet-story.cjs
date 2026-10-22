const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cities = read('assets/resources/configs/cities.json').cities;
assert.equal(cities.indexOf('city-PetStory'), cities.indexOf('city-01-2026Hotmeme') + 1);
assert.equal(cities[cities.indexOf('city-PetStory') + 1], 'city-02-beijing');
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_levelImageTarget', '_loadLevel', '_loadCityMeta', '_timeFor', '_nextLevelTarget'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${body} }; Flow;`, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText);
const flow = new Flow();
flow._grades = read('assets/resources/configs/levels.json');
flow._loadJson = async key => ({ json: read(`assets/resources/${key}.json`) });
flow._cityIndex = read('assets/resources/configs/cities.json');
flow._contentBundles = {use: async (key, action) => action({name:key})};
flow._loadBundleJson = async (bundle, request) => ({json:read(`assets/Bundle/levels/${bundle.name}/${request}.json`),decRef(){}});
const imageFile = request => {
    request = request.replace(/^thumbnails\/(city-[^/]+)\//, 'levels/$1/thumbnails/');
    return ['.jpg', '.png', '.jpeg'].map(ext => 'assets/Bundle/' + request.replace(/\/spriteFrame$/, ext)).find(fs.existsSync);
};
(async () => {
    const city = await flow._loadCityMeta({}, 'city-PetStory');
    assert.equal(city.name, '宠物故事');
    assert.equal(city.banner, 'chapter-covers/city-PetStory-icon/spriteFrame');
    assert.deepEqual(Array.from(city.levels), Array.from({ length: 20 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`));
    assert.ok(imageFile(city.banner));
    const bundleMeta = read('assets/Bundle/levels/city-PetStory.meta').userData;
    assert.equal(bundleMeta.isBundle, true); assert.equal(bundleMeta.bundleName, 'city-PetStory');
    const settings = read('settings/v2/packages/builder.json').bundleConfig.custom[bundleMeta.bundleConfigID].configs.miniGame;
    assert.equal(settings.fallbackOptions.isRemote, true);
    let total = 0;
    for (const dir of city.levels) {
        const level = await flow._loadLevel({}, city.key, dir);
        assert.equal(level.key, `${city.key}/${dir}`);
        assert.equal(level.icon, `thumbnails/${city.key}/${dir}/icon/spriteFrame`);
        assert.equal(level.type, 'normal'); assert.ok(level.differences.length);
        total += level.differences.length;
        for (const field of ['topImage', 'bottomImage', 'icon']) {
            const file = imageFile(level[field]); assert.ok(file, `${level.key}: missing ${field}`);
            const meta = read(file + '.meta');
            assert.ok(Object.values(meta.subMetas).some(item => item.importer === 'sprite-frame'));
            if (field !== 'icon') {
                const target = flow._levelImageTarget(level[field]);
                assert.equal(target.cityKey, city.key);
                assert.equal(target.request, `${dir}/${field === 'topImage' ? 'scene-a' : 'scene-b'}/spriteFrame`);
            }
        }
    }
    assert.equal(total, 242);
    console.log('PASS: PetStory chapter after 2026Hotmeme, 20 names/configs, 40 image paths, 20 dedicated thumbnails and remote Bundle routing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
