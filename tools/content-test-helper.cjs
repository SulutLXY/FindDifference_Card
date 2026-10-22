const fs = require('node:fs'), vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS}}).outputText;
module.exports = function createFlow(cc) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/ContentBundlePool.ts', 'utf8')), {exports, require: () => cc});
    const tree = ts.createSourceFile('flow.ts', fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const names = ['_contentBundles','_levelFrameBundles','_pageSpriteFrames','_pageSpritesDisposed','_spriteFrameCache',
        '_loadCityBundle','_loadCityMeta','_loadLevel','_loadBundleJson','_timeFor','_levelImageTarget','_chapterSpriteTarget',
        'acquireLevelFrame','releaseLevelFrame','loadPageSpriteFrame','releasePageSpriteFrames','loadSpriteFrame','_loadSpriteFrom',
        '_ensureLevel','ensureCity','preloadNextLevel','_nextLevelTarget'];
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Flow {${body}}; Flow;`), {...cc, ContentBundlePool: exports.ContentBundlePool, console});
};
