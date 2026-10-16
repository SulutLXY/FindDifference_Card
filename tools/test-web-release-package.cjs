const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { packageRelease } = require('./package-web-release.cjs');
const base = fs.mkdtempSync(path.resolve('temp/web-package-test-'));
const input = path.join(base, 'input'), output = path.join(base, 'publish');
function write(file, data) { const target = path.join(input, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); }
write('index.html', '<script src="index.aaaaa.js"></script>');
write('index.aaaaa.js', 'first build');
write('src/settings.aaaaa.json', JSON.stringify({ engine: { platform: 'web-mobile' }, assets: { remoteBundles: [], bundleVers: { main: 'aaaaa' } } }));
write('assets/main/config.aaaaa.json', '{}');
const first = packageRelease(input, output);
const launcher = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
write('index.aaaaa.js', 'second build');
const second = packageRelease(input, output);
assert.notEqual(first.id, second.id, 'Changed content must use an isolated release directory');
assert.equal(fs.readFileSync(path.join(output, 'releases', first.id, 'index.aaaaa.js'), 'utf8'), 'first build');
assert.equal(fs.readFileSync(path.join(output, 'releases', second.id, 'index.aaaaa.js'), 'utf8'), 'second build');
assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), launcher, 'The cached launcher must stay compatible with future manifests');
const repeated = packageRelease(input, output);
assert.equal(repeated.id, second.id, 'Identical builds reuse their immutable release');
assert.throws(() => packageRelease(input, path.join(input, 'nested')), /重叠/);
write('src/settings.aaaaa.json', JSON.stringify({ engine: { platform: 'web-mobile' }, assets: { remoteBundles: ['main'] } }));
assert.throws(() => packageRelease(input, output), /远程包/);
const script = /<script>([\s\S]*?)<\/script>/.exec(launcher)[1];
async function launch(manifest) {
    const frame = {}, status = { appendChild() {} }, calls = [];
    const location = { href: 'https://game.test/folder/index.html?from=share#level', search: '?from=share', hash: '#level', reload() {} };
    vm.runInNewContext(script, {
        URL, AbortController, setTimeout, clearTimeout, location,
        document: { getElementById: id => id === 'game' ? frame : status, createElement: () => ({}) },
        console: { error() {} }, window: { addEventListener() {} },
        localStorage: { clear() { throw Error('Player saves must survive'); } },
        fetch: async (url, options) => { calls.push({url, options}); return { ok: true, json: async () => manifest }; },
    });
    await new Promise(resolve => setImmediate(resolve));
    return { frame, status, calls };
}
(async () => {
    const oldLauncher = await launch({ id: second.id });
    assert.equal(oldLauncher.calls[0].options.cache, 'no-store');
    assert.ok(new URL(oldLauncher.calls[0].url).searchParams.has('_fd_check'));
    assert.equal(oldLauncher.frame.src, `https://game.test/folder/releases/${second.id}/index.html?from=share#level`);
    assert.equal(oldLauncher.status.hidden, true); assert.equal(oldLauncher.frame.hidden, false);
    const invalid = await launch({ id: '../../another-game' });
    assert.equal(invalid.frame.src, undefined); assert.ok(invalid.status.textContent.includes('加载失败'));
    console.log('PASS: complete release validation, stable cached launcher, unique immutable builds, old files preserved, moved folder URLs, manifest revalidation and safe failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
