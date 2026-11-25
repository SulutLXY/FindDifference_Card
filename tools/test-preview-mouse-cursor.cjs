const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source = fs.readFileSync('assets/scripts/ui/PreviewMouseCursor.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText;
const tick = () => new Promise(setImmediate);
function fixture({ preview = true, html5 = false, browser = true, mobile = false, mouse = true, dom = true } = {}) {
    let cursor = 'crosshair', priority = 'important', requests = 0, draws = 0, resolve, reject;
    const canvas = { style: {
        getPropertyValue: () => cursor, getPropertyPriority: () => priority,
        setProperty: (_, value, p = '') => { cursor = value; priority = p; },
        removeProperty: () => { cursor = ''; priority = ''; },
    } };
    const image = { width: 94, height: 98, data: {}, refs: 0,
        addRef() { this.refs++; }, decRef() { this.refs--; } };
    const exports = {}, warnings = [];
    const context = { exports, console: { warn: (...args) => warnings.push(args) },
        require: name => name === 'cc/env' ? { PREVIEW: preview, HTML5: html5 }
            : { game: { canvas }, sys: { isBrowser: browser, isMobile: mobile } },
    };
    if (dom) Object.assign(context, {
        window: { matchMedia: () => ({ matches: mouse }) },
        document: { createElement: () => ({ width: 0, height: 0,
            getContext: () => ({ drawImage() { draws++; } }), toDataURL: () => 'data:image/png;base64,cursor',
        }) },
    });
    vm.runInNewContext(code, context);
    const dispose = exports.installPreviewMouseCursor(() => {
        requests++;
        return new Promise((yes, no) => { resolve = yes; reject = no; });
    });
    return { canvas, image, dispose, warnings, requests: () => requests, cursor: () => cursor,
        priority: () => priority, draws: () => draws, load: () => resolve(image), fail: () => reject(Error('offline')) };
}
(async () => {
    for (const options of [{ preview: false }, { preview: false, html5: true, mobile: true }, { mobile: true },
        { browser: false }, { mouse: false }, { dom: false }]) {
        const f = fixture(options);
        assert.equal(f.requests(), 0, 'Mobile, native and mini-game runtimes must never request a cursor image');
        assert.equal(f.cursor(), 'crosshair');f.dispose();
    }
    let f = fixture();assert.equal(f.requests(), 1);f.load();await tick();
    assert.match(f.cursor(), /^url\("data:image\/png;base64,cursor"\) 16 4, auto$/);
    assert.equal(f.draws(), 1);assert.equal(f.image.refs, 0);
    f.dispose();assert.equal(f.cursor(), 'crosshair');assert.equal(f.priority(), 'important');

    f = fixture();f.dispose();f.load();await tick();
    assert.equal(f.draws(), 0);assert.equal(f.cursor(), 'crosshair');assert.equal(f.image.refs, 0);

    f = fixture();f.fail();await tick();assert.equal(f.cursor(), 'crosshair');assert.equal(f.warnings.length, 1);

    f = fixture();f.load();await tick();f.canvas.style.setProperty('cursor', 'wait');f.dispose();
    assert.equal(f.cursor(), 'wait', 'Do not overwrite a cursor subsequently installed by another owner');
    f = fixture({ preview: false, html5: true });assert.equal(f.requests(), 1);f.load();await tick();
    assert.match(f.cursor(), /^url\(/, 'A published desktop H5 build also installs the cursor');f.dispose();
    console.log('PASS web cursor: desktop Creator and published H5, no mobile/mini-game requests, hotspot, failure fallback and teardown');
})().catch(error => { console.error(error); process.exitCode = 1; });
