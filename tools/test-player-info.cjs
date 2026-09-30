// SDK mocks: no real login, permission prompt, or network request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/CocosCreator/v3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/services/PlayerInfoService.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018,
} }).outputText, { exports: exportsObject, setTimeout, clearTimeout });
const Service = exportsObject.PlayerInfoService;
(async () => {
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
    assert.equal(JSON.stringify(calls),JSON.stringify([['login',false],['profile',false]]));
    tt.login = o => o.success({anonymousCode:'guest-ticket'});
    assert.equal((await service.requestProfile()).reason,'not_logged_in');
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
    tt.getUserInfo = o => o.success({userInfo:{}});
    assert.equal((await service.requestProfile()).reason,'invalid_response');
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
