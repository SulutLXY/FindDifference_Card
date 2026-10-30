const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function load(file, names) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const members = tree.statements.find(ts.isClassDeclaration).members;
    const body = members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Test { ${body} }; Test;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, { console: { warn() {} } });
}
const Flow = load('assets/scripts/GameFlow.ts', ['requestReward', 'revive', '_rewardPending']);
const Modal = load('assets/scripts/ui/ResultModal.ts', ['onLoad']);
(async () => {
    const flow = new Flow(), modal = new Modal();
    let complete, reject, ads = 0, closes = 0, redraws = 0, pending;
    const messages = [];
    flow.platform = { showRewardedAd(placement) {
        assert.equal(placement, 'revive'); ads++;
        return new Promise((resolve, fail) => { complete = resolve; reject = fail; });
    } };
    flow._stopResultTone = () => {};
    flow.toast = text => messages.push(text);
    flow.resultModal = { close() { closes++; } };
    flow.game = { refreshHud() { redraws++; } };
    flow.requestReward = (...args) => pending = Flow.prototype.requestReward.apply(flow, args);
    modal.flow = flow;
    modal._ensureCloseButton = () => {};
    const buttons = {};
    modal.wireButton = (_, name, callback) => { buttons[name] = callback; };
    modal.onLoad();
    function failed(lives, seconds) {
        flow._isGameOver = true; flow._isPaused = false; flow._reviveUsed = false;
        flow._lives = lives; flow._remainingTime = seconds;
        flow._combo = 4; flow._lastFoundAt = 123;
    }
    failed(0, 80);
    buttons.BtnRevive();
    assert.equal(flow._isPaused, true); assert.equal(flow._lives, 0);
    const cancelled = pending;
    buttons.BtnRevive(); await pending;
    assert.equal(ads, 1, 'Duplicate clicks must not open another ad');
    complete({ success: true, completed: false }); await cancelled;
    assert.equal(flow._lives, 0); assert.equal(flow._remainingTime, 80);
    assert.equal(flow._isGameOver, true); assert.equal(flow._reviveUsed, false); assert.equal(closes, 0);
    buttons.BtnRevive(); reject(Error('ad failed')); await pending;
    assert.equal(flow._lives, 0); assert.equal(flow._isGameOver, true);
    assert.equal(flow._reviveUsed, false); assert.equal(flow._rewardPending, false);
    for (const [lives, seconds] of [[0, 80], [2, 0]]) {
        failed(lives, seconds);
        buttons.BtnRevive();
        assert.equal(flow._lives, lives, 'Reward waits for complete video');
        complete({ success: true, completed: true }); await pending;
        assert.equal(flow._lives, 3, 'Both life exhaustion and timeout restore exactly three lives');
        assert.equal(flow._remainingTime, Math.max(seconds, 30));
        assert.equal(flow._isGameOver, false); assert.equal(flow._isPaused, false);
        assert.equal(flow._reviveUsed, true); assert.equal(flow._combo, 0); assert.equal(flow._lastFoundAt, 0);
        assert.equal(messages.at(-1), '复活成功：生命恢复至3点');
        flow._lives = 2; flow.revive(); assert.equal(flow._lives, 2, 'Active gameplay cannot be revived again');
    }
    assert.equal(closes, 2); assert.equal(redraws, 2);
    console.log('PASS: actual revive button, ad completion/cancellation/error/duplicate guard, three lives, timeout, pause recovery and HUD refresh.');
})().catch(error => { console.error(error); process.exitCode = 1; });
