const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const creator = process.env.COCOS_CREATOR_ROOT || 'D:/CocosCreator/v3.8.8';
const ejs = require(path.join(creator, 'resources/resources/3d/engine/node_modules/ejs'));
const template = 'build-templates/web-mobile/index.ejs';
function render() {
    return ejs.render(fs.readFileSync(template, 'utf8'), {
        projectName: 'FindDifference', cssUrl: 'style.123ab.css',
        cocosTemplate: path.join(creator, 'resources/resources/3d/engine/templates/web-mobile/index-plugin.ejs'),
        webDebuggerSrc: '', polyfillsBundleFile: 'src/polyfills.bundle.123ab.js',
        systemJsBundleFile: 'src/system.bundle.456cd.js', importMapFile: 'src/import-map.789ef.json',
        indexJsName: 'index.abcde.js',
    }, { filename: path.resolve(template) });
}
const build = html => /name="find-difference-build" content="([a-z0-9-]+)"/.exec(html)[1];
const old = render(), latest = render();
assert.notEqual(build(old), build(latest), 'Every build must have a unique release identifier');
assert.ok(old.includes('href="style.123ab.css"'));
assert.ok(old.includes('src="src/system.bundle.456cd.js"'));
assert.ok(!old.includes('_fd_build='), 'Keep exact file URLs so Cocos can rewrite MD5 names after template rendering');
assert.ok(old.includes('#WebReleaseError[hidden] { display: none !important; }'), 'Cocos global div styles must not expose the hidden release overlay');
const inline = html => [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
async function run(html, response, href = 'https://example.com/game/?from=share#level') {
    const requests = [], redirects = [], imports = [], warnings = [], events = {};
    const errorPanel = { hidden: true };
    const storage = new Map([['find-difference.save.v3', '{"completed":{"one":3}}']]);
    const window = { location: { href, replace: url => redirects.push(url) }, addEventListener: (name, fn) => events[name] = fn };
    const sandbox = {
        window, URL, AbortController, setTimeout, clearTimeout,
        console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
        localStorage: { clear() { throw Error('Must never clear player storage'); }, getItem: key => storage.get(key) },
        document: { getElementById: () => errorPanel },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (response instanceof Error) throw response;
            return { ok: true, text: async () => response };
        },
        System: { import: name => { imports.push(name); return Promise.resolve(); } },
    };
    vm.createContext(sandbox);
    for (const script of inline(html)) vm.runInContext(script, sandbox);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(storage.get('find-difference.save.v3'), '{"completed":{"one":3}}');
    return { requests, redirects, imports, warnings, events, errorPanel };
}
(async () => {
    const current = await run(latest, latest);
    assert.equal(current.imports.length, 1);
    assert.equal(current.requests[0].options.cache, 'no-store');
    assert.equal(new URL(current.requests[0].url).pathname, '/game/index.html');
    const stale = await run(old, latest);
    assert.equal(stale.imports.length, 0, 'Stale entry must not start the old game');
    assert.equal(stale.redirects.length, 1);
    const target = new URL(stale.redirects[0]);
    assert.equal(target.searchParams.get('from'), 'share'); assert.equal(target.hash, '#level');
    assert.equal(target.searchParams.get('_fd_release'), build(latest));
    const updated = await run(latest, latest, target.href);
    assert.equal(updated.imports.length, 1); assert.equal(updated.redirects.length, 0);
    const badCdn = await run(old, latest, target.href);
    assert.equal(badCdn.redirects.length, 0, 'Do not loop if CDN still returns stale HTML');
    assert.equal(badCdn.imports.length, 0); assert.equal(badCdn.errorPanel.hidden, false);
    const offline = await run(latest, Error('offline'));
    assert.equal(offline.imports.length, 1, 'Network errors preserve current hashed build availability');
    const ordinaryShow = current.requests.length;
    current.events.pageshow({ persisted: false });
    assert.equal(current.requests.length, ordinaryShow);
    current.events.pageshow({ persisted: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(current.requests.length, ordinaryShow + 1, 'BFCache restoration must check the server');
    assert.notEqual(current.requests[0].url, current.requests[1].url, 'Probe URLs bypass stale response caches');
    const mobile = JSON.parse(fs.readFileSync('profiles/v2/packages/web-mobile.json', 'utf8'));
    assert.equal(mobile.builder.common.md5Cache, true);
    assert.ok(!fs.readFileSync(template, 'utf8').includes('localStorage.clear'));
    console.log('PASS: actual Cocos EJS template, unique releases, startup gate, same-URL upgrade, stale CDN loop guard, offline fallback, BFCache checks and player save preservation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
