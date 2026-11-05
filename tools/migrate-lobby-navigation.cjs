const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const sceneFile='assets/scene/game.scene',scene=read(sceneFile),allRemoved=new Set(),groups=[];
for(const name of ['CitySelect','LevelSelect']){
 const root=scene.findIndex(x=>x.__type__==='cc.Node'&&x._name===name);assert.ok(root>=0);
 assert.ok(!fs.existsSync('assets/LobbySources/prefabs/'+name+'Screen.prefab'),'Already migrated');
 const ids=new Set();function collect(i){if(ids.has(i))return;ids.add(i);function visit(x,k){if(!x||typeof x!=='object'||k==='_parent')return;if(Number.isInteger(x.__id__)){collect(x.__id__);return;}for(const [key,value]of Object.entries(x))visit(value,key);}visit(scene[i]);}collect(root);
 for(const id of ids)allRemoved.add(id);groups.push({root,ids,name});
}
const assetMap=new Map();for(const f of walk('assets').filter(f=>f.endsWith('.meta'))){const m=read(f);for(const id of [m.uuid,...Object.values(m.subMetas||{}).map(x=>x.uuid)])assetMap.set(id,f.slice(0,-5).replaceAll('\\','/'));}
function closure(objects){const set=new Set();function v(x){if(!x||typeof x!=='object')return;if(x.__uuid__){const f=assetMap.get(x.__uuid__);if(f&&!set.has(f)){set.add(f);if(/\.(prefab|anim|json|mtl)$/.test(f))v(read(f));}}Object.values(x).forEach(v);}v(objects);return set;}
const owned=closure([...allRemoved].map(i=>scene[i])),shared=closure([scene.filter((_,i)=>!allRemoved.has(i)),...walk('assets').filter(f=>/\.(prefab|anim)$/.test(f)).map(read)]);
function remap(v,map,strict=false){if(Array.isArray(v))return v.filter(x=>!(x&&Number.isInteger(x.__id__)&&!map.has(x.__id__))).map(x=>remap(x,map,strict));if(!v||typeof v!=='object')return v;if(Number.isInteger(v.__id__)){if(!map.has(v.__id__)){assert.ok(!strict,'External scene binding '+v.__id__);return null;}return {__id__:map.get(v.__id__)};}return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x,map,strict)]));}
write('config/game-first-loading/navigation-scene.before.json',scene);
for(const {root,ids,name}of groups){
 const order=[root,...[...ids].filter(i=>i!==root)],map=new Map(order.map((i,n)=>[i,n+1])),uuid=crypto.randomUUID();
 const data=[{__type__:'cc.Prefab',_name:name+'Screen',_objFlags:0,__editorExtras__:{},_native:'',data:{__id__:1},optimizationPolicy:0,persistent:false}];
 for(const i of order){const value=structuredClone(scene[i]);if(i===root)value._parent=null;data.push(remap(value,map,true));}
 data[1]._name=name+'Screen';data[1]._active=true;
 for(const x of [...data])if(x.__type__==='cc.Node'){x._prefab={__id__:data.length};data.push({__type__:'cc.PrefabInfo',root:{__id__:1},asset:{__uuid__:uuid,__expectedType__:'cc.Prefab'},fileId:crypto.randomUUID().replaceAll('-','').slice(0,22),instance:null,targetOverrides:null});}
 const file='assets/LobbySources/prefabs/'+name+'Screen.prefab';write(file,data);write(file+'.meta',{ver:'1.1.50',importer:'prefab',imported:true,uuid,files:['.json'],subMetas:{},userData:{syncNodeName:name+'Screen'}});
}
const flow=scene.find(x=>'citySelect'in x);flow.citySelect=flow.levelSelect=null;
for(const n of scene.filter(x=>x.__type__==='cc.Node'))n._children=n._children.filter(r=>!allRemoved.has(r.__id__));
const keep=scene.map((_,i)=>i).filter(i=>!allRemoved.has(i)),map=new Map(keep.map((i,n)=>[i,n]));write(sceneFile,keep.map(i=>remap(scene[i],map)));
const moved=[];
for(const from of [...owned].filter(f=>f.startsWith('assets/resources/')&&!shared.has(f))){const to=from.replace('assets/resources/','assets/LobbySources/');assert.ok(!fs.existsSync(to));fs.mkdirSync(path.dirname(to),{recursive:true});for(const ext of ['','.meta'])fs.renameSync(from+ext,to+ext);moved.push({from,to});}
// Keep the existing page assets and metadata together, but use the parent lobby bundle.
const from=path.resolve('assets/SecondaryUI'),to=path.resolve('assets/LobbySources/SecondaryUI'),workspace=process.cwd()+path.sep;
assert.ok(from.startsWith(workspace)&&to.startsWith(workspace));fs.renameSync(from,to);fs.renameSync(from+'.meta',to+'.meta');
const meta=read(to+'.meta');meta.userData={};write(to+'.meta',meta);
for(const f of walk('assets/LobbySources')){let p=path.dirname(f).replaceAll('\\','/');while(p.startsWith('assets/LobbySources/')){if(!fs.existsSync(p+'.meta'))write(p+'.meta',{ver:'1.2.0',importer:'directory',imported:true,uuid:crypto.randomUUID(),files:[],subMetas:{},userData:{}});p=path.dirname(p).replaceAll('\\','/');}}
write('config/game-first-loading/navigation-migration.json',{date:'2026-11-03',pages:groups.map(g=>g.name),moved,mergedDirectory:{from:'assets/SecondaryUI',to:'assets/LobbySources/SecondaryUI'},removedSceneObjects:allRemoved.size});
console.log('Migrated city/level selection and SecondaryUI into remote LobbySources; exclusive assets:',moved.length);
