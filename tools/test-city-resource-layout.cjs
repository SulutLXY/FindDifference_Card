const fs = require('node:fs'), assert = require('node:assert/strict');
const createFlow = require('./content-test-helper.cjs');
const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
const index=read('assets/resources/configs/cities.json');
const loads=[], requests=[], removed=[];
const imageFile = p => ['.jpg','.png','.jpeg','.webp'].map(ext=>p.replace(/\/spriteFrame$/,'')+ext).find(fs.existsSync);
class JsonAsset {} class SpriteFrame {}
const root=name=>'assets/Bundle/'+(name.startsWith('city-')?'levels/':'')+name;
const bundles=new Map();
// Local scenes/templates must not pull the new remote picture packages into startup dependencies.
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const pictureIds=new Set();
for(const file of [...walk('assets/Bundle/chapter-covers'),...walk('assets/Bundle/food-icons')].filter(p=>p.endsWith('.meta'))) {
    const meta=read(file);
    for(const id of [meta.uuid,...Object.values(meta.subMetas||{}).map(m=>m.uuid)]) pictureIds.add(id);
}
for(const file of ['assets/scene/game.scene',...walk('assets/resources').filter(p=>/\.(prefab|anim)$/.test(p))]) {
    const visit=value=>{if(!value||typeof value!=='object')return;assert.ok(!pictureIds.has(value.__uuid__),file+': direct remote picture reference');for(const child of Object.values(value))visit(child);};
    visit(read(file));
}
const Flow=createFlow({JsonAsset,SpriteFrame,Sprite:class{},resources:{},assetManager:{
    loadBundle(name, done) {
        loads.push(name);
        const bundle={name,load(request,Type,callback) {
            requests.push({name,request});
            const file=Type===JsonAsset?root(name)+'/'+request+'.json':imageFile(root(name)+'/'+request);
            assert.ok(file && fs.existsSync(file),name+': missing '+request);
            const asset={isValid:true,refs:0,addRef(){this.refs++;},decRef(){assert.ok(this.refs>0);this.refs--;}};
            if(Type===JsonAsset) asset.json=read(file);
            else assert.ok(Object.values(read(file+'.meta').subMetas).some(m=>m.importer==='sprite-frame'));
            callback(null,asset);
        }};bundles.set(name,bundle);done(null,bundle);
    },removeBundle(bundle){removed.push(bundle.name);bundles.delete(bundle.name);},
}});
(async()=>{
    const flow=new Flow();flow._cityIndex=index;flow._grades=read('assets/resources/configs/levels.json');
    const cities=[];
    for(const key of index.cities) {
        const city=await flow._loadCityMeta(null,key);cities.push(city);
        const source=read(root(key)+'/configs/city.json');
        assert.equal(JSON.stringify(index.chapters[key]),JSON.stringify({key,...source}),'Generated index must match source');
        assert.equal(city.banner,'chapter-covers/'+key+'-icon/spriteFrame');
        assert.equal(fs.existsSync(root(key)+'/configs/'+key+'-icon.jpg'),false);
    }
    assert.equal(loads.length,0,'Boot metadata and save migration must not request ANY chapter bundle');
    const page=()=>({isValid:true,activeInHierarchy:true,getComponentsInChildren:()=>[]});
    const covers=page();await Promise.all(cities.map(c=>flow.loadPageSpriteFrame(c.banner,covers)));
    assert.deepEqual(loads,['chapter-covers'],'Chapter selection only loads covers');
    flow.releasePageSpriteFrames(covers);await new Promise(setImmediate);assert.equal(bundles.size,0);
    const foods=read('assets/resources/configs/food-catalog.json').foods;
    const collection=page();await Promise.all(foods.map(f=>flow.loadPageSpriteFrame(f.icon,collection)));
    assert.deepEqual(loads,['chapter-covers','food-icons'],'Collection does not load any chapter');
    for(const food of foods) {
        assert.ok(food.icon.startsWith('food-icons/'+food.cityKey+'/'));
        assert.equal(imageFile('assets/Bundle/'+food.icon),food.assetPath);
        assert.equal(read(food.assetPath+'.meta').uuid,food.assetUuid);
    }
    flow.releasePageSpriteFrames(collection);await new Promise(setImmediate);assert.equal(bundles.size,0);
    let count=0;
    for(const city of cities) {
        const before=loads.length;
        await flow._contentBundles.use(city.key,async()=>{
            for(const dir of city.levels) {
                const level=await flow._loadLevel(null,city.key,dir);count++;
                assert.equal(level.key,city.key+'/'+dir);
                for(const field of ['topImage','bottomImage','icon']) {
                    const target=flow._chapterSpriteTarget(level[field]);
                    assert.equal(target.cityKey,city.key);
                    assert.ok(imageFile(root(city.key)+'/'+target.request),level.key+': '+field);
                }
            }
            const image=await flow.acquireLevelFrame('levels/'+city.key+'/'+city.levels[0]+'/scene-a/spriteFrame');
            flow.releaseLevelFrame(image);
        });
        await new Promise(setImmediate);
        assert.deepEqual(loads.slice(before),[city.key]);
        assert.equal(bundles.size,0,'Chapter resources and package metadata must not accumulate');
    }
    assert.equal(count,200);assert.equal(cities.length,11);assert.equal(foods.length,40);
    for(const name of ['chapter-covers','food-icons',...index.cities]) {
        const meta=read(root(name)+'.meta').userData;
        assert.equal(meta.isBundle,true);assert.equal(meta.bundleName,name);
        const config=read('settings/v2/packages/builder.json').bundleConfig.custom[meta.bundleConfigID].configs.miniGame;
        assert.equal(config.fallbackOptions.isRemote,true);
    }
    console.log('PASS layout: local startup index, isolated covers/food packages, 11 chapters, 200 levels, 40 food icons and unload after use');
})().catch(error=>{console.error(error);process.exitCode=1;});
