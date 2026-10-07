const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.COCOS_TYPESCRIPT_PATH || 'D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
function loadTs(file, host = {}) {
    const output = {};
    const source = fs.readFileSync(file, 'utf8');
    const environment = {exports:output, setTimeout, clearTimeout, console:{warn(){}}, ...host,
        require: name => loadTs(path.resolve(path.dirname(file), name + '.ts'), host)};
    vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2018}}).outputText, environment);
    return output;
}
const { createNpcRankPool, sortRankPool } = loadTs(path.resolve(__dirname, '../assets/scripts/services/rank/NpcRankPool.ts'));
const { fetchRank, mergeRank } = require('../build-templates/bytedance-mini-game/openDataContext/rank-core');
(async () => {
    const npcs = createNpcRankPool();
    assert.equal(npcs.length, 50);
    assert.equal(new Set(npcs.map(row => row.name)).size, 50);
    assert.equal(Math.max(...npcs.map(row => row.passed)),45);
    assert.equal(JSON.stringify(npcs),JSON.stringify(createNpcRankPool()));
    const real = Array.from({length:120}, (_,i) => ({openid:'id'+i,nick_name:'玩家'+i,value:String(120-i),user_img:''}));
    const calls = [];
    const sdk = {getImRankData:o=>{
        calls.push([o.pageNum,o.pageSize,o.rankType,o.relationType,o.zoneId]);
        o.success({data:{items:real.slice((o.pageNum-1)*30,o.pageNum*30),total_num:120,
            self_user_info:{openid:'id119',nick_name:'本人'},self_item:{rank:120,item:real[119]}}});
    }};
    const data = await fetchRank(sdk,'global');
    assert.equal(data.rows.length,99);
    assert.equal(calls.length,4);
    assert.ok(calls.every(call=>call[1]===30&&call[2]==='all'&&call[3]==='all'&&call[4]==='default'));
    let result = mergeRank(data,'global',npcs,9109,null);
    assert.equal(result.entries.length,99);
    assert.equal(result.selfRank,0);
    assert.equal(result.self.passed,1);
    assert.equal(result.hasNpcs,false);
    const empty = {rows:[],selfItem:{rank:0},selfUser:null};
    result=mergeRank(empty,'global',npcs,9109,null);
    assert.equal(result.entries.length,50);
    assert.equal(result.selfRank,0);
    assert.equal(result.self.passed,9109);
    assert.equal(mergeRank(empty,'friend',npcs,5,null).entries.length,0);
    const lowSelf={rows:Array.from({length:80},(_,i)=>({name:'真实'+i,passed:i===79?1:100,isSelf:i===79})),selfItem:{rank:80,item:{value:'1'}},selfUser:{nick_name:'我'}};
    result=mergeRank(lowSelf,'global',npcs,1,null);
    assert.equal(result.entries.length,99);
    assert.equal(result.selfRank,0);
    assert.ok(result.entries.some(row=>row.isNpc));
    const ranked={rows:[{name:'我',passed:46,isSelf:true}],selfItem:{rank:1,item:{value:'46'}},selfUser:{nick_name:'我'}};
    assert.equal(mergeRank(ranked,'global',npcs,46,null).selfRank,1);
    assert.equal(sortRankPool(Array.from({length:130},(_,i)=>({passed:i}))).length,99);
    assert.equal((await fetchRank({getImRankData:o=>o.success({data:{items:[],total_num:0}})},'friend')).rows.length,0);
    await assert.rejects(fetchRank({getImRankData:o=>o.fail({errMsg:'not login',errNo:21101})},'friend'),/21101/);
    await assert.rejects(fetchRank({getImRankData:o=>o.success({data:{}})},'friend'),/格式异常/);
    const platform={kind:'douyin',playerInfo:{profile:null,login:async()=>({success:true,data:{isAnonymous:false}})}};
    const {DouyinRankProvider}=loadTs(path.resolve(__dirname,'../assets/scripts/services/rank/DouyinRankProvider.ts'),{tt:{getImRankData:()=>{throw Error('forbidden in main domain');}}});
    const provider=new DouyinRankProvider(platform,{totalScore:5});
    assert.equal((await provider.fetch('global')).entries.length,0);
    assert.equal((await provider.fetch('friend')).entries.length,0);
    assert.equal((await provider.fetch('global')).selfRank,0);
    const nativeCalls = [];
    const nativeSdk = {
        setImRankData: o => { nativeCalls.push(['score',o]); o.success({}); },
        getImRankList: o => { nativeCalls.push(['open',o]); o.success({}); },
        getOpenDataContext: () => { throw Error('retired context'); },
        getImRankData: () => { throw Error('retired fetch'); },
    };
    const NativeProvider = loadTs(path.resolve(__dirname,'../assets/scripts/services/rank/DouyinRankProvider.ts'),{tt:nativeSdk}).DouyinRankProvider;
    const native = new NativeProvider(platform,{totalScore:5});
    assert.equal((await native.openNative()).success,true);
    assert.deepEqual(nativeCalls.map(c=>c[0]),['score','open']);
    assert.equal(nativeCalls[0][1].value,'5');
    const options = nativeCalls[1][1];
    assert.equal(options.relationType,'default');
    assert.equal(options.rankType,'all');
    assert.equal(options.dataType,0);
    assert.equal(options.zoneId,'default');
    assert.equal(options.suffix,'关');
    nativeSdk.setImRankData=o=>o.fail({errMsg:'upload error'});
    assert.equal((await native.openNative()).success,true);
    nativeSdk.getImRankList=o=>o.fail({errMsg:'not supported',errNo:20000});
    assert.match((await native.openNative()).message,/20000/);
    const anonymous=new NativeProvider({kind:'douyin',playerInfo:{login:async()=>({success:true,data:{isAnonymous:true}})}},{totalScore:5});
    assert.equal((await anonymous.openNative()).success,false);
    delete nativeSdk.getImRankList;
    assert.equal((await native.openNative()).success,false);
    assert.ok(!fs.readFileSync(path.resolve(__dirname,'../assets/scripts/ui/RankScreen.ts'),'utf8').includes('DouyinRankView'));
    const flowSource=fs.readFileSync(path.resolve(__dirname,'../assets/scripts/GameFlow.ts'),'utf8');
    assert.match(flowSource,/showRank\(\): void\s*\{\s*if \(this.platform.isHarmony\) return;\s*if \(this.platform.kind === 'douyin'\)\s*\{\s*void this\._showNativeRank\(\);\s*return;/);
    let harmonyApiCalls=0;
    nativeSdk.getImRankList=nativeSdk.setImRankData=()=>{harmonyApiCalls++;};
    const harmonyPlatform={kind:'douyin',isHarmony:true,playerInfo:{login:()=>{throw Error('must not login for rank');}}};
    const harmony=new NativeProvider(harmonyPlatform,{totalScore:5});
    assert.equal((await harmony.openNative()).success,false);
    harmony.submitScore(5,0,1);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(harmonyApiCalls,0);
    const asyncHarmony=new NativeProvider({...harmonyPlatform,isHarmony:false,detectHarmony:async()=>true},{totalScore:5});
    assert.equal((await asyncHarmony.openNative()).success,false);
    asyncHarmony.submitScore(5,0,1);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(harmonyApiCalls,0);
    const {LocalRankProvider}=loadTs(path.resolve(__dirname,'../assets/scripts/services/rank/LocalRankProvider.ts'));
    assert.equal((await new LocalRankProvider({totalScore:0}).fetch('global')).selfRank,0);
    assert.equal((await new LocalRankProvider({totalScore:46}).fetch('global')).selfRank,1);
    console.log('Passed: native login/upload/open parameters, upload failure fallback, SDK failure/unsupported/anonymous handling, no custom context or page switch; local and legacy rank regressions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
