// SDK mocks: no real login, permission prompt, or network request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.COCOS_TYPESCRIPT_PATH || 'D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/services/PlayerInfoService.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018,
} }).outputText, { exports: exportsObject, setTimeout, clearTimeout });
const Service = exportsObject.PlayerInfoService;
(async () => {
    const harmony = new Service(()=>'douyin',{tt:{getSystemInfoSync:()=>({platform:'openHarmony'})}});
    assert.equal(harmony.isOpenHarmony,true);
    const android = new Service(()=>'douyin',{tt:{getSystemInfoSync:()=>({platform:'android'})}});
    assert.equal(android.isOpenHarmony,false);
    const asyncHarmony = new Service(()=>'douyin',{tt:{getSystemInfoSync:()=>{throw Error('sync unavailable');},getSystemInfo:o=>o.success({platform:'openHarmony'})}});
    assert.equal(asyncHarmony.isOpenHarmony,false);
    await asyncHarmony.getSystemInfo();
    assert.equal(asyncHarmony.isOpenHarmony,true);
    const calls = [];
    const tt = {
        getSystemInfo: o => o.success({ appName: 'Douyin', model: 'test', screenWidth: 390, secret: 'omit' }),
        login: o => { calls.push(['login',o.force]); o.success({ code:'temporary-code' }); },
        getUserInfo: o => { calls.push(['profile',o.withCredentials]); o.success({ userInfo: { nickName:'玩家', avatarUrl:'https://example.com/a.png', gender:1 } }); },
    };
    const service = new Service(()=>'douyin',{tt,wx:{login:()=>{throw Error('wrong SDK');}}});
    const system = await service.getSystemInfo();
    assert.equal(system.data.appName,'Douyin');
    assert.equal(system.data.secret,undefined);
    const profile = await service.requestProfile();
    assert.equal(profile.data.nickName,'玩家');
    assert.equal(profile.data.gender,undefined);
    assert.equal(JSON.stringify(calls),JSON.stringify([['login',true],['profile',false]]));
    assert.equal(service.profile.nickName, '玩家');
    tt.login = o => o.success({anonymousCode:'guest-ticket'});
    assert.equal((await service.requestProfile()).reason,'not_logged_in');
    assert.equal(service.profile, null);
    assert.equal(calls.length,2);
    tt.login = o => o.fail({errMsg:'cancel'});
    assert.equal((await service.login()).reason,'failed');
    tt.login = o => o.success({});
    assert.equal((await service.login()).reason,'invalid_response');
    tt.login = () => { throw Error('SDK crash'); };
    assert.equal((await service.login()).reason,'failed');
    tt.login = () => {};
    assert.equal((await new Service(()=>'douyin',{tt},5).login()).reason,'timeout');
    tt.login = o => o.success({code:'ok'});
    tt.getUserInfo = o => o.fail({errMsg:'denied'});
    assert.equal((await service.requestProfile()).reason,'failed');
    assert.match((await service.requestProfile()).message, /denied/);
    tt.getUserInfo = o => o.success({userInfo:{}});
    assert.equal((await service.requestProfile()).reason,'invalid_response');
    let profileRequested = false;
    tt.getSetting = o => o.success({authSetting:{'scope.userInfo':false}});
    tt.getUserInfo = () => { profileRequested = true; };
    assert.match((await service.requestProfile()).message, /更多 → 设置/);
    assert.equal(profileRequested, false);
    const wechat = new Service(()=>'wechat',{tt,wx:{login:o=>o.success({code:'wx-code'})}});
    assert.equal((await wechat.login()).data.code,'wx-code');
    assert.equal((await wechat.requestProfile()).reason,'unsupported');
    assert.equal((await new Service(()=>'douyin',{}).getSystemInfo()).reason,'unsupported');
    const browser = new Service(()=>'h5',{tt,navigator:{language:'zh-CN'},innerWidth:720});
    assert.equal((await browser.getSystemInfo()).data.windowWidth,720);
    assert.equal((await browser.login()).reason,'unsupported');
    assert.equal((await browser.requestProfile()).reason,'unsupported');
    console.log('PlayerInfo: channel routing, profile/login order, anonymous, denial, malformed data, exception, timeout and H5 checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
