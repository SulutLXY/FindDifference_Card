// 一次性生成可编辑预制体；不会覆盖已有作品，禁止加入自动构建流程。
const fs = require('node:fs'), crypto = require('node:crypto');
const clone = value => JSON.parse(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const uuid = () => crypto.randomUUID();
function meta(file, type, extra = {}) {
    if (!fs.existsSync(file + '.meta')) write(file + '.meta', { ver: type === 'typescript' ? '4.0.24' : type === 'prefab' ? '1.1.50' : '2.0.1',
        importer: type, imported: true, uuid: uuid(), files: type === 'typescript' ? [] : ['.json'], subMetas: {}, userData: {}, ...extra });
    return read(file + '.meta').uuid;
}
for (const file of ['assets/scripts/core/DailySignIn.ts', 'assets/scripts/core/ViewportLayout.ts',
    'assets/scripts/ui/DailySignInModal.ts', 'assets/scripts/ui/ResponsiveLayout.ts']) meta(file, 'typescript');
const configId = meta('assets/resources/configs/daily-sign-in.json', 'json');
// 首包专用的提示图标副本，使用新 UUID，不把玩法包引入签到依赖。
const source = 'assets/PleyGame/Texture/icons/icon_Tips01.png';
const hint = 'assets/LobbySources/textures/UI_Sprite/V3/icons/icon_signin_hint.png';
if (!fs.existsSync(hint)) {
    fs.copyFileSync(source, hint);
    const old = read(source + '.meta'), next = uuid();
    write(hint + '.meta', JSON.parse(JSON.stringify(old).split(old.uuid).join(next)));
}
const template = read('assets/PleyGame/Common/prefabs/EnergyDisplay.prefab');
const nodeTemplate = template.find(item => item.__type__ === 'cc.Node');
const componentTemplate = type => clone(template.find(item => item.__type__ === type));
const color = (r, g, b, a = 255) => ({ __type__: 'cc.Color', r, g, b, a });
const frame = path => read(`assets/${path === "icons/icon_signin_hint" ? "LobbySources" : "resources"}/textures/UI_Sprite/V3/${path}.png.meta`).subMetas.f9941.uuid;
function graph(array, prefab = true) {
    function add(value) { const id = array.length; array.push(value); return { __id__: id }; }
    function comp(node, value) {
        const object = { _name: '', _objFlags: 0, __editorExtras__: {}, node, _enabled: true, __prefab: null, _id: '', ...value };
        object.node = node;
        object.__prefab = null;
        const ref = add(object); array[node.__id__]._components.push(ref);
        if (prefab) object.__prefab = add({ __type__: 'cc.CompPrefabInfo', fileId: uuid().replace(/-/g, '').slice(0, 22) });
        return ref;
    }
    function node(name, parent, x, y, width, height) {
        const data = clone(nodeTemplate);
        Object.assign(data, { _name: name, _parent: parent, _children: [], _components: [], _prefab: null,
            _lpos: { __type__: 'cc.Vec3', x, y, z: 0 }, _active: true, _id: '' });
        const ref = add(data);
        if (parent) array[parent.__id__]._children.push(ref);
        const ui = componentTemplate('cc.UITransform'); ui._contentSize = { __type__: 'cc.Size', width, height }; comp(ref, ui);
        if (prefab) data._prefab = add({ __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: uuid().replace(/-/g, '').slice(0, 22), instance: null, targetOverrides: null, nestedPrefabInstanceRoots: null });
        return ref;
    }
    function sprite(node, path, tint = color(255, 255, 255), sliced = true) {
        const data = componentTemplate('cc.Sprite');
        data._spriteFrame = { __uuid__: frame(path), __expectedType__: 'cc.SpriteFrame' }; data._color = tint; data._type = sliced ? 1 : 0;
        comp(node, data);
    }
    function label(name, parent, text, x, y, w, h, size = 28, tint = color(79, 69, 121)) {
        const ref = node(name, parent, x, y, w, h), data = componentTemplate('cc.Label');
        Object.assign(data, { _string: text, _fontSize: size, _actualFontSize: size, _lineHeight: size + 6, _color: tint,
            _enableWrapText: false, _overflow: 2, _isBold: true });
        comp(ref, data); return ref;
    }
    function button(name, parent, text, x, y, w, h, image) {
        const ref = node(name, parent, x, y, w, h); sprite(ref, image);
        comp(ref, { __type__: 'cc.Button', _interactable: true, _transition: 0, clickEvents: [], _duration: 0.1, _zoomScale: 1.05 });
        label('Label', ref, text, 0, 0, w - 16, h - 8, 27, color(255, 255, 255)); return ref;
    }
    return { node, sprite, label, button, comp };
}
const target = 'assets/LobbySources/prefabs/DailySignInModal.prefab';
if (!fs.existsSync(target)) {
    const array = [{ __type__: 'cc.Prefab', _name: 'DailySignInModal', _objFlags: 0, __editorExtras__: {}, _native: '', data: { __id__: 1 }, optimizationPolicy: 0, persistent: false }];
    const { node, sprite, label, button, comp } = graph(array);
    const root = node('DailySignInModal', null, 0, 0, 750, 1334);
    const dimmer = node('ResultDimmer', root, 0, 0, 750, 1334); sprite(dimmer, 'panels/BG_White', color(18, 16, 48, 180));
    const card = node('ResultCard', root, 0, 0, 660, 1080); sprite(card, 'panels/panel_light');
    const header = node('Header', card, 0, 458, 650, 150); sprite(header, 'panels/panel_light', color(202, 185, 246));
    label('Title', card, '七日签到', 0, 470, 520, 76, 48);
    label('Subtitle', card, '连续签到第 1 天 · 漏签从第1天重新开始', 0, 395, 608, 48, 24);
    const days = node('Days', card, 0, 0, 610, 710);
    const config = read('assets/resources/configs/daily-sign-in.json');
    config.days.forEach((reward, i) => {
        const day = i + 1, wide = day === 7, x = wide ? 0 : ((i % 3) - 1) * 202, y = wide ? -210 : 255 - Math.floor(i / 3) * 215;
        const w = wide ? 590 : 184, h = wide ? 190 : 194;
        const cell = node(`Day${day}`, days, x, y, w, h); sprite(cell, 'panels/panel_light', color(174, 218, 243));
        const current = node('Current', cell, 0, 0, w, h); sprite(current, 'panels/panel_light', color(255, 205, 99));
        array[current.__id__]._active = day === 1;
        label('DayTitle', cell, `${day}天`, wide ? -220 : -45, h / 2 - 28, 120, 42, 30);
        const icon = node('Icon', cell, 0, 8, 88, 88); sprite(icon, reward.kind === 'hint' ? 'icons/icon_signin_hint' : 'icons/icon_energy', undefined, false);
        label('Reward', cell, `${reward.kind === 'hint' ? '提示' : '体力'} ×${reward.amount}`, 0, -43, w - 16, 38, 27);
        label('State', cell, day === 1 ? '今日可领取' : '未开启', 0, -77, w - 12, 34, 22);
        const check = label('Claimed', cell, '✓', 0, 12, 130, 110, 82, color(28, 170, 84)); array[check.__id__]._active = false;
    });
    const normal = button('BtnNormal', card, '普通领取', -154, -395, 282, 92, 'buttons/button_secondary_blue');
    const doubled = button('BtnDouble', card, '视频双倍领取', 154, -395, 282, 92, 'buttons/button_primary_normal');
    label('Rules', card, '每日一次 · 北京时间零点刷新 · 七天领完开始下一轮', 0, -481, 610, 42, 21);
    const close = button('BtnClose', card, '×', 288, 490, 74, 74, 'buttons/button_square_normal');
    const scriptId = read('assets/scripts/ui/DailySignInModal.ts.meta').uuid.replace(/-/g, '');
    const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let type = scriptId.slice(0, 5);
    for (let i = 5; i < 32; i += 3) { const value = parseInt(scriptId.slice(i, i + 3), 16); type += base64[value >> 6] + base64[value & 63]; }
    comp(root, { __type__: type, rewardConfig: { __uuid__: configId, __expectedType__: 'cc.JsonAsset' }, btnNormal: normal, btnDouble: doubled, btnClose: close });
    comp(root, { __type__: 'cc.BlockInputEvents' });
    write(target, array); meta(target, 'prefab', { userData: { syncNodeName: 'DailySignInModal' } });
}
const entryFile = 'assets/LobbySources/prefabs/DailySignInEntry.prefab';
if (!fs.existsSync(entryFile)) {
    const scene = [{ __type__: 'cc.Prefab', _name: 'BtnDailySignIn', _objFlags: 0, __editorExtras__: {}, _native: '', data: { __id__: 1 }, optimizationPolicy: 0, persistent: false }];
    const { node, sprite, label, comp } = graph(scene);
    const entry = node('DailySignInEntry', null, 300, 300, 110, 140);
    const image = node('Icon', entry, 0, 16, 92, 92); sprite(image, 'icons/icon_Gameflow', undefined, false);
    label('Label', entry, '七日签到', 0, -49, 145, 42, 24, color(255, 255, 255));
    label('Available', entry, '●', 42, 60, 32, 32, 24, color(245, 64, 78));
    comp(entry, { __type__: 'cc.Button', _interactable: true, _transition: 0, clickEvents: [], _duration: 0.1, _zoomScale: 1.05 });
    write(entryFile, scene); meta(entryFile, 'prefab', { userData: { syncNodeName: 'DailySignInEntry' } });
}
console.log('DailySignInModal prefab, public reward icon, metadata and editable lobby entry ready.');
