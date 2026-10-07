const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
const output = {};
const testMath = Object.create(Math);
let pc = false, login, subscribeCalls = 0, share;
const host = { tt: {
    getSystemInfoSync: () => ({ platform: pc ? 'windows' : 'android' }),
    getLaunchOptionsSync: () => ({}),
    login: args => { login = args; },
    addShortcut: args => args.success({}),
    showFavoriteGuide: args => args.success({ isFavorited: false }),
    requestFeedSubscribe: args => { subscribeCalls++; assert.equal(args.allScene, true); args.success({ success: false }); },
    shareAppMessage: args => { share = args; },
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, { exports: output, globalThis: host, console, setTimeout, clearTimeout, Math: testMath,
    require: name => name === 'cc/env' ? { BYTEDANCE: true, WECHAT: false }
        : name.includes('Sidebar') ? { SidebarService: class {} } : { PlayerInfoService: class {} },
});
(async () => {
    const service = new output.PlatformService();
    assert.match(await service.addDesktop(), /请求已完成/);
    assert.equal(await service.favoriteGame(), '暂未收藏游戏');
    assert.match(await service.subscribeFeed(), /登录/);
    assert.equal(subscribeCalls, 0);
    login.success({ code: 'test' }); login.complete();
    host.tt.checkFeedSubscribeStatus = args => {
        assert.equal(args.allScene, true); args.success({ status: false });
    };
    assert.equal(await service.checkFeedStatus(), null);
    assert.equal(service.feedSubscribed, false);
    const result = service.subscribeFeed();
    assert.equal(subscribeCalls, 1, 'SDK must be invoked synchronously');
    assert.equal(await result, '暂未订阅');
    host.tt.requestFeedSubscribe = args => args.success({ success: true });
    assert.equal(await service.subscribeFeed(), '订阅成功');
    assert.equal(service.feedSubscribed, true);
    host.tt.checkFeedSubscribeStatus = args => args.success({ status: false });
    await service.checkFeedStatus();
    assert.equal(service.feedSubscribed, false, 'platform status overrides cached subscription');
    host.tt.checkFeedSubscribeStatus = args => args.fail({ errMsg: 'query failed' });
    assert.equal(await service.checkFeedStatus(), 'query failed');
    host.tt.addShortcut = args => args.fail({ errMsg: 'cancelled' });
    assert.equal(await service.addDesktop(), 'cancelled');
    service.configure({ douyinShareTemplateIds: ['approved-template'] });
    service.share('city/level'); assert.equal(share.templateId, 'approved-template');
    const config = JSON.parse(fs.readFileSync('assets/resources/configs/platform-config.json', 'utf8'));
    assert.equal(config.douyinShareTemplateIds.length, 6);
    service.configure(config);
    config.douyinShareTemplateIds.forEach((id, index) => {
        testMath.random = () => (index + .5) / 6;
        service.share('city/level'); assert.equal(share.templateId, id);
    });
    pc = true;
    assert.equal(service.isPcCompanion, true);
    assert.match(await service.favoriteGame(), /直播伴侣/);
    share = null; service.share('level'); assert.equal(share, null);
    console.log('Passed: desktop/favorite callbacks, subscription login and synchronous invocation, cancellation, share template, PC fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
