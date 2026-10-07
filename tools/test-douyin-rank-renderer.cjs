const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const core = require('../build-templates/bytedance-mini-game/openDataContext/rank-core');
const pending = [];
let receive;
let labels = [];
const ctx = new Proxy({}, { get: (_target, name) => {
    if (name === 'clearRect') return () => { labels = []; };
    if (name === 'fillText') return value => labels.push(String(value));
    return () => {};
}, set: () => true });
const tt = {getSharedCanvas:()=>({width:750,height:1334,getContext:()=>ctx}),
    createImage:()=>({}), onMessage:handler=>{receive=handler;}, getImRankData:options=>pending.push(options)};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,
    '../build-templates/bytedance-mini-game/openDataContext/index.js'),'utf8'),
    {tt,require:()=>core,console:{warn(){}},setTimeout,clearTimeout});
const npcs = Array.from({length:50},(_,i)=>({name:'NPC'+i,passed:45-Math.floor(i*44/49),isNpc:true,avatarUrl:''}));
const box={x:50,y:1100,width:100,height:70};
const show=tab=>receive({type:'rank',action:'show',tab,passed:0,profile:null,width:750,height:1334,
    list:{x:50,y:300,width:650,height:700},fields:{rank:box,score:box,name:box,avatar:box},npcPool:npcs});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
    show('global');
    assert.ok(labels.includes('45关'));
    assert.ok(labels.includes('未上榜'));
    const old=pending.shift();
    show('friend');
    pending.shift().success({data:{items:[],total_num:0,self_item:{rank:0}}});
    await flush();
    assert.ok(labels.includes('暂无好友上榜'));
    old.success({data:{items:[{nick_name:'STALE',value:'50'}],total_num:1}});
    await flush();
    assert.ok(!labels.includes('STALE'));
    show('global');
    pending.shift().fail({errMsg:'offline'});
    await flush();
    assert.ok(labels.some(text=>text.includes('取数失败')));
    assert.ok(labels.includes('45关'));
    receive({type:'rank',action:'scroll',delta:500});
    assert.ok(!labels.includes('NPC0'));
    receive({type:'rank',action:'profile',profile:{nickName:'授权本人',avatarUrl:''}});
    assert.ok(labels.includes('授权本人'));
    show('friend');
    const last=pending.shift();
    receive({type:'rank',action:'hide'});
    assert.equal(labels.length,0);
    last.success({data:{items:[],total_num:0}});
    await flush();
    assert.equal(labels.length,0);
    console.log('Passed: canvas rendering, NPC fallback, unranked footer, empty friends, stale-response isolation, scrolling, profile refresh and close cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
