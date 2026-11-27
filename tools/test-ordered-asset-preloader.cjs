const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const releaseTransform = require('./cocos-release-transform.cjs');
const compile = text => releaseTransform(ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText);
const source = fs.readFileSync('assets/scripts/services/OrderedAssetPreloader.ts', 'utf8');
const flush = () => new Promise(setImmediate);
function fixture(stages, definitions, browser = false) {
    const requests = [], opened = [], closed = [], files = new Map(), reports = [], warnings = [];
    let allowed = true, holds = 0, maxHolds = 0, destroyed = 0;
    const cc = { sys: { isBrowser: browser }, assetManager: {
        _files: { get: key => files.get(key), remove: key => files.delete(key) },
        preloadAny(request, options, callback) {
            assert.equal(options.priority, -10);assert.equal(options.maxConcurrency, 2);assert.equal(options.maxRequestsPerFrame, 2);
            assert.equal(options.cacheEnabled, true);assert.equal(options.maxRetryCount, 0);
            requests.push({ ...request, callback });
        },
    } };
    const exports = {};
    vm.runInNewContext(compile(source), { exports, require: name => name === 'cc' ? cc : {},
        console: { warn: (...args) => warnings.push(args) } });
    if(process.env.FD_BUILT_PREFETCH_JS) require('./built-method-helper.cjs')(process.env.FD_BUILT_PREFETCH_JS,'OrderedAssetPreloader',cc)(exports.OrderedAssetPreloader,
        ['tick','fetch','prioritize','applyPriority','snapshot','dispose','close','retry','stageKey','releaseActive','trimBrowserImages']);
    const pool = {
        retain(name) { holds++;maxHolds=Math.max(maxHolds,holds);let released=false;return () => {
            assert.equal(released,false,'Each stage lease released once');released=true;holds--;closed.push(name);
        }; },
        async load(name) {
            opened.push(name);const definition=definitions[name];if(definition instanceof Error)throw definition;
            if (typeof definition === 'function') return definition();
            return { name, getDirWithPath: () => definition.map(path => ({path,uuid:name+':'+path})) };
        },
    };
    const preloader = new exports.OrderedAssetPreloader(pool, stages, () => allowed, p => reports.push(p));
    return { preloader, requests, opened, closed, files, reports, warnings, cc,
        allow: value => allowed=value, holds: () => holds, maxHolds: () => maxHolds,
        image: () => ({ naturalWidth: 100, naturalHeight: 100, destroy() { destroyed++; } }), destroyed:()=>destroyed };
}
async function drain(s, fail = () => false, limit = 500) {
    const seen=[];
    for(let step=0;step<limit;step++) {
        s.preloader.tick(1);await flush();
        if(s.requests.length) {
            const req=s.requests.shift();seen.push(req.uuid);req.callback(fail(req.uuid)?Error('offline'):null,[]);await flush();
        }
        if(['complete','partial'].includes(s.preloader.snapshot().state))return seen;
    }
    assert.fail('Warmup did not finish within bounded steps');
}
(async()=>{
    let s=fixture([{name:'common'},{name:'chapter-a'},{name:'chapter-b'},{name:'collect'}],{
        common:['ui'], 'chapter-a':['one'], 'chapter-b':['two'], collect:['icon'],
    });
    s.allow(false);s.preloader.tick(1);assert.equal(s.opened.length,0,'No speculative work before first gameplay readiness');
    s.allow(true);s.preloader.tick(1);await flush();s.preloader.tick(1);
    assert.equal(s.requests.length,1);s.preloader.tick(1);s.preloader.tick(1);assert.equal(s.requests.length,1,'Do not request the only available asset twice');
    s.allow(false);s.requests.shift().callback(null,[]);await flush();
    s.preloader.tick(1);assert.deepEqual(s.opened,['common'],'Completion never auto-chains while foreground is busy');
    s.allow(true);const rest=await drain(s);
    assert.deepEqual(s.opened,['common','chapter-a','chapter-b','collect']);
    assert.deepEqual(rest,['chapter-a:one','chapter-b:two','collect:icon']);
    assert.equal(s.maxHolds(),1);assert.equal(s.holds(),0);assert.equal(s.preloader.snapshot().completedAssets,4);

    // Two in-flight assets finish before changing chapters; no refill after a priority request.
    s=fixture([{name:'a'},{name:'b'},{name:'c'}],{a:['one','two','z-last'],b:['one'],c:['one']});
    s.preloader.tick(1);await flush();s.preloader.tick(1);
    assert.deepEqual(s.requests.map(r=>r.uuid),['a:one','a:two']);
    assert.equal(s.preloader.snapshot().inFlight,2);s.preloader.tick(1);assert.equal(s.requests.length,2,'Never exceed two in flight');
    s.preloader.prioritize(['c']);
    s.requests.shift().callback(null,[]);await flush();
    s.preloader.tick(1);assert.equal(s.requests.length,1,'Do not refill the old chapter after a selection');
    assert.equal(s.holds(),1,'Keep the old bundle until both in-flight requests finish');s.allow(false);
    s.requests.shift().callback(null,[]);await flush();
    assert.deepEqual(s.opened,['a']);assert.equal(s.holds(),0,'Release only the old background lease, without starting IO during foreground work');
    s.allow(true);assert.deepEqual(await drain(s),['c:one','a:z-last','b:one']);
    assert.deepEqual(s.opened,['a','c','a','b']);assert.equal(s.maxHolds(),1);
    assert.equal(s.preloader.snapshot().completedAssets,5,'Successful interrupted assets are not fetched twice');
    s.preloader.prioritize(['c']);s.preloader.tick(1);assert.equal(s.requests.length,0,'A completed chapter is not restarted');

    s=fixture([{name:'a'},{name:'b'},{name:'c'}],{a:['one','two','z-last'],b:['one'],c:['one']});
    s.preloader.tick(1);await flush();s.preloader.tick(1);
    s.preloader.prioritize(['b']);s.preloader.prioritize(['c']);
    s.requests.pop().callback(null,[]);await flush(); // Reverse completion order.
    s.preloader.tick(1);assert.equal(s.requests.length,1);assert.equal(s.holds(),1);
    s.requests.pop().callback(null,[]);await flush();
    assert.deepEqual(await drain(s),['c:one','a:z-last','b:one'],'Most recent selection wins with two out-of-order completions');

    // Prioritize only the selected resources, then restore the unchanged default chapter order.
    s=fixture([{name:'a'},{name:'b'},{name:'c'}],{a:['one','two','z-last'],b:['one'],c:['now/top','now/bottom','later/image']});
    s.preloader.tick(1);await flush();s.preloader.tick(1);
    s.preloader.prioritize(['c'],['now/']);
    s.requests.shift().callback(null,[]);s.requests.shift().callback(null,[]);await flush();
    assert.deepEqual(await drain(s),['c:now/bottom','c:now/top','a:z-last','b:one','c:later/image'],
        'A chapter selection must not move all its unrelated resources ahead of other chapters');

    let priorityManifest;s=fixture([{name:'a'},{name:'b'},{name:'c'}],{
        a:()=>new Promise(resolve=>priorityManifest=resolve),b:['one'],c:['one'],
    });
    s.preloader.tick(1);s.preloader.prioritize(['b']);s.preloader.prioritize(['c']);
    priorityManifest({name:'a',getDirWithPath:()=>[{uuid:'a:one',path:'one'}]});await flush();
    // On resumption the same manifest loader must now return normally.
    s.preloader.pool.load=async name=>({name,getDirWithPath:()=>[{uuid:name+':one',path:'one'}]});
    assert.deepEqual(await drain(s),['c:one','a:one','b:one'],'The most recent selection wins even while a manifest is in flight');

    s=fixture([{name:'a'},{name:'b'}],{a:['one','two'],b:['one']});
    s.preloader.tick(1);await flush();s.preloader.tick(1);s.preloader.prioritize(['a']);s.preloader.prioritize(['a']);
    s.requests.shift().callback(null,[]);await flush();assert.deepEqual(await drain(s),['a:two','b:one']);
    assert.deepEqual(s.opened,['a','b'],'Repeated taps on the active bundle do not restart its stage');

    s=fixture([{name:'chapter'},{name:'lobby',include:['SecondaryUI/']},{name:'icons'}],{
        chapter:['one'],lobby:['SecondaryUI/Collect'],icons:['one'],
    });
    s.preloader.prioritize(['lobby','icons']);
    assert.deepEqual(await drain(s),['lobby:SecondaryUI/Collect','icons:one','chapter:one'],'Explicit collection selection overrides the normal collection-last order');

    s=fixture([{name:'chapter',include:['configs/','thumbnails/','z/scene-','a/scene-']}],{chapter:[
        'a/scene-a','a/scene-a/texture','a/scene-a/spriteFrame','z/scene-a/spriteFrame',
        'thumbnails/a/icon/spriteFrame','configs/a/differences','a/authoring-source',
    ]});
    assert.deepEqual(await drain(s),['chapter:configs/a/differences','chapter:thumbnails/a/icon/spriteFrame',
        'chapter:z/scene-a/spriteFrame','chapter:a/scene-a/spriteFrame'],'Respect level order and avoid duplicate image/texture entrances and authoring JSON');

    s=fixture([{name:'lobby',exclude:['SecondaryUI/']},{name:'chapter'},{name:'lobby',include:['SecondaryUI/']},{name:'icons'}],{
        lobby:['prefabs/Home','SecondaryUI/prefabs/Collect'],chapter:['level'],icons:['icon'],
    });
    assert.deepEqual(await drain(s),['lobby:prefabs/Home','chapter:level','lobby:SecondaryUI/prefabs/Collect','icons:icon']);

    s=fixture([{name:'a'},{name:'b'}],{a:['bad','good'],b:['okay']});let failures=1;
    const retried=await drain(s,uuid=>uuid==='a:bad'&&failures-->0);
    assert.deepEqual(retried,['a:bad','a:good','b:okay','a:bad']);
    assert.equal(s.preloader.snapshot().state,'complete');assert.equal(s.preloader.snapshot().failedStages,0);
    s=fixture([{name:'broken'},{name:'good'}],{broken:['bad'],good:['ok']});
    const permanent=await drain(s,uuid=>uuid==='broken:bad');
    assert.equal(permanent.filter(id=>id==='broken:bad').length,3);assert.ok(permanent.includes('good:ok'));
    assert.equal(s.preloader.snapshot().state,'partial');assert.equal(s.preloader.snapshot().failedStages,1);
    s=fixture([{name:'offline'},{name:'good'}],{offline:Error('offline'),good:['ok']});
    assert.deepEqual(await drain(s),['good:ok']);assert.equal(s.opened.filter(n=>n==='offline').length,3);assert.equal(s.holds(),0);

    let finishManifest;s=fixture([{name:'a'}],{a:()=>new Promise(resolve=>finishManifest=resolve)});
    s.preloader.tick(1);await flush();s.preloader.dispose();assert.equal(s.holds(),1);
    finishManifest({name:'a',getDirWithPath:()=>[]});await flush();assert.equal(s.holds(),0);assert.equal(s.requests.length,0);
    s=fixture([{name:'a'}],{a:['one','two']});s.preloader.tick(1);await flush();s.preloader.tick(1);
    s.preloader.dispose();assert.equal(s.holds(),1);s.requests.shift().callback(null,[]);await flush();assert.equal(s.holds(),1);
    s.requests.shift().callback(null,[]);await flush();assert.equal(s.holds(),0);
    s.preloader.tick(1);assert.equal(s.requests.length,0);

    s=fixture([{name:'web'}],{web:['picture']},true);s.preloader.tick(1);await flush();s.preloader.tick(1);
    const image=s.image();s.files.set('native',image);s.files.set('other','foreground');
    s.requests.shift().callback(null,[{isNative:true,id:'native',file:image},{isNative:true,id:'other',file:image}]);await flush();
    assert.equal(s.files.has('native'),false,'Drop raw decoded web-image cache after background fetch');
    assert.equal(s.files.get('other'),'foreground','Do not remove a replaced foreground cache entry');assert.equal(s.destroyed(),0);

    // Exercise the real GameFlow plan and foreground/ad/loading gates.
    const text=fs.readFileSync('assets/scripts/GameFlow.ts','utf8'),tree=ts.createSourceFile('flow.ts',text,ts.ScriptTarget.Latest,true);
    const names=['_tickBackgroundAssets','_canDownloadInBackground','_prioritizeAssetDownloads','update'];
    const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
    const created=[];const Flow=vm.runInNewContext(compile(`class Flow {${body}} Flow;`),{
        OrderedAssetPreloader:class{constructor(pool,stages,canRun){this.pool=pool;this.canRun=canRun;this.priorities=[];created.push(stages);}tick(){assert.ok(this.canRun());}prioritize(names){this.priorities.push(names);}},
    });
    const firstLevels=Array.from({length:10},(_,i)=>`level-${i+1}`);
    const f=new Flow();Object.assign(f,{isValid:true,_cities:[{key:'chapter-z',levels:firstLevels},{key:'chapter-a',levels:['third']}],
        platform:{interstitialBusy:false},game:{node:{activeInHierarchy:true}},_currentLevel:{}});
    f._tickBackgroundAssets(1);assert.equal(created.length,0);
    f._prioritizeAssetDownloads(['chapter-a']);f._lobbyWarmupStarted=true;f._tickBackgroundAssets(1);
    assert.deepEqual(Array.from(f._backgroundAssets.priorities[0]),['chapter-a'],'Remember selection made before the three-second background start');
    f._prioritizeAssetDownloads(['chapter-z']);assert.deepEqual(Array.from(f._backgroundAssets.priorities[1]),['chapter-z']);
    assert.deepEqual(Array.from(created[0],s=>s.name),['MainGameSources','LobbySources','chapter-covers',
        'chapter-z','chapter-a','MainGameAimation','chapter-z','chapter-a','LobbySources','food-icons']);
    const entry=created[0][3], remainder=created[0][6];
    const covers=entry.include.filter(p=>p.startsWith('thumbnails/'));
    assert.deepEqual(Array.from(covers),firstLevels.slice(0,8).map(p=>`thumbnails/${p}/`));
    assert.deepEqual(Array.from(entry.include.filter(p=>p.startsWith('configs/'))),firstLevels.slice(0,6).map(p=>`configs/${p}/`));
    assert.deepEqual(Array.from(entry.include.filter(p=>p.includes('/scene-'))),firstLevels.slice(0,6).map(p=>`${p}/scene-`));
    assert.ok(entry.include.includes('BGmusic/'));assert.ok(entry.include.includes('prefabs/'));
    assert.ok(remainder.include.includes('level-10/scene-'),'All later levels remain in the second pass');
    // First-pass resources must be skipped when the whole chapter is revisited.
    const twoPass=fixture([entry,remainder],{'chapter-z':firstLevels.flatMap(folder=>[
        `thumbnails/${folder}/icon/spriteFrame`,`configs/${folder}/differences`,`${folder}/scene-a/spriteFrame`,`${folder}/scene-b/spriteFrame`,
    ])});
    const fetched=await drain(twoPass);
    assert.equal(fetched.length,40);assert.equal(new Set(fetched).size,40,'No duplicate first-pass requests in the second pass');
    assert.ok(fetched.indexOf('chapter-z:level-7/scene-a/spriteFrame')>fetched.indexOf('chapter-z:level-6/scene-b/spriteFrame'));
    const globalGame={name:'MainGameSources'},globalLobby={name:'LobbySources'},held=[];
    f._loadGameBundle=async()=>globalGame;f._loadLobbyBundle=async()=>globalLobby;
    f._contentBundles={retain:name=>{held.push(name);return()=>{};},load:async name=>({name})};
    const adapter=f._backgroundAssets.pool;
    for(const name of ['MainGameSources','LobbySources','MainGameAimation'])adapter.retain(name)();
    assert.deepEqual(held,[],'Never let the chapter pool unload a shared registered bundle');
    assert.equal(await adapter.load('MainGameSources'),globalGame);assert.equal(await adapter.load('LobbySources'),globalLobby);
    adapter.retain('chapter-z')();assert.deepEqual(held,['chapter-z']);
    for(const field of ['_levelLoading','_secondaryPageLoading','_levelSelectEntryPending','_rewardPending','_prefetchRunning']) {
        f[field]=true;assert.equal(f._canDownloadInBackground(),false,field);f[field]=false;
    }
    for(const field of ['_isPaused','_isGameOver']) {f[field]=true;assert.equal(f._canDownloadInBackground(),true,field);f[field]=false;}
    f.game.node.activeInHierarchy=false;assert.equal(f._canDownloadInBackground(),true,'Home and selection pages continue downloading');
    f._currentLevel=null;assert.equal(f._canDownloadInBackground(),true,'Returning home after a failed chapter load must not stop the existing queue');
    const component=JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/LevelSelectScreen.prefab','utf8')).find(x=>'pageSize' in x);
    assert.equal(component.pageSize,8,'Warmup covers must match the actual first page');
    // update() must tick downloads before any gameplay pause/end/inactive-screen return.
    for (const mode of ['home','selection','pause','result']) {
        const g=new Flow();let lobbyTicks=0,downloadTicks=0;
        Object.assign(g,{platform:{interstitialBusy:false},_currentLevel:{},_isPaused:mode!=='result',_isGameOver:mode==='result',
            game:{node:{active:false}},_tryFeedOffer(){},_tickResourceCleanup(){},_tickLobbyWarmup(){lobbyTicks++;},_tickBackgroundAssets(){downloadTicks++;}});
        g.update(0.1);assert.equal(lobbyTicks,1,mode);assert.equal(downloadTicks,1,mode);
    }
    f.feed={isPreview:true};assert.equal(f._canDownloadInBackground(),false);f.feed=null;
    f.platform.interstitialBusy=true;assert.equal(f._canDownloadInBackground(),false);
    console.log('PASS ordered asset warmup: two in flight, priority drain/resume, eight covers/six levels per chapter before remainder, cache dedup, menus/pause/results continue, retries, disposal and web-image cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
