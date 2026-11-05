// One-time migration. Preserves serialized layout and all moved asset UUIDs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const refs=o=>{const a=[];const visit=x=>{if(!x||typeof x!=='object')return;if(x.__uuid__)a.push(x.__uuid__);Object.values(x).forEach(visit);};visit(o);return a;};
const sceneFile='assets/scene/game.scene',target='assets/LobbySources/prefabs/LobbyScreen.prefab';
if(fs.existsSync(target))throw Error('Migration already applied; never overwrite the editable lobby prefab.');
const original=fs.readFileSync(sceneFile),scene=JSON.parse(original),root=scene.findIndex(x=>x.__type__==='cc.Node'&&x._name==='Lobby');
if(root<0)throw Error('Lobby not found');
const ids=new Set();function collect(i){if(ids.has(i))return;ids.add(i);const visit=(x,key)=>{if(!x||typeof x!=='object'||key==='_parent')return;if(Number.isInteger(x.__id__)){collect(x.__id__);return;}for(const [k,v]of Object.entries(x))visit(v,k);};visit(scene[i]);}collect(root);
const assetMap=new Map();for(const f of walk('assets').filter(f=>f.endsWith('.meta'))){const m=read(f);for(const id of [m.uuid,...Object.values(m.subMetas||{}).map(s=>s.uuid)])assetMap.set(id,f.slice(0,-5));}
const closure=objects=>{const out=new Set(),queue=refs(objects);while(queue.length){const f=assetMap.get(queue.pop());if(!f||out.has(f))continue;out.add(f);if(/\.(prefab|anim|json|mtl)$/.test(f)){try{queue.push(...refs(read(f)));}catch{}}}return out;};
const home=closure([...ids].map(i=>scene[i]));
const protectedObjects=scene.filter((x,i)=>!ids.has(i));
for(const f of walk('assets').filter(f=>/\.(prefab|anim)$/.test(f)))protectedObjects.push(read(f));
const shared=closure(protectedObjects);
const moved=[];
for(const f of home){if(!shared.has(f)&&f.replaceAll('\\','/').startsWith('assets/resources/'))moved.push({from:f.replaceAll('\\','/'),to:f.replaceAll('\\','/').replace('assets/resources/','assets/LobbySources/')});}
moved.push({from:'assets/resources/voice/BGmusic/Main_music00.mp3',to:'assets/LobbySources/voice/BGmusic/Main_music00.mp3'});
for(const rel of ['prefabs/DailySignInEntry.prefab','prefabs/DailySignInModal.prefab','textures/UI_Sprite/V3/icons/icon_signin_hint.png'])moved.push({from:'assets/resources/'+rel,to:'assets/LobbySources/'+rel});
// Save the exact pre-migration scene outside assets, so it cannot be imported.
fs.mkdirSync('config/game-first-loading',{recursive:true});fs.writeFileSync('config/game-first-loading/game.scene.before.json',original);
const order=[root,...[...ids].filter(i=>i!==root)],mapping=new Map(order.map((old,i)=>[old,i+1]));
function remap(value,map,strict=false){if(Array.isArray(value))return value.filter(v=>!(v&&Number.isInteger(v.__id__)&&!map.has(v.__id__))).map(v=>remap(v,map,strict));if(!value||typeof value!=='object')return value;if(Number.isInteger(value.__id__)){if(!map.has(value.__id__)){if(strict)throw Error('External object reference '+value.__id__);return null;}return {__id__:map.get(value.__id__)};}return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,map,strict)]));}
const prefab=[{__type__:'cc.Prefab',_name:'LobbyScreen',_objFlags:0,__editorExtras__:{},_native:'',data:{__id__:1},optimizationPolicy:0,persistent:false}];
for(const i of order){const value=structuredClone(scene[i]);if(value.__type__==='cc.Node'&&i===root)value._parent=null;prefab.push(remap(value,mapping,true));}
prefab[1]._name='LobbyScreen';
const prefabUUID=crypto.randomUUID();
for(const [i,x]of [...prefab].entries())if(x.__type__==='cc.Node'){x._prefab={__id__:prefab.length};prefab.push({__type__:'cc.PrefabInfo',root:{__id__:1},asset:{__uuid__:prefabUUID,__expectedType__:'cc.Prefab'},fileId:crypto.randomUUID().replaceAll('-','').slice(0,22),instance:null,targetOverrides:null});}
write(target,prefab);write(target+'.meta',{ver:'1.1.50',importer:'prefab',imported:true,uuid:prefabUUID,files:['.json'],subMetas:{},userData:{syncNodeName:'LobbyScreen'}});
const flow=scene.find(x=>'lobby'in x);flow.lobby=null;flow.game=null;
for(const node of scene.filter(x=>x.__type__==='cc.Node'))node._children=node._children.filter(ref=>!ids.has(ref.__id__));
// Prune detached components left by earlier editor prefab removals as well.
const live=new Set();function mark(i){if(live.has(i)||ids.has(i))return;live.add(i);function v(x){if(!x||typeof x!=='object')return;if(Number.isInteger(x.__id__)){mark(x.__id__);return;}Object.values(x).forEach(v);}v(scene[i]);}mark(0);
const kept=[...live].sort((a,b)=>a-b),sceneMap=new Map(kept.map((old,i)=>[old,i]));write(sceneFile,kept.map(i=>remap(scene[i],sceneMap)));
for(const m of moved){if(!fs.existsSync(m.from))throw Error('Missing source '+m.from);fs.mkdirSync(path.dirname(m.to),{recursive:true});fs.renameSync(m.from,m.to);fs.renameSync(m.from+'.meta',m.to+'.meta');}
write('assets/LobbySources.meta',{ver:'1.2.0',importer:'directory',imported:true,uuid:crypto.randomUUID(),files:[],subMetas:{},userData:{isBundle:true,bundleName:'LobbySources',bundleConfigID:'66NbM5tAFFNImQdJTJ7bY+',priority:7}});
for(const dir of ['assets/LobbySources',...new Set(walk('assets/LobbySources').map(f=>path.dirname(f)))]){let p=dir;while(p!=='assets'&&p.startsWith('assets/LobbySources')){if(!fs.existsSync(p+'.meta'))write(p+'.meta',{ver:'1.2.0',importer:'directory',imported:true,uuid:crypto.randomUUID(),files:[],subMetas:{},userData:{}});p=path.dirname(p).replaceAll('\\','/');}}
const gameMeta=read('assets/PleyGame.meta');gameMeta.userData.bundleConfigID='default';gameMeta.userData.priority=9;write('assets/PleyGame.meta',gameMeta);
const supportMeta=read('assets/SupportTexture.meta');supportMeta.userData.bundleConfigID='default';write('assets/SupportTexture.meta',supportMeta);
write('config/game-first-loading/migration.json',{date:'2026-11-03',sceneBeforeSHA256:crypto.createHash('sha256').update(original).digest('hex'),lobbyObjects:ids.size,moved,gameBundle:'local',lobbyBundle:'remote',sharedSupportBundle:'local'});
console.log('Extracted editable lobby; moved',moved.length,'exclusive assets; preserved UUIDs and layout.');
