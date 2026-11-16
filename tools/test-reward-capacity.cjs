const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText;
function load(file, dependencies = {}) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports,
        console: { warn() {} }, require: name => dependencies[name] || {} });
    return exports;
}
let raw, failed = false;
const daily = load('assets/scripts/core/DailySignIn.ts');
const { SaveService } = load('assets/scripts/services/SaveService.ts', {
    '../core/DailySignIn': daily, cc: { sys: { localStorage: {
        getItem: () => raw, setItem(_, value) { if (failed) throw Error('disk'); raw = value; },
    } } },
});
for (const [method, marker] of [['claimSidebar', 'sidebarClaimDay'], ['claimFavorite', 'favoriteClaimDay']]) {
    for (const count of [98, 99]) {
        raw = JSON.stringify({ freeHints: count }); const save = new SaveService();
        assert.equal(save[method]('2026-11-15', 2), 'inventory-full');
        assert.equal(save.data[marker], undefined); assert.equal(save.freeHints, count);
        while (save.freeHints > 97) save.consumeFreeHint();
        failed = true;
        assert.equal(save[method]('2026-11-15', 2), 'storage-error');
        assert.equal(save.data[marker], undefined); assert.equal(save.freeHints, 97);
        failed = false;
        assert.equal(save[method]('2026-11-15', 2), 'claimed'); assert.equal(save.freeHints, 99);
        const reloaded = new SaveService();
        assert.equal(reloaded[method]('2026-11-15', 2), 'already-claimed'); assert.equal(reloaded.freeHints, 99);
    }
}
const config = JSON.parse(fs.readFileSync('assets/resources/configs/daily-sign-in.json'));
function methods(file, names, globals = {}) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(member => names.includes(member.name?.getText(tree)))
        .map(member => member.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test { ${body} }; Test;`), globals);
}
const SignIn = methods('assets/scripts/ui/DailySignInModal.ts', ['_claim'], { sidebarDay: () => '2026-11-15' });
(async () => {
    raw = JSON.stringify({ freeHints: 98 }); const save = new SaveService(), modal = new SignIn();
    let ads = 0; const messages = [];
    Object.assign(modal, { _config: config, isValid: true, node: { activeInHierarchy: true },
        _refresh() {}, _playNormalClick() {}, flow: { save, toast: value => messages.push(value),
            platform: { kind: 'douyin' }, async requestReward(_, claim) { ads++; claim(); } } });
    await modal._claim(true);
    assert.equal(ads, 0, 'Insufficient stock room must be detected before playing an ad');
    assert.equal(save.dailyStatus('2026-11-15', config).canClaim, true);
    save.consumeFreeHint(); await modal._claim(true);
    assert.equal(ads, 1); assert.equal(save.freeHints, 99);
    assert.equal(save.dailyStatus('2026-11-15', config).claimed, true);
    console.log('PASS: sidebar/favorite full-stock rewards remain claimable, atomic save rollback, no duplicate claim, sign-in pre-ad room check and full double reward.');
})().catch(error => { console.error(error); process.exitCode = 1; });
