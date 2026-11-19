const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2018}}).outputText;
const tick = () => new Promise(setImmediate);
class AudioClip {
    constructor(name) { this.name = name; this.refs = 0; }
    addRef() { this.refs++; }
    decRef() { this.refs--; }
}
const roots = {MainGameSources: 'assets/PleyGame', 'qing-hua-ci': 'assets/Bundle/levels/qing-hua-ci',
    'meng-chong-san-guo': 'assets/Bundle/levels/meng-chong-san-guo'};
const files = new Map();
function scan(root, prefix = '') {
    return fs.readdirSync(root, {withFileTypes: true}).flatMap(entry => {
        const rel = prefix + entry.name;
        return entry.isDirectory() ? scan(root + '/' + entry.name, rel + '/')
            : /\.mp3$/i.test(entry.name) ? [rel.replace(/\.[^.]+$/, '')] : [];
    });
}
for (const [name, root] of Object.entries(roots)) files.set(name, scan(root));
let now = 100000;
const text = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', text, ts.ScriptTarget.Latest, true);
const names = ['_comboClips', '_chapterComboClips', '_chapterComboGroup', '_comboSoundRequest', '_successSoundBags',
    '_lastSuccessClipKey', 'DEFAULT_COMBO_GROUP', 'BUNDLE_COMBO_ROOT', '_activeComboGroup', '_comboGroups',
    '_comboGroupsScannedBundle', '_loadComboClip', '_comboClipRef', '_resolveChapterComboGroup', '_discoverComboGroups',
    '_successClipCandidates', '_nextSuccessClipRef', '_playSuccessSound', 'playSuccessTone', 'playRightSound',
    'COMBO_WINDOW_MS', 'TOP_COMBO_WINDOW_MS', 'onDifferenceFound'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree)))
    .map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class GameFlow {${body}}; GameFlow;`), {
    AudioClip, console: {warn() {}}, Date: {now: () => now},
    Math: Object.assign(Object.create(Math), {random: () => 0}), // Even a repeated random draw cannot repeat the same clip.
});
function setup() {
    const queue = [], played = [], scans = [];
    const bundle = name => ({
        getDirWithPath(dir) { scans.push(name); return files.get(name).filter(path => path.startsWith(dir + '/')).map(path => ({path})); },
        load(path, Type, done) {
            assert.equal(Type, AudioClip);
            assert.ok(files.get(name).includes(path), `Missing actual audio ${name}:${path}`);
            queue.push({name, path, done});
        },
    });
    const f = new Flow(); f.isValid = true;
    f.save = {data: {soundEnabled: true}};
    f._gameBundle = bundle('MainGameSources');
    f._loadGameBundle = async () => f._gameBundle;
    f._contentBundles = {use: async (name, action) => action(bundle(name))};
    f._comboSource = {isValid: true, clip: null, stop() {}, play() {played.push(this.clip.name);}};
    return {f, played, scans, queue, async settle() {
        await tick();
        while (queue.length) {
            for (const request of queue.splice(0)) request.done(null, new AudioClip(`${request.name}:${request.path}`));
            await tick();
        }
    }};
}
function noAdjacent(values) {
    for (let i = 1; i < values.length; i++) assert.notEqual(values[i], values[i - 1], 'Avoid adjacent repeats, including shuffle boundaries');
}
(async () => {
    const a = setup();
    for (let stage = 1; stage <= 5; stage++) {
        const start = a.played.length;
        for (let i = 0; i < 12; i++) { a.f.playSuccessTone(stage + 1); await a.settle(); }
        const values = a.played.slice(start);
        for (let i = 0; i < values.length; i += 3) assert.equal(new Set(values.slice(i, i + 3)).size, 3, 'Use every generic group once per cycle');
        assert.ok(values.every(path => path.endsWith(`_0${stage}`)), 'Keep the requested combo tier');
        noAdjacent(values);
    }
    for (const chapter of ['qing-hua-ci', 'meng-chong-san-guo']) {
        const b = setup();
        b.f._chapterComboGroup = await b.f._resolveChapterComboGroup({key: chapter}, 'select');
        assert.equal(b.queue.length, 0, 'Discover metadata without preloading every sound');
        for (let stage = 1; stage <= 5; stage++) {
            const chapterPaths = files.get(chapter).filter(path => path.startsWith('Combo _F_type/') && path.endsWith(`_0${stage}`));
            const count = 3 + chapterPaths.length;
            const start = b.played.length;
            for (let i = 0; i < count * 2; i++) { b.f.playSuccessTone(stage + 1); await b.settle(); }
            const values = b.played.slice(start);
            assert.equal(new Set(values.slice(0, count)).size, count);
            assert.equal(new Set(values.slice(count)).size, count);
            for (const path of chapterPaths) assert.ok(values.includes(`${chapter}:${path}`), `New clip must actually play: ${path}`);
            assert.ok(values.some(path => path.startsWith(chapter + ':')));
            assert.ok(values.every(path => path.startsWith(chapter + ':') || path.startsWith('MainGameSources:')));
            assert.ok(values.every(path => path.endsWith(`_0${stage}`)));
            noAdjacent(values);
        }
        assert.equal(b.f._chapterComboClips.size, files.get(chapter).filter(path => path.startsWith('Combo _F_type/')).length,
            'Every chapter variant is played and cached within its own chapter');
        assert.deepEqual(Array.from(new Set(b.scans)).sort(), ['MainGameSources', chapter].sort());
        for (const clip of b.f._chapterComboClips) clip.decRef();
    }
    const c = setup();
    for (let i = 0; i < 8; i++) { c.f.playRightSound(); await c.settle(); }
    assert.equal(new Set(c.played.slice(0, 4)).size, 4, 'Ordinary correct answers rotate the base cue and three lowest-tier sounds');
    assert.ok(c.played.every(path => path.endsWith('/voice_Right') || path.endsWith('_01')));
    for (let i = 0; i < 20; i++) { c.f.playSuccessTone(2); await c.settle(); c.f.playRightSound(); await c.settle(); }
    noAdjacent(c.played);
    const d = setup();
    d.f._foundIds = new Set(); d.f._currentLevel = {differences: new Array(20)};
    d.f._combo = 0; d.f._lastFoundAt = 0; d.f._elapsedTime = 0;
    for (let i = 0; i < 8; i++) { d.f.onDifferenceFound({id: `diff-${i}`}); await d.settle(); now += 1000; }
    assert.deepEqual(d.played.slice(1).map(path => Number(path.match(/_0(\d)$/)[1])), [1, 2, 3, 4, 5, 5, 5]);
    assert.equal(new Set(d.played.slice(-3)).size, 3, 'Highest-tier consecutive hits rotate instead of repeating one clip');
    const e = setup();
    e.f.playSuccessTone(2); e.f.playSuccessTone(2); await e.settle();
    assert.equal(e.played.length, 1, 'Only the latest pending correct answer may play');
    e.f.playSuccessTone(4); ++e.f._comboSoundRequest; await e.settle();
    assert.equal(e.played.length, 1, 'Page changes cancel late audio');
    e.f.save.data.soundEnabled = false;
    const bag = JSON.stringify(Array.from(e.f._successSoundBags));
    e.f.playRightSound(); e.f.playSuccessTone(99); await e.settle();
    assert.equal(e.played.length, 1);
    assert.equal(e.queue.length, 0);
    assert.equal(JSON.stringify(Array.from(e.f._successSoundBags)), bag, 'Muted answers neither download nor consume sound choices');
    console.log('PASS: actual generic/chapter assets, tier-preserving shuffle bags, full-cycle uniqueness, boundary and cross-tier non-repetition, ordinary/highest-tier variation, chapter isolation, mute and stale-request cancellation.');
})().catch(error => {console.error(error); process.exitCode = 1;});
