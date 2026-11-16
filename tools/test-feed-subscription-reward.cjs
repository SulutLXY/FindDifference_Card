const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, experimentalDecorators: true,
} }).outputText;
function load(file, modules) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, console: { warn() {} },
        require: name => modules[name] || {}, setTimeout, clearTimeout });
    return exports;
}
const storage = new Map(); let diskFailure = false;
const { SaveService } = load('assets/scripts/services/SaveService.ts', { cc: { sys: { localStorage: {
    getItem: key => storage.get(key),
    setItem(key, value) { if (diskFailure) throw Error('disk full'); storage.set(key, value); },
} } } });
const Label = class {}, BlockInputEvents = class {};
const { LobbyEntries } = load('assets/scripts/ui/LobbyEntries.ts', {
    cc: { _decorator: { ccclass: () => value => value }, Label, BlockInputEvents },
    './UIScreen': { UIScreen: class {} },
});
function setup() {
    storage.clear(); diskFailure = false;
    let save = new SaveService(), subscribed = false, statusError = null, requests = 0, refreshes = 0;
    const messages = [], buttonLabel = { string: '' }, status = { string: '', node: { active: false } };
    const button = { active: true, getComponentInChildren: () => buttonLabel };
    const modal = { active: false, parent: { children: [1] }, setSiblingIndex() {} };
    const platform = { feedSubscribed: false, supportsFeedSubscription: true,
        async checkFeedStatus() { if (!statusError) this.feedSubscribed = subscribed; return statusError; },
        subscribeFeed() { requests++; this.feedSubscribed = subscribed; return Promise.resolve(subscribed ? '订阅成功' : '暂未订阅'); },
    };
    const entries = new LobbyEntries();
    entries.flow = { save, platform, feed: { isPreview: false }, game: { refreshHud() { refreshes++; } }, toast: text => messages.push(text) };
    Object.assign(entries, { isValid: true, node: {}, _subscriptionModal: modal,
        _subscriptionStatus: status, _subscribeButton: button });
    entries._close = () => {};
    return { entries, platform, modal, button, buttonLabel, status, messages,
        get save() { return save; }, get requests() { return requests; }, get refreshes() { return refreshes; },
        subscribe: value => { subscribed = value; }, error: value => { statusError = value; },
        reload() { save = new SaveService(); entries.flow.save = save; },
    };
}
const flush = () => new Promise(setImmediate);
(async () => {
    const accepted = setup();
    await accepted.entries._openSubscription();
    accepted.subscribe(true);
    accepted.entries._requestSubscription();
    assert.equal(accepted.requests, 1, 'SDK invocation stays synchronous');
    await flush();
    assert.equal(accepted.save.freeHints, 4);
    assert.equal(accepted.save.data.feedSubscriptionRewardClaimed, true);
    assert.equal(accepted.refreshes, 1);
    assert.equal(accepted.button.active, false);
    assert.match(accepted.messages.at(-1), /免费提示 ×2/);
    accepted.reload();
    await accepted.entries._openSubscription();
    accepted.entries._requestSubscription(); await flush();
    assert.equal(accepted.save.freeHints, 4, 'Reopen/restart cannot claim again');
    assert.equal(accepted.requests, 1, 'Subscribed player does not invoke native subscription again');

    const legacy = setup(); legacy.subscribe(true);
    await legacy.entries._openSubscription();
    assert.equal(legacy.save.freeHints, 4, 'Existing subscribers receive the missing reward after a successful query');
    assert.equal(legacy.requests, 0);

    const rejected = setup();
    await rejected.entries._openSubscription();
    rejected.entries._requestSubscription(); await flush();
    assert.equal(rejected.save.freeHints, 2);
    assert.equal(rejected.save.data.feedSubscriptionRewardClaimed, undefined);
    rejected.error('查询失败'); rejected.platform.feedSubscribed = true;
    await rejected.entries._openSubscription();
    assert.equal(rejected.save.freeHints, 2, 'A failed query cannot award on a stale cached status');
    assert.equal(rejected.buttonLabel.string, '重试查询');
    rejected.subscribe(true); rejected.error(null);
    rejected.entries._requestSubscription(); await flush();
    assert.equal(rejected.save.freeHints, 4);

    const retry = setup(); retry.subscribe(true); diskFailure = true;
    await retry.entries._openSubscription();
    assert.equal(retry.save.freeHints, 2);
    assert.equal(retry.save.data.feedSubscriptionRewardClaimed, undefined);
    assert.equal(retry.button.active, true);
    assert.equal(retry.buttonLabel.string, '领取奖励');
    diskFailure = false;
    retry.entries._requestSubscription();
    assert.equal(retry.save.freeHints, 4);
    assert.equal(retry.requests, 0, 'Retry saving the reward without another authorization');
    retry.reload(); assert.equal(retry.save.data.feedSubscriptionRewardClaimed, true);

    const full = setup(); full.subscribe(true); full.save.grantAssist('hint', 96);
    await full.entries._openSubscription();
    assert.equal(full.save.freeHints, 98);
    assert.equal(full.save.data.feedSubscriptionRewardClaimed, undefined, 'Keep full reward pending until two slots are available');
    full.save.consumeFreeHint(); full.entries._requestSubscription();
    assert.equal(full.save.freeHints, 99); assert.equal(full.save.data.feedSubscriptionRewardClaimed, true);

    const closed = setup(); await closed.entries._openSubscription(); closed.subscribe(true);
    closed.entries._requestSubscription(); closed.entries.isValid = false; await flush();
    assert.equal(closed.save.freeHints, 4, 'Confirmed reward survives panel destruction before its promise callback');
    const preview = setup(); preview.entries.flow.feed.isPreview = true;
    preview.entries._requestSubscription(); await flush();
    assert.equal(preview.requests, 0); assert.equal(preview.save.freeHints, 2);
    console.log('PASS: subscription reward ×2, existing subscribers, one claim across reloads, cancellation/query failure, inventory/storage retry, synchronous SDK and panel destruction.');
})().catch(error => { console.error(error); process.exitCode = 1; });
