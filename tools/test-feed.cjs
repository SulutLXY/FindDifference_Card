const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
} }).outputText;
function load(file, deps = {}, globals = {}) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, setTimeout, clearTimeout,
        console: { info() {}, warn() {}, error() {} }, require: name => deps[name] || {}, ...globals });
    return exports;
}
const core = load('assets/scripts/core/Feed.ts');
const sidebar = load('assets/scripts/services/SidebarService.ts');
const { FeedService } = load('assets/scripts/services/FeedService.ts', { '../core/Feed': core, './SidebarService': sidebar });
const plan = () => ({ enabled: true, serverlessEnabled: true, revisitEnabled: true, acquisitionEnabled: true,
    acquisitionContentID: 'CONTENT999', contents: Array.from({ length: 21 }, (_, i) => ({
        contentID: `CONTENT${1000 + i}`, scene: 2, recommendationText: '测试', subscriptionText: '订阅', levelKey: `stable-${i}`,
    })) });
const START = Date.parse('2026-11-04T00:00:00Z');
function setup({ legacy = false, subscribed = false, preview = false, native = true } = {}) {
    let time = START, failID = '', failWrite = false;
    const calls = [], events = new Set(), shows = new Set(), touches = new Set();
    const save = { data: { completed: {}, ...(legacy ? { lastPlayedLevelKey: 'old' } : {}) }, energy: 10,
        energyRecoveryLimit: 15, energyFullRecoveryAt: START + 40 * 60000,
        updateFeedState(value) { if (failWrite) return false; this.data.feed = JSON.parse(JSON.stringify(value)); return true; } };
    const platform = { kind: 'douyin', isPcCompanion: false, supportsFeedSubscription: true,
        feedSubscribed: subscribed, checks: 0, async checkFeedStatus() { this.checks++; return null; } };
    const host = { tt: { getLaunchOptionsSync: () => preview ? { scene: '023041', query: { feed_game_channel: 2 } } : { scene: 'normal' },
        onShow: fn => shows.add(fn), offShow: fn => shows.delete(fn),
        onTouchEnd: fn => touches.add(fn), offTouchEnd: fn => touches.delete(fn),
        storeFeedData(args) { calls.push(args); if (args.contentID === failID) args.fail({ errNo: 10104 }); else args.success({}); },
        reportScene(args) { calls.push(args); args.success({}); },
        ...(native ? { onFeedStatusChange: fn => events.add(fn), offFeedStatusChange: fn => events.delete(fn) } : {}),
    } };
    const service = new FeedService(save, platform, host, () => time, async () => {});
    service.configure(plan()); service.start();
    return { service, save, platform, host, calls, events, shows, touches,
        advance: ms => { time += ms; }, fail: id => { failID = id; }, failWrite: value => { failWrite = value; },
        status: type => [...events].forEach(fn => fn({ type })), show: options => [...shows].forEach(fn => fn(options)) };
}
function methods(file, names, globals = {}) {
    const source = fs.readFileSync(file, 'utf8'), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const cls = tree.statements.find(ts.isClassDeclaration);
    const body = cls.members.filter(member => names.includes(member.name?.getText(tree))).map(member => member.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test { ${body} } exports.Test = Test;`), { exports: {}, ...globals });
}
(async () => {
    const config = JSON.parse(fs.readFileSync('assets/resources/configs/platform-config.json')).feed;
    assert.equal(config.enabled, false); assert.equal(config.serverlessEnabled, false);
    assert.deepEqual(config.contents.map(c => [c.contentID, c.scene]), [['CONTENT13630007554', 2], ['CONTENT16082553858', 2]]);
    assert.equal(core.feedPlanKey(config), null, 'incomplete production config cannot upload');
    assert.equal(core.feedPlanKey(plan()).split('|').length, 21);
    const duplicate = plan(); duplicate.contents[20].contentID = duplicate.contents[0].contentID;
    assert.equal(core.feedPlanKey(duplicate), null);
    for (const [index, hours] of [[0, 2], [1, 4], [2, 6], [3, 24], [20, 432]])
        assert.equal(core.feedReadyAt(START, index), START + hours * 3600000);

    const first = setup();
    for (let i = 1; i <= 15; i++) {
        const offer = await first.service.onLevelEntered(`chapter/level-${i}`);
        const expected = [1, 2, 3, 5, 8, 10].includes(i);
        assert.equal(!!offer, expected, `milestone ${i}`);
        if (offer) { assert.ok(first.service.markOffered(offer)); assert.equal(first.service.reserveSubscriptionAttempt(), null); }
        assert.equal(await first.service.onLevelEntered(`chapter/level-${i}`), null, 'retry does not create another milestone');
    }
    assert.equal(first.save.data.feed.attempts, 6);
    assert.ok(first.service.reserveSubscriptionAttempt(), 'six actual native requests max');
    first.advance(core.FEED_DAY_MS);
    const daily = await first.service.onLevelEntered('chapter/level-1');
    assert.ok(daily); assert.ok(first.service.markOffered(daily));
    assert.equal(first.service.reserveSubscriptionAttempt(), null);
    assert.equal(await first.service.onLevelEntered('another-chapter/first'), null);
    assert.ok(first.service.reserveSubscriptionAttempt(), 'one native attempt on later days');
    first.service.dispose();
    const old = setup({ legacy: true });
    const oldOffer = await old.service.onLevelEntered('old');
    assert.ok(oldOffer); old.service.markOffered(oldOffer); old.service.reserveSubscriptionAttempt();
    assert.equal(await old.service.onLevelEntered('new'), null, 'existing players use daily rule on rollout');
    old.service.dispose();

    const scheduled = setup({ subscribed: true });
    scheduled.save.energyFullRecoveryAt = START + 3 * 3600000;
    scheduled.fail('CONTENT1002');
    await scheduled.service.scheduleRevisit();
    assert.equal(scheduled.calls.length, 3);
    assert.equal(scheduled.calls[0].rightValue, String(START + 3 * 3600000), 'cannot advertise full energy before recovery');
    assert.deepEqual(scheduled.save.data.feed.uploaded, ['CONTENT1000', 'CONTENT1001']);
    scheduled.fail(''); scheduled.advance(60001);
    await scheduled.service.scheduleRevisit();
    assert.equal(scheduled.calls.length, 22, 'retry starts at failed slot');
    const cycle = scheduled.save.data.feed.cycleStart;
    scheduled.advance(60001); await scheduled.service.scheduleRevisit();
    assert.equal(scheduled.calls.length, 22, 'successful registrations are not repeated');
    scheduled.advance(19 * core.FEED_DAY_MS); await scheduled.service.scheduleRevisit();
    assert.equal(scheduled.calls.length, 43);
    assert.ok(scheduled.save.data.feed.cycleStart > cycle, '19-day cycle renews on next real activity');
    scheduled.service.dispose();

    const returned = setup({ subscribed: true });
    await returned.service.scheduleRevisit();
    returned.show({ scene: '023041', query: { feed_game_channel: 1, feed_game_scene: 2,
        feed_game_content_id: 'CONTENT1000', feed_game_extra: JSON.stringify({ cycleStart: returned.save.data.feed.cycleStart }) } });
    returned.status('feedEnter'); returned.advance(60001);
    await returned.service.onLevelEntered('stable-0');
    await new Promise(setImmediate);
    assert.equal(returned.calls[21].status, 0, 'real return consumes only matching cycle content');
    assert.deepEqual(returned.save.data.feed.cleared, ['CONTENT1000']);
    returned.service.dispose();

    const preview = setup({ preview: true });
    assert.equal(preview.service.isPreview, true);
    assert.equal(await preview.service.onLevelEntered('first'), null);
    assert.equal(preview.save.data.feed, undefined); assert.equal(preview.platform.checks, 0);
    await preview.service.reportReady(); await preview.service.reportReady();
    assert.equal(preview.calls.length, 1); assert.equal(preview.calls[0].sceneId, 7001);
    preview.status('feedEnter'); assert.equal(preview.service.isPreview, false);
    preview.status('feedExit'); assert.equal(preview.service.isPreview, true);
    preview.service.dispose(); assert.equal(preview.events.size, 0); assert.equal(preview.shows.size, 0);
    const fallback = setup({ preview: true, native: false });
    [...fallback.touches][0](); assert.equal(fallback.service.isPreview, false); fallback.service.dispose();
    assert.equal(fallback.touches.size, 0);
    const disabled = setup(); disabled.service.configure(config);
    assert.equal(await disabled.service.onLevelEntered('first'), null); await disabled.service.scheduleRevisit();
    assert.equal(disabled.calls.length, 0); disabled.service.dispose();
    const failure = setup(); failure.failWrite(true);
    assert.equal(await failure.service.onLevelEntered('first'), null);
    assert.ok(failure.service.reserveSubscriptionAttempt()); assert.equal(failure.save.data.feed, undefined); failure.service.dispose();

    // Execute the real pre-engine bridge, including an entry event before Cocos starts.
    let earlyStatus, earlyShow;
    const earlyHost = {}, earlySDK = { canIUse: () => true, onFeedStatusChange(fn) { earlyStatus = fn; },
        onShow(fn) { earlyShow = fn; }, getLaunchOptionsSync: () => ({ scene: '023041' }) };
    const template = fs.readFileSync('build-templates/bytedance-mini-game/game.ejs', 'utf8').split('<%')[0];
    vm.runInNewContext(template, { globalThis: earlyHost, tt: earlySDK, console });
    earlyShow({ scene: '023041' }); earlyStatus({ type: 'feedEnter' });
    const early = setup(); early.service.dispose(); early.host = earlyHost; earlyHost.tt = earlySDK;
    const caught = new FeedService(early.save, early.platform, earlyHost);
    caught.start(); assert.equal(caught.isPreview, false, 'early feedEnter is retained'); caught.dispose();

    // Production save transaction must roll back on disk failure and clone nested arrays.
    let raw = null, diskFail = false;
    const { SaveService } = load('assets/scripts/services/SaveService.ts', { cc: { sys: { localStorage: {
        getItem: () => raw, removeItem() {}, setItem(_, value) { if (diskFail) throw Error('disk full'); raw = value; },
    } } } });
    const actualSave = new SaveService(), state = JSON.parse(JSON.stringify(first.save.data.feed));
    assert.ok(actualSave.updateFeedState(state)); state.visited.push('mutation');
    assert.ok(!actualSave.data.feed.visited.includes('mutation'));
    const previous = actualSave.data; diskFail = true;
    assert.equal(actualSave.updateFeedState({ ...actualSave.data.feed, attempts: 99 }), false);
    assert.equal(actualSave.data, previous);

    // Exercise the real SDK wrapper: only supported, logged-in native attempts use quota.
    const players = load('assets/scripts/services/PlayerInfoService.ts');
    let insideTouch = false, requests = 0, accepts = false;
    const sdkHost = { tt: { getSystemInfoSync: () => ({ platform: 'android' }),
        getLaunchOptionsSync: () => ({}), canIUse: () => true,
        login(options) { options.success({ code: 'ok' }); options.complete?.(); },
        requestFeedSubscribe(options) { assert.equal(insideTouch, true); requests++; options.success({ success: accepts }); },
    } };
    const { PlatformService } = load('assets/scripts/services/PlatformService.ts', {
        'cc/env': { BYTEDANCE: true }, './SidebarService': sidebar, './PlayerInfoService': players,
    }, { globalThis: sdkHost });
    const actualPlatform = new PlatformService(), quota = setup();
    actualPlatform.beforeFeedSubscribe = () => quota.service.reserveSubscriptionAttempt();
    actualPlatform.prepareFeedLogin();
    for (let i = 0; i < 7; i++) {
        insideTouch = true; const result = actualPlatform.subscribeFeed(); insideTouch = false; await result;
    }
    assert.equal(requests, 6); assert.equal(quota.save.data.feed.attempts, 6);
    quota.advance(core.FEED_DAY_MS); accepts = true;
    let successHook = 0; actualPlatform.onFeedSubscribeSuccess = () => successHook++;
    insideTouch = true; const accepted = actualPlatform.subscribeFeed(); insideTouch = false; await accepted;
    assert.equal(successHook, 1); assert.equal(actualPlatform.feedSubscribed, true);
    await actualPlatform.subscribeFeed(); assert.equal(requests, 7, 'successful all-scene subscriber is not prompted again');
    actualPlatform.canUseInteractiveFeatures = () => false;
    await actualPlatform.showInterstitial(() => true);
    assert.equal((await actualPlatform.showRewardedAd('hint')).completed, false);
    assert.equal(actualPlatform.share('level'), false);
    quota.service.dispose();

    // Run production gameplay entry, rather than inferring preview safety from source strings.
    const Flow = methods('assets/scripts/GameFlow.ts', ['startLevel', '_onFeedPreviewChanged', 'update', 'onWrongTap', 'onDifferenceFound'],
        { console, sidebarDay: () => '2026-11-04' });
    const flow = new Flow(), steps = [], level = { key: 'stable-first', timeLimit: 300, maxLives: 3 };
    Object.assign(flow, { isValid: true, _levelLoadVersion: 0, _assistRoundVersion: 0, _foundIds: new Set(),
        _cities: [], _isPaused: true, _musicRequest: 0, _feedPauseBeforePreview: false,
        feed: { isPreview: true, async onLevelEntered() { steps.push('entered'); return null; }, async reportReady() { steps.push('report'); } },
        platform: { prepareFeedLogin() {} },
        save: { energy: 15, consumeEnergy() { steps.push('energy'); return true; },
            beginDailyFirstRound() { steps.push('daily'); return true; }, setLastPlayedLevel() { steps.push('last'); } },
        game: { node: { activeInHierarchy: true }, clearLevel() {}, async setupLevel() { steps.push('images'); } },
        _contentBundles: { retain: () => () => {} }, isLevelUnlocked: () => true,
        _cancelSecondaryNavigation() {}, _updateGameMusic() {}, _updateComboGroup() {}, _setLoadingProgress() {},
        async _drawLoadingFrame() {}, async _ensureGameScreens() {}, async _ensureLevel() { return level; },
        async _resolveChapterMusic() { return null; },
        _switchTo() { flow._isPaused = false; }, _preloadLobby() { steps.push('lobby'); },
        _showFirstLevelTutorial() { steps.push('tutorial'); }, preloadNextLevel() {},
        _currentGameMusic: () => ({ path: 'music', fromBundle: true }), _playPageMusic() {},
        toast() {}, _returnToLobbyOnLoadError() { throw Error('unexpected entry error'); },
    });
    const city = { key: 'chapter', levels: ['first'] }; flow._cities = [city];
    await flow.startLevel(city, 0); await new Promise(setImmediate);
    assert.ok(steps.includes('images')); assert.ok(steps.includes('report'));
    for (const forbidden of ['energy', 'daily', 'last', 'tutorial', 'entered', 'lobby']) assert.ok(!steps.includes(forbidden));
    flow.update(100); flow.onWrongTap(); flow.onDifferenceFound();
    assert.equal(flow._remainingTime, 300); assert.equal(flow._lives, 3);
    flow.feed.isPreview = false; flow._onFeedPreviewChanged(); await new Promise(setImmediate);
    assert.equal(steps.filter(s => s === 'energy').length, 1); assert.ok(steps.includes('entered'));
    flow._onFeedPreviewChanged(); assert.equal(steps.filter(s => s === 'energy').length, 1);
    flow.feed.isPreview = true; flow._onFeedPreviewChanged();
    flow.feed.isPreview = false; flow._onFeedPreviewChanged(); assert.equal(flow._isPaused, false);
    assert.equal(steps.filter(s => s === 'energy').length, 1, 'return from preview does not start a second round');
    flow._isPaused = true; flow.feed.isPreview = true; flow._onFeedPreviewChanged();
    flow.feed.isPreview = false; flow._onFeedPreviewChanged(); assert.equal(flow._isPaused, true, 'preserve settings/tutorial pause');

    console.log('PASS Feed: real IDs remain disabled until configured; milestones, daily limits, legacy players, 19-day schedule, recovery timing, retries, return clearing, preview lifecycle, early entry and atomic storage');
})().catch(error => { console.error(error); process.exitCode = 1; });
