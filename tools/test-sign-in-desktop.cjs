const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
const config = JSON.parse(fs.readFileSync('assets/resources/configs/daily-sign-in.json', 'utf8'));
const prefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/DailySignInModal.prefab', 'utf8'));
const findAsset = name => prefab.find(n => n.__type__ === 'cc.Node' && n._name === name);
const choice = findAsset('AddDesktopChoice');
assert.ok(choice && choice._active);
const caption = choice._children.map(r => prefab[r.__id__]).find(n => n._name === 'Label');
assert.equal(caption._components.map(r => prefab[r.__id__]).find(c => c.__type__ === 'cc.Label')._string, '同时添加桌面');
assert.equal(choice._children.map(r => prefab[r.__id__]).find(n => n._name === 'Checkmark')._active, true);
const height = node => node._components.map(r => prefab[r.__id__]).find(c => c.__type__ === 'cc.UITransform')._contentSize.height;
assert.ok(choice._lpos.y + height(choice) / 2 < findAsset('BtnNormal')._lpos.y - height(findAsset('BtnNormal')) / 2, 'Choice fits below the existing buttons');
// The artist may reorder the footer and enlarge the checkmark; keep panel bounds rather than freezing that layout.
assert.ok(choice._lpos.y - height(choice) / 2 >= -height(findAsset('ResultCard')) / 2, 'Choice touch area stays inside the authored panel');
assert.ok(findAsset('Rules')._lpos.y - height(findAsset('Rules')) / 2 >= -height(findAsset('ResultCard')) / 2, 'Footer stays inside the fixed panel');
class UITransform {} class Button {} class Vec2 { constructor(x, y) { Object.assign(this, { x, y }); } }
const tick = () => new Promise(setImmediate);
function setup(dpr, kind = 'douyin', allowAsyncShortcut = false) {
    let gesture = false, claimed = false, claims = 0, desktopCalls = 0, videos = 0, shortcut, finishVideo;
    const events = [];
    const nativeHandlers = new Set(), handlers = new Map(), check = { active: true };
    const tt = {
        getSystemInfoSync: () => ({ platform: 'android', pixelRatio: dpr }),
        onTouchEnd(fn) { nativeHandlers.add(fn); }, offTouchEnd(fn) { nativeHandlers.delete(fn); },
        addShortcut(options) {
            assert.equal(claimed, true, 'Save sign-in rewards before asking for desktop authorization');
            events.push('desktop'); desktopCalls++; shortcut = options;
            if (!gesture && !allowAsyncShortcut) options.fail({ errNo: 21500, errMsg: 'must be invoked by user gesture' });
        },
    };
    const platformExports = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8')), {
        exports: platformExports, globalThis: { tt }, setTimeout, clearTimeout, console: { warn() {}, info() {} },
        require: name => name === 'cc/env' ? { BYTEDANCE: kind === 'douyin', HTML5: kind === 'h5' }
            : name.includes('Sidebar') ? { SidebarService: class {} } : { PlayerInfoService: class {} },
    });
    const platform = new platformExports.PlatformService();
    class UIScreen { close() {} onDestroy() {} onDisable() {} }
    const exports_ = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/ui/DailySignInModal.ts', 'utf8')), {
        exports: exports_, globalThis: { tt }, console: { warn() {} },
        require: name => name === 'cc' ? { _decorator: { ccclass: () => Type => Type, property: () => () => {} },
            BlockInputEvents: class {}, Button, UITransform, Vec2, Node: class {}, JsonAsset: class {}, Label: class {},
            game: { on() {}, off() {} }, Game: {}, view: { getFrameSize: () => ({ height: 800 }) } }
            : name.includes('UIScreen') ? { UIScreen } : { sidebarDay: () => '2026-11-12' },
    });
    const modal = new exports_.DailySignInModal(); modal.isValid = true;
    const buttons = [100, 300].map(x => ({ isValid: true, activeInHierarchy: true, getComponent(Type) {
        return Type === UITransform ? { hitTest: p => Math.abs(p.x / dpr - x) < 50 && Math.abs(p.y / dpr - 100) < 30 }
            : Type === Button ? { enabledInHierarchy: true, interactable: true } : null;
    } }));
    modal.btnNormal = buttons[0]; modal.btnDouble = buttons[1];
    modal.node = { activeInHierarchy: true, getComponent() {}, addComponent() {} };
    modal._config = config;
    modal.resolveNode = (bound, path) => bound ?? (path.endsWith('AddDesktopChoice') ? {} : null);
    modal.findChildDeep = (_, name) => name === 'Checkmark' ? check : null;
    modal.wireButton = (_, path, handler) => handlers.set(path.split('/').at(-1), handler);
    modal._refresh = () => modal._syncDesktopChoice();
    const save = { freeHints: 2, energy: 15, energyLimit: 99,
        dailyStatus: () => ({ canClaim: !claimed, dayIndex: 1, reward: config.days[0] }),
        claimDailySignIn(_day, _config, multiplier) { if (claimed) return false; claimed = true; claims++; events.push('claim'); this.freeHints += multiplier; return true; },
    };
    modal.flow = { platform, save, toast() {}, requestReward: async (_, grant) => {
        videos++; events.push('video');
        if (await new Promise(resolve => { finishVideo = resolve; })) { events.push('video-complete'); grant(); }
    } };
    modal.onLoad(); modal._syncDesktopChoice();
    return { modal, check, handlers, save, nativeHandlers, events,
        get desktopCalls() { return desktopCalls; }, get claims() { return claims; }, get videos() { return videos; },
        tap(x) { gesture = true; for (const fn of nativeHandlers) fn({ changedTouches: [{ clientX: x, clientY: 700 }] }); gesture = false; },
        finishDesktop(success) { if (success) shortcut.success({}); else shortcut.fail({ errNo: 21305, errMsg: 'user cancel' }); },
        finishVideo(success) { finishVideo(success); },
    };
}
(async () => {
    for (const dpr of [1, 2, 3]) {
        const normal = setup(dpr);
        assert.equal(normal.check.active, true);
        normal.handlers.get('BtnNormal')(); assert.equal(normal.claims, 0, 'Engine callback defers to native synchronous handler');
        normal.tap(500); assert.equal(normal.desktopCalls, 0, 'Outside taps do nothing');
        normal.tap(100); assert.equal(normal.desktopCalls, 1); assert.equal(normal.claims, 1); assert.equal(normal.save.freeHints, 3);
        assert.deepEqual(normal.events, ['claim', 'desktop']);
        normal.tap(100); assert.equal(normal.desktopCalls, 1, 'Already claimed cannot repeat desktop requests');
        normal.finishDesktop(false); await tick(); assert.equal(normal.claims, 1, 'Desktop cancellation never rolls back sign-in');
        normal.modal.onDestroy(); assert.equal(normal.nativeHandlers.size, 0);

        const unchecked = setup(dpr); unchecked.handlers.get('AddDesktopChoice')();
        assert.equal(unchecked.check.active, false);
        unchecked.tap(100); assert.equal(unchecked.desktopCalls, 0); assert.equal(unchecked.claims, 1);
        unchecked.modal.onDestroy();

        // A permissive host verifies the requested auto-flow; strict gesture rejection is covered below.
        const double = setup(dpr, 'douyin', true); double.tap(300);
        assert.equal(double.desktopCalls, 0); assert.equal(double.videos, 1); assert.equal(double.claims, 0);
        double.tap(300); assert.equal(double.videos, 1, 'Pending click cannot duplicate videos');
        double.finishVideo(true); await tick(); assert.equal(double.save.freeHints, 4);
        assert.equal(double.desktopCalls, 1, 'Automatically request desktop authorization after video and saved rewards, without another click');
        double.tap(300); assert.equal(double.desktopCalls, 1);
        assert.deepEqual(double.events, ['video', 'video-complete', 'claim', 'desktop']);
        double.finishDesktop(false); await tick(); assert.equal(double.claims, 1); assert.equal(double.save.freeHints, 4);
        double.tap(300); assert.equal(double.desktopCalls, 1, 'Completed/cancelled desktop request cannot repeat rewards or video');
        double.modal.onDestroy();

        const cancelled = setup(dpr); cancelled.tap(300); cancelled.finishVideo(false); await tick();
        assert.equal(cancelled.claims, 0); assert.equal(cancelled.desktopCalls, 0);
        cancelled.tap(300); assert.equal(cancelled.videos, 2, 'Cancelled video can be retried');
        cancelled.finishVideo(true); await tick(); assert.equal(cancelled.claims, 1);
        assert.equal(cancelled.desktopCalls, 1, 'Attempt automatic desktop request even if the host rejects its async gesture');
        assert.equal(cancelled.save.freeHints, 4); assert.equal(cancelled.modal._pending, false);
        cancelled.tap(300); assert.equal(cancelled.desktopCalls, 1); assert.equal(cancelled.videos, 2);
        cancelled.modal.onDestroy();

        const uncheckedDouble = setup(dpr); uncheckedDouble.handlers.get('AddDesktopChoice')();
        uncheckedDouble.tap(300); uncheckedDouble.finishVideo(true); await tick();
        assert.equal(uncheckedDouble.claims, 1); assert.equal(uncheckedDouble.desktopCalls, 0);
        uncheckedDouble.modal.onDestroy();

        const unsaved = setup(dpr); unsaved.save.claimDailySignIn = () => false;
        unsaved.tap(300); unsaved.finishVideo(true); await tick();
        assert.equal(unsaved.claims, 0); assert.equal(unsaved.desktopCalls, 0);
        unsaved.modal.onDestroy();

        const closed = setup(dpr); closed.tap(300); closed.modal.node.activeInHierarchy = false;
        closed.finishVideo(true); await tick();
        assert.equal(closed.desktopCalls, 0, 'Closing while video plays cannot open a late desktop prompt');
        closed.modal.onDestroy();
    }
    const web = setup(1, 'h5');
    assert.equal(web.nativeHandlers.size, 0); web.handlers.get('BtnNormal')();
    assert.equal(web.desktopCalls, 0); assert.equal(web.claims, 1); web.modal.onDestroy();
    console.log('PASS sign-in desktop: automatic video/reward-save/desktop order with one click at DPR1/2/3, ordinary native claim, strict SDK gesture rejection preserves rewards, cancellation, unchecked, duplicates, stale close, H5 and disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
