const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018,
} }).outputText;
const exportsMixer = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/BackgroundMusicMixer.ts', 'utf8')), { exports: exportsMixer });
class Clip {
    constructor(name) { this.name = name; this.refs = 0; }
    addRef() { this.refs++; }
    decRef() { assert.ok(this.refs > 0); this.refs--; }
}
const sources = [0, 1].map(() => ({ isValid: true, clip: null, volume: 1, plays: 0,
    play() { this.plays++; }, stop() {} }));
const mixer = new exportsMixer.BackgroundMusicMixer(sources);
const a = new Clip('home'), b = new Clip('chapter'), c = new Clip('third');
const released = [];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const channel = clip => sources.find(source => source.clip === clip);
assert.ok(sources.every(source => source.loop && !source.playOnAwake && source.volume === 0));
mixer.play('home', a, () => released.push('home'));
close(channel(a).volume, 0);
mixer.update(.75); close(channel(a).volume, .5);
mixer.update(.75); close(channel(a).volume, 1);
const homePlays = channel(a).plays;
assert.equal(mixer.resume('home'), true);
assert.equal(channel(a).plays, homePlays, 'Same track continues without restarting');

mixer.play('chapter', b, () => released.push('chapter'));
close(channel(a).volume, 1); close(channel(b).volume, 0);
assert.equal(a.refs, 1, 'Outgoing clip is retained throughout fade-out');
mixer.update(.75);
close(channel(a).volume, .5); close(channel(b).volume, .5);
assert.equal(released.length, 0, 'Outgoing bundle stays alive during overlap');

// The actual GameFlow result-audio handlers must multiply both envelopes, never overwrite them.
const flowText = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const ast = ts.createSourceFile('GameFlow.ts', flowText, ts.ScriptTarget.Latest, true);
const names = ['_onResultAudioStarted', '_onResultAudioEnded', '_restoreResultMusicVolume', 'update'];
const body = ast.statements.find(ts.isClassDeclaration).members
    .filter(member => names.includes(member.name?.getText(ast))).map(member => member.getText(ast)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow {${body}}; Flow;`), {});
const flow = new Flow(); flow._musicMixer = mixer; flow._resultSource = {};
flow._onResultAudioStarted({}); close(channel(a).volume, .5);
flow._onResultAudioStarted(flow._resultSource);
close(channel(a).volume, .25); close(channel(b).volume, .25);
mixer.update(.375);
close(channel(a).volume, .125); close(channel(b).volume, .375);
flow._onResultAudioEnded({}); close(channel(b).volume, .375);
flow._onResultAudioEnded(flow._resultSource);
close(channel(a).volume, .25); close(channel(b).volume, .75);
mixer.update(.375);
assert.equal(a.refs, 0); assert.deepEqual(released, ['home']);
assert.equal(channel(a), undefined); close(channel(b).volume, 1);

// Rapidly returning to an outgoing track preserves its playback position and current gain.
mixer.play('home', a, () => released.push('home-again'));
mixer.update(.3);
close(channel(a).volume, .2); close(channel(b).volume, .8);
const chapterPlays = channel(b).plays;
assert.equal(mixer.resume('chapter'), true);
close(channel(a).volume, .2); close(channel(b).volume, .8);
mixer.update(.75);
close(channel(a).volume, .1); close(channel(b).volume, .9);
assert.equal(channel(b).plays, chapterPlays);
mixer.update(.75); assert.equal(a.refs, 0); close(channel(b).volume, 1);

// A third request uses at most two voices and releases the quieter interrupted voice.
mixer.play('home', a, () => released.push('home-third'));
mixer.update(.15);
mixer.play('third', c, () => released.push('third'));
assert.equal(a.refs, 0); assert.equal(b.refs, 1); assert.equal(c.refs, 1);
assert.equal(sources.filter(source => source.clip).length, 2);
mixer.update(1.5); assert.equal(b.refs, 0); close(channel(c).volume, 1);

// The fade advances outside the gameplay timer, including Loading, paused and result pages.
flow.feed = { isPreview: false }; flow._tryFeedOffer = () => {};
flow.platform = { interstitialBusy: true };
mixer.play('home', a);
flow.update(.75); close(channel(a).volume, .5); close(channel(c).volume, .5);
flow.platform.interstitialBusy = false; flow._levelLoading = true;
flow.update(.75); close(channel(a).volume, 1); assert.equal(c.refs, 0);
mixer.play('third', c, () => released.push('third-final'));
mixer.update(.5);
assert.equal(a.refs, 1); assert.equal(c.refs, 1);
mixer.stop();
assert.equal(a.refs, 0); assert.equal(c.refs, 0);
assert.ok(released.includes('third-final'), 'Stopping during a fade releases both voices immediately');
assert.ok(sources.every(source => source.clip === null && source.volume === 0));
mixer.update(10); assert.ok(sources.every(source => source.volume === 0), 'Stopped fades cannot restart');
mixer.stop(); assert.equal(a.refs, 0, 'Repeated stop is safe');
console.log('PASS music crossfade: 1.5s overlap, linear gains, deferred reference release, same-track continuation, rapid reversal/third track, result ducking, Loading/interstitial updates and immediate stop.');
