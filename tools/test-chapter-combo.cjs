const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText;
class AudioClip {
    constructor(name) { this.name = name; this.refs = 0; }
    addRef() { this.refs++; }
    decRef() { assert.ok(this.refs > 0); this.refs--; }
}
const files = new Map(), requests = [], scans = [], warnings = [];
for (const [chapter, group] of [['qing-hua-ci', 'Combo _F_type_QHC01'], ['meng-chong-san-guo', 'Combo _F_type_SG01']]) {
    const root = `assets/Bundle/levels/${chapter}/Combo _F_type/${group}`;
    const paths = fs.readdirSync(root).filter(file => /\.mp3$/i.test(file)).map(file => {
        assert.equal(JSON.parse(fs.readFileSync(`${root}/${file}.meta`)).importer, 'audio-clip');
        return `Combo _F_type/${group}/${file.replace(/\.mp3$/i, '')}`;
    });
    assert.equal(paths.length, 5);
    files.set(chapter, paths);
}
files.set('plain', []);
files.set('partial', ['Combo _F_type/incomplete/clip_01']);
const makeBundle = name => ({
    getDirWithPath(dir, Type) {
        assert.equal(Type, AudioClip); scans.push(name);
        return (files.get(name) || []).filter(path => path.startsWith(dir + '/')).map(path => ({ path }));
    },
    load(path, Type, done) {
        assert.equal(Type, AudioClip);
        if (files.has(name)) assert.ok(files.get(name).includes(path));
        requests.push({ name, path, done });
    },
});
const poolExports = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/ContentBundlePool.ts', 'utf8')), {
    exports: poolExports, require: () => ({ assetManager: {
        loadBundle(name, done) { name === 'offline' ? done(Error('offline')) : done(null, makeBundle(name)); },
        removeBundle() {},
    } }),
});
const text = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', text, ts.ScriptTarget.Latest, true);
const names = ['_comboClips', '_chapterComboClips', '_chapterComboGroup', '_comboSoundRequest', 'DEFAULT_COMBO_GROUP',
    'BUNDLE_COMBO_ROOT', '_activeComboGroup', '_comboGroups', '_comboGroupsScannedBundle', '_loadComboClip',
    '_comboClipRef', '_resolveChapterComboGroup', '_discoverComboGroups', '_updateComboGroup', 'playSuccessTone',
    'COMBO_WINDOW_MS', 'TOP_COMBO_WINDOW_MS', 'onDifferenceFound'];
const cls = tree.statements.find(ts.isClassDeclaration);
const body = cls.members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class GameFlow { ${body} }; GameFlow;`), {
    AudioClip, console: { warn: (...args) => warnings.push(args) },
});
const flush = () => new Promise(setImmediate);
function flow() {
    const f = new Flow(); f.isValid = true; f._contentBundles = new poolExports.ContentBundlePool();
    f._cities = [{ key: 'tutorial' }]; f.save = { data: { soundEnabled: true } };
    f._loadGameBundle = async () => makeBundle('MainGameSources');
    const played = [];
    f._comboSource = { isValid: true, clip: null, stop() {}, play() { played.push(this.clip.name); } };
    f.played = played;
    return f;
}
function finish(error = null) {
    const request = requests.shift(); assert.ok(request);
    const clip = error ? undefined : new AudioClip(`${request.name}:${request.path}`);
    request.done(error, clip); return { request, clip };
}
(async () => {
    const f = flow();
    for (const chapter of ['qing-hua-ci', 'meng-chong-san-guo']) {
        f._chapterComboGroup = await f._resolveChapterComboGroup({ key: chapter }, 'select');
        assert.equal(f._chapterComboGroup.chapterBundle, chapter);
        assert.equal(requests.length, 0, 'Index scans must not download all audio');
        const previous = f._chapterComboGroup;
        assert.equal((await f._resolveChapterComboGroup({ key: chapter }, 'retry')).name, previous.name);
        for (let stage = 1; stage <= 5; stage++) {
            const pending = f._loadComboClip(stage); await flush();
            assert.ok(f._contentBundles.users.has(chapter), 'Hold bundle during asynchronous load');
            const { request, clip } = finish(); assert.equal(request.name, chapter);
            assert.ok(request.path.endsWith(`_0${stage}`));
            assert.equal(await pending, clip); assert.equal(clip.refs, 1);
            assert.equal(await f._loadComboClip(stage), clip, 'Reuse the scoped cache');
        }
        for (const stage of [-1, 0]) {
            const pending = f._loadComboClip(stage); await flush();
            if (requests.length) { const { request } = finish(); assert.equal(request.name, 'MainGameSources'); }
            await pending;
        }
        // Exercise actual find events: the ordinary first hit must not consume the first combo tier.
        f._foundIds = new Set(); f._currentLevel = { differences: new Array(20) };
        f._combo = 0; f._lastFoundAt = 0; f._elapsedTime = 0;
        let rightSounds = 0; f.playRightSound = () => { rightSounds++; };
        const start = f.played.length;
        for (let hit = 1; hit <= 7; hit++) {
            f.onDifferenceFound({ id: `${chapter}-${hit}` }); await flush();
        }
        assert.equal(rightSounds, 1);
        assert.deepEqual(f.played.slice(start).map(name => Number(name.match(/_0(\d)$/)[1])), [1, 2, 3, 4, 5, 5],
            'Actual consecutive finds must play all five tiers in order, then keep the top tier');
        f.playSuccessTone(99); await flush();
        assert.ok(f.played.at(-1).endsWith('_05'), 'Combo over five stays at stage five');
    }
    assert.equal(f._chapterComboClips.size, 10);
    f._chapterComboGroup = await f._resolveChapterComboGroup({ key: 'plain' }, 'select');
    assert.equal(f._chapterComboGroup, null);
    f._updateComboGroup(f._cities[0], 0);
    assert.ok(f._comboClipRef(1).path.includes('Combo _F_type01/'));
    assert.equal(f._comboClipRef(1).chapterBundle, undefined, 'Do not leak chapter sounds into other chapters');
    for (const group of ['Combo _F_type01', 'Combo _F_type02', 'Combo _F_type03']) {
        f._activeComboGroup = group;
        for (let combo = 2; combo <= 7; combo++) {
            f.playSuccessTone(combo); await flush();
            if (requests.length) { assert.equal(requests[0].name, 'MainGameSources'); finish(); await flush(); }
            assert.ok(f.played.at(-1).endsWith(`_0${Math.min(5, combo - 1)}`), `${group} must expose all five tiers`);
        }
    }
    assert.equal(await f._resolveChapterComboGroup({ key: 'partial' }, 'select'), null);
    assert.equal(await f._resolveChapterComboGroup({ key: 'offline' }, 'select'), null);
    assert.equal(warnings.length, 1);
    const g = flow();
    g._chapterComboGroup = await g._resolveChapterComboGroup({ key: 'qing-hua-ci' }, 'select');
    g.playSuccessTone(2); await flush();
    ++g._comboSoundRequest; // Round/page changed before the download finishes.
    finish(); await flush(); assert.equal(g.played.length, 0);
    g.save.data.soundEnabled = false; g.playSuccessTone(3);
    assert.equal(requests.length, 0, 'Sound toggle must prevent downloads and playback');
    g.save.data.soundEnabled = true;
    const failed = g._loadComboClip(3); await flush(); finish(Error('download failed'));
    await assert.rejects(failed);
    const retry = g._loadComboClip(3); await flush(); finish(); await retry;
    const disposed = g._loadComboClip(4); await flush(); g.isValid = false;
    const late = finish().clip; await disposed; assert.equal(late.refs, 0, 'Do not retain clips after destruction');
    const destroy = cls.members.find(m => m.name?.getText(tree) === 'onDestroy').getText(tree);
    assert.ok(destroy.includes('for (const clip of this._chapterComboClips) clip.decRef()'));
    for (const owner of [f, g]) { for (const clip of owner._chapterComboClips) clip.decRef(); owner._chapterComboClips.clear(); }
    assert.deepEqual([...new Set(scans)].sort(), ['meng-chong-san-guo', 'partial', 'plain', 'qing-hua-ci']);
    console.log('PASS: actual QHC/SG five-stage assets, chapter-only discovery/loading, scoped cache/ref lifetime, retry, fallback, mute and stale-playback guards.');
})().catch(error => { console.error(error); process.exitCode = 1; });
