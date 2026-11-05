const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const text = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', text, ts.ScriptTarget.Latest, true);
const names = ['preloadNextLevel', '_nextLevelTarget'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(member => names.includes(member.name?.getText(tree))).map(member => member.getText(tree)).join('\n');
let images = [];
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow {${body}} Flow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, { console: { ...console, warn(message, error) { throw error || Error(message); } }, SpriteFrame: class {}, assetManager: {
    preloadAny(request, options, done) { assert.equal(options.priority, -1); assert.equal(options.maxConcurrency, 1); images.push(request); done(null); },
} });
function setup(last = false) {
    const f = new Flow(), chapters = [], metadata = [], retained = [];
    const current = { key: 'current', levels: ['first', 'last'], nextChapter: 'other' };
    f.isValid = true; f._currentCity = current; f._currentLevel = { key: last ? 'current/last' : 'current/first' };
    f._cities = [current, { key: 'other', levels: ['first'] }]; f._levelLoadVersion = 1;
    f.isCityUnlocked = () => true;
    f.game = { node: { activeInHierarchy: true } };
    f._contentBundles = { retain(name) { retained.push(name); return () => {}; } };
    f._loadLevel = async (_, name, dir) => { metadata.push(name); return {
        topImage: `levels/${name}/${dir}/scene-a/spriteFrame`, bottomImage: `levels/${name}/${dir}/scene-b/spriteFrame`,
    }; };
    f._levelImageTarget = image => ({ cityKey: image.split('/')[1], request: image });
    f._loadCityBundle = async (_, name) => { chapters.push(name); return { name, getInfoWithPath: request => ({ uuid: request }) }; };
    return { f, chapters, metadata, retained };
}
(async () => {
    let sample = setup(); images = [];
    await sample.f.preloadNextLevel(sample.f._currentLevel);
    assert.deepEqual(sample.metadata, ['current']); assert.deepEqual(sample.chapters, ['current', 'current']);
    assert.equal(images.length, 2); assert.deepEqual(sample.retained, ['current']);
    sample = setup(true); images = [];
    await sample.f.preloadNextLevel(sample.f._currentLevel);
    assert.deepEqual(sample.metadata, []); assert.deepEqual(sample.chapters, []); assert.equal(images.length, 0);
    assert.deepEqual(sample.retained, [], 'Starting at the chapter boundary must not retain/download another chapter');
    sample = setup(); images = [];
    sample.f._loadLevel = async () => ({ topImage: 'levels/other/first/scene-a/spriteFrame', bottomImage: 'levels/other/first/scene-b/spriteFrame' });
    await sample.f.preloadNextLevel(sample.f._currentLevel);
    assert.deepEqual(sample.chapters, [], 'Explicit foreign image overrides must not cause speculative cross-chapter loads');
    sample = setup(); images = [];
    sample.f._loadLevel = async () => { sample.f._levelLoadVersion++; return { topImage: 'levels/current/last/scene-a/spriteFrame', bottomImage: 'levels/current/last/scene-b/spriteFrame' }; };
    await sample.f.preloadNextLevel(sample.f._currentLevel);
    assert.equal(images.length, 0, 'Stale prefetch must stop');
    console.log('PASS startup prefetch: serial current-chapter images only, boundary/foreign overrides skipped, stale loads stopped');
})().catch(error => { console.error(error); process.exitCode = 1; });
