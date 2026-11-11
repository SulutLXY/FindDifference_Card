const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText;
class AudioClip {
    constructor(name) { this.name = name; this.refs = 0; }
    addRef() { this.refs++; return this; }
    decRef() { assert.ok(this.refs > 0); this.refs--; return this; }
}
const loads = [], queries = [], removed = [], warnings = [];
const files = new Map();
const sanguo = 'meng-chong-san-guo';
const petStory = 'chong-wu-gu-shi';
const reGeng = 'nian-du-re-geng';
const qingHuaCi = 'qing-hua-ci';
const nanJing = 'nan-jing';
for (const chapter of [sanguo, petStory, reGeng, qingHuaCi, nanJing]) {
    const root = `assets/Bundle/levels/${chapter}/BGmusic`;
    files.set(chapter, fs.readdirSync(root).filter(name => /\.(mp3|ogg|wav)$/i.test(name))
        .map(name => `BGmusic/${name.replace(/\.[^.]+$/, '')}`));
}
assert.ok(files.get(sanguo).includes('BGmusic/Game_music_sanguo'), 'New music must exist in the real chapter bundle');
assert.ok(files.get(petStory).includes('BGmusic/Game_music_PetStory'), 'Pet Story music must exist in its chapter bundle');
assert.ok(files.get(reGeng).includes('BGmusic/Game_music_ReGeng'), 'Annual memes music must exist in its chapter bundle');
assert.ok(files.get(qingHuaCi).includes('BGmusic/Game_music_Qihuaci'), 'Porcelain music must exist in its chapter bundle');
assert.ok(files.get(nanJing).includes('BGmusic/Game_music_Nanjing'), 'Nanjing music must exist in its chapter bundle');
files.set('plain', []);
files.set('other', ['BGmusic/Game_music_sanguo']); // Same path in another chapter must not reuse the clip.
files.set('multiple', ['BGmusic/b', 'BGmusic/a']);
const assetManager = {
    loadBundle(name, done) {
        if (name === 'offline') return done(Error('offline'));
        done(null, {
            name,
            getDirWithPath(dir, Type) {
                assert.equal(dir, 'BGmusic'); assert.equal(Type, AudioClip); queries.push(name);
                return (files.get(name) || []).map(path => ({ path }));
            },
            load(path, Type, done) { assert.equal(Type, AudioClip); loads.push({ bundle: name, path, done }); },
        });
    },
    removeBundle(bundle) { removed.push(bundle.name); },
};
const exportsPool = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/ContentBundlePool.ts', 'utf8')),
    { exports: exportsPool, require: () => ({ assetManager }) });
const mixerExports = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/BackgroundMusicMixer.ts', 'utf8')),
    { exports: mixerExports });
const mixers = [];
const text = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', text, ts.ScriptTarget.Latest, true);
const names = ['_musicPath', '_musicClips', '_musicRequest', '_chapterMusic',
    '_gameMusicPath', '_gameMusicStreak', 'GAME_MUSIC_POOL', '_playPageMusic', '_cacheMusicClip',
    '_resolveChapterMusic', '_currentGameMusic', '_isRandomMusicLevel', '_updateGameMusic', 'setMusicEnabled'];
const body = tree.statements.find(ts.isClassDeclaration).members
    .filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class GameFlow { ${body} }; GameFlow;`),
    { AudioClip, console: { warn: (...args) => warnings.push(args) } });
const flush = () => new Promise(setImmediate);
const finish = (error = null) => {
    const load = loads.shift(); assert.ok(load, 'Expected a pending audio load');
    const clip = error ? undefined : new AudioClip(`${load.bundle}:${load.path}`);
    load.done(error, clip);
    for (const mixer of mixers) mixer.update(1.5);
    return clip;
};
const playCurrent = flow => { const m = flow._currentGameMusic(); flow._playPageMusic(m.path, m.fromBundle, m.chapterBundle); };
function flow() {
    const f = new Flow(); f.isValid = true; f._contentBundles = new exportsPool.ContentBundlePool();
    f.save = { data: { musicEnabled: true }, setMusicEnabled(value) { this.data.musicEnabled = value; } };
    f.game = { node: { active: true } };
    const played = [];
    const sources = [0, 1].map(() => ({ isValid: true, clip: null, volume: 0, stop() {}, play() { played.push(this.clip.name); } }));
    f._musicMixer = new mixerExports.BackgroundMusicMixer(sources); mixers.push(f._musicMixer);
    f._musicSource = { played, get clip() { return sources.find(source => source.clip)?.clip ?? null; } };
    Object.defineProperty(f, '_chapterMusicClip', { get: () => f._musicMixer.voices.find(voice => voice.target === 1)?.clip });
    f._loadGameBundle = async () => ({ load(path, Type, done) { loads.push({ bundle: 'MainGameSources', path, done }); } });
    f._loadLobbyBundle = async () => ({ load(path, Type, done) { loads.push({ bundle: 'MainLobbySources', path, done }); } });
    return f;
}
(async () => {
    const f = flow();
    f._chapterMusic = await f._resolveChapterMusic({ key: sanguo }, 'select');
    assert.equal(f._chapterMusic.path, 'BGmusic/Game_music_sanguo');
    assert.equal(loads.length, 0, 'Directory discovery must not download all music');
    await f._resolveChapterMusic({ key: sanguo }, 'retry');
    assert.equal(queries.filter(key => key === sanguo).length, 2, 'Check the chapter index on every entry');
    playCurrent(f); await flush();
    assert.equal(loads[0].bundle, sanguo);
    const clip = finish(); await flush();
    assert.equal(clip.refs, 1); assert.ok(f._contentBundles.users.has(sanguo), 'Playback owns chapter bundle');
    playCurrent(f); assert.equal(loads.length, 0); assert.equal(f._musicSource.played.length, 1, 'Same track continues');
    f.setMusicEnabled(false); await flush();
    assert.equal(clip.refs, 0); assert.equal(f._musicSource.clip, null);
    assert.equal(f._contentBundles.users.size, 0, 'Disabling music releases ownership');
    f.setMusicEnabled(true); await flush(); finish(); await flush();
    assert.equal(f._musicSource.played.length, 2, 'Re-enable resumes chapter music');

    const previousClip = f._chapterMusicClip;
    f._chapterMusic = await f._resolveChapterMusic({ key: petStory }, 'select');
    assert.equal(f._chapterMusic.path, 'BGmusic/Game_music_PetStory');
    playCurrent(f); await flush();
    assert.equal(loads[0].bundle, petStory); assert.equal(loads[0].path, 'BGmusic/Game_music_PetStory');
    assert.equal(previousClip.refs, 1, 'Keep the previous track alive while downloading its replacement');
    const petClip = finish(); await flush();
    assert.equal(previousClip.refs, 0, 'Release the previous track after its fade-out');
    assert.equal(petClip.refs, 1);
    assert.ok(f._musicSource.played.at(-1).startsWith(`${petStory}:`));
    f._chapterMusic = await f._resolveChapterMusic({ key: petStory }, 'retry');
    playCurrent(f); assert.equal(loads.length, 0, 'Retrying Pet Story continues the same track');

    f._chapterMusic = await f._resolveChapterMusic({ key: reGeng }, 'select');
    assert.equal(f._chapterMusic.path, 'BGmusic/Game_music_ReGeng');
    playCurrent(f); await flush();
    assert.equal(loads[0].bundle, reGeng); assert.equal(loads[0].path, 'BGmusic/Game_music_ReGeng');
    assert.equal(petClip.refs, 1, 'Keep Pet Story playing while downloading Annual Memes');
    finish(); await flush();
    assert.equal(petClip.refs, 0, 'Release Pet Story after its fade-out');
    assert.ok(f._musicSource.played.at(-1).startsWith(`${reGeng}:`));
    f._chapterMusic = await f._resolveChapterMusic({ key: reGeng }, 'retry');
    playCurrent(f); assert.equal(loads.length, 0, 'Retrying Annual Memes continues the same track');

    for (const [chapter, path] of [[qingHuaCi, 'BGmusic/Game_music_Qihuaci'], [nanJing, 'BGmusic/Game_music_Nanjing']]) {
        const oldClip = f._chapterMusicClip;
        f._chapterMusic = await f._resolveChapterMusic({ key: chapter }, 'select');
        assert.equal(f._chapterMusic.path, path);
        playCurrent(f); await flush();
        assert.equal(loads[0].bundle, chapter); assert.equal(loads[0].path, path);
        assert.equal(oldClip.refs, 1, 'Pending chapter music keeps the previous track');
        const chapterClip = finish(); await flush();
        assert.equal(oldClip.refs, 0, 'Finished fade-out releases the previous track');
        assert.equal(chapterClip.refs, 1);
        assert.equal(f._musicSource.played.at(-1), `${chapter}:${path}`);
        for (const entry of ['streak', 'retry']) {
            f._chapterMusic = await f._resolveChapterMusic({ key: chapter }, entry);
            playCurrent(f);
            assert.equal(loads.length, 0, `${entry} continues the same chapter track`);
        }
        f.setMusicEnabled(false);
        assert.equal(chapterClip.refs, 0);
        assert.equal(f._contentBundles.users.size, 0);
        f.setMusicEnabled(true); await flush();
        assert.equal(loads[0].bundle, chapter, 'Enabling music restores the current chapter track');
        finish(); await flush();
    }

    f._chapterMusic = await f._resolveChapterMusic({ key: 'other' }, 'select');
    playCurrent(f); await flush();
    assert.equal(loads[0].bundle, 'other', 'Cache identity includes chapter, even with matching file names');
    const otherClip = finish(); await flush();
    assert.equal(otherClip.refs, 1);
    f._playPageMusic('voice/BGmusic/Main_music00'); await flush();
    assert.equal(otherClip.refs, 1, 'Keep the chapter track until lobby music is ready');
    finish(); await flush();
    assert.equal(otherClip.refs, 0); assert.ok(removed.includes('other'));
    assert.ok(f._musicSource.played.at(-1).startsWith('MainLobbySources:'));

    f._chapterMusic = await f._resolveChapterMusic({ key: 'plain' }, 'select');
    assert.equal(f._chapterMusic, null);
    playCurrent(f); await flush();
    assert.equal(loads[0].path, 'voice/BGmusic/Game_music01'); finish(); await flush();
    f._chapterMusic = await f._resolveChapterMusic({ key: 'multiple' }, 'select');
    assert.ok(files.get('multiple').includes(f._chapterMusic.path));
    const chosen = f._chapterMusic.path;
    assert.equal((await f._resolveChapterMusic({ key: 'multiple' }, 'retry')).path, chosen);
    playCurrent(f); await flush(); finish(Error('audio offline')); await flush();
    assert.equal(f._chapterMusic, null, 'Failed chapter audio falls back to generic game music');
    assert.ok(f._musicSource.played.at(-1).includes('Game_music01'));
    assert.equal(f._contentBundles.users.size, 0);
    assert.equal(await f._resolveChapterMusic({ key: 'offline' }, 'select'), null);

    // Navigation and settings can change while a chapter download is in flight.
    const late = flow();
    late._chapterMusic = await late._resolveChapterMusic({ key: sanguo }, 'select');
    playCurrent(late); await flush();
    late._playPageMusic('voice/BGmusic/Main_music00'); await flush();
    const stale = finish(); await flush(); assert.equal(stale.refs, 0);
    assert.equal(late._contentBundles.users.size, 0, 'Stale result releases operation lease');
    finish(); await flush(); assert.equal(late._musicSource.played.length, 1);
    assert.ok(late._musicSource.played[0].startsWith('MainLobbySources:'));
    late._chapterMusic = await late._resolveChapterMusic({ key: sanguo }, 'select');
    playCurrent(late); await flush(); late.setMusicEnabled(false);
    const muted = finish(); await flush(); assert.equal(muted.refs, 0);
    assert.equal(late._musicSource.played.length, 1);
    late.feed = { isPreview: true }; playCurrent(late); assert.equal(loads.length, 0, 'Feed preview stays silent');
    late.feed.isPreview = false; late.save.data.musicEnabled = true;
    playCurrent(late); await flush(); late.isValid = false; late._musicRequest++;
    late._musicMixer.stop(); late._contentBundles.dispose();
    const destroyed = finish(); await flush(); assert.equal(destroyed.refs, 0);
    assert.equal(late._contentBundles.users.size, 0);

    // Reverting to the still-playing page cancels the pending track, without stopping/restarting it.
    const back = flow();
    back._playPageMusic('voice/BGmusic/Main_music00'); await flush();
    const homeClip = finish(); await flush();
    assert.equal(homeClip.refs, 2, 'Generic cache and active voice each retain the clip');
    back._chapterMusic = await back._resolveChapterMusic({ key: qingHuaCi }, 'select');
    playCurrent(back); await flush();
    assert.equal(homeClip.refs, 2, 'Pending chapter download keeps the home music');
    back._playPageMusic('voice/BGmusic/Main_music00');
    assert.equal(back._musicSource.played.length, 1, 'Returning before download completion does not restart home music');
    const cancelled = finish(); await flush();
    assert.equal(cancelled.refs, 0); assert.equal(back._contentBundles.users.size, 0);
    playCurrent(back); await flush(); finish(); await flush();
    assert.equal(homeClip.refs, 1, 'Fading out home keeps its cache reference for the return journey');
    back._playPageMusic('voice/BGmusic/Main_music00');
    assert.equal(loads.length, 0, 'Returning home reuses the valid cached clip');
    back._musicMixer.update(1.5);
    assert.equal(homeClip.refs, 2);
    back.setMusicEnabled(false);
    assert.equal(homeClip.refs, 1, 'Disabling music releases voices but keeps reusable generic cache');

    const a = { key: 'plain' }, b = { key: sanguo }; f._cities = [a, b];
    f._updateGameMusic(a, 0, 'select'); assert.equal(f._gameMusicPath, '');
    f._updateGameMusic(a, 4, 'select'); const selected = f._gameMusicPath;
    assert.ok(selected.startsWith('voice/BGmusic/Game_music0'));
    f._updateGameMusic(a, 5, 'streak'); assert.equal(f._gameMusicPath, selected);
    f._updateGameMusic(b, 0, 'retry'); assert.equal(f._gameMusicPath, selected);
    console.log('PASS chapter music: real sanguo/PetStory/ReGeng/Qihuaci/Nanjing assets, cross-chapter switch, per-entry discovery, generic fallback, multiple tracks/retry, scoped cache, settings, navigation races, feed silence and bundle lifetime');
})().catch(error => { console.error(error); process.exitCode = 1; });
