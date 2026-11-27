const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const text=fs.readFileSync('assets/scripts/GameFlow.ts','utf8');
const tree=ts.createSourceFile('Flow.ts',text,ts.ScriptTarget.Latest,true);
const names=['_tickResourceCleanup','_releaseChapterComboClips','_loadComboClip','_cacheMusicClip','_disposeSecondaryPages','_switchTo',
 '_secondaryIdleSeconds','_secondaryPagesPending','_secondaryPrefabs','_retiredPagePrefabs','_comboClips',
 '_chapterComboClips','_chapterComboCacheVersion','_comboSoundRequest','_successSoundBags','_musicClips'];
const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
class Clip{constructor(name){this.name=name;this.refs=0;}addRef(){this.refs++;}decRef(){assert.ok(this.refs>0,this.name+': unbalanced release');this.refs--;}}
const Flow=vm.runInNewContext(ts.transpileModule(`class Flow{${body}};Flow;`,{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{AudioClip:Clip});
if(process.env.FD_BUILT_MEMORY_JS) require('./built-method-helper.cjs')(process.env.FD_BUILT_MEMORY_JS,'GameFlow',{AudioClip:Clip})(Flow,
 ['_tickResourceCleanup','_releaseChapterComboClips','_loadComboClip','_cacheMusicClip','_disposeSecondaryPages','_switchTo']);
const flush=()=>new Promise(setImmediate);
(async()=>{
 const f=new Flow(),loads=[];
 f.isValid=true;f._comboSource={clip:null,stop(){}};
 f._contentBundles={use:async(_,action)=>action({load(path,Type,done){loads.push({path,done});}})};
 const ref={chapterBundle:'chapter',path:'dedicated',fromBundle:true};
 const a=f._loadComboClip(1,ref);await flush();const clip=new Clip('chapter');loads.shift().done(null,clip);await a;
 assert.equal(clip.refs,1);f._comboSource.clip=clip;
 const common=Promise.resolve(new Clip('common'));f._comboClips.set('MainGameSources:short',common);
 f._releaseChapterComboClips();assert.equal(clip.refs,0);assert.equal(f._comboSource.clip,null);
 assert.equal(f._chapterComboClips.size,0);assert.equal(f._comboClips.size,1);assert.equal(f._comboClips.get('MainGameSources:short'),common);
 const late=f._loadComboClip(1,ref);await flush();f._releaseChapterComboClips();
 const stale=new Clip('late');loads.shift().done(null,stale);await late;
 assert.equal(stale.refs,0);assert.equal(f._chapterComboClips.size,0,'Late success cannot repopulate the evicted cache');
 const failed=f._loadComboClip(1,ref),rejected=assert.rejects(failed,/old request/);await flush();
 f._releaseChapterComboClips();const next=f._loadComboClip(1,ref);await flush();
 const current=f._comboClips.get('chapter:dedicated');loads.shift().done(Error('old request'));
 await rejected;assert.equal(f._comboClips.get('chapter:dedicated'),current,'Old failure cannot delete a newer pending cache entry');
 const nextClip=new Clip('next');loads.shift().done(null,nextClip);await next;assert.equal(nextClip.refs,1);f._releaseChapterComboClips();
 const leaving=new Clip('leave-game');leaving.addRef();f._chapterComboClips.add(leaving);f._comboSource.clip=leaving;
 f.game={close(){}};f.lobby={open(){}};f._cancelSecondaryNavigation=()=>{};f._stopResultTone=()=>{};f._playPageMusic=()=>{};
 f._switchTo(f.lobby);assert.equal(leaving.refs,0);assert.equal(f._comboSource.clip,null,'Production page switching must invoke chapter-audio cleanup');
 const m1=new Clip('music-one'),m2=new Clip('music-two');
 m1.addRef(); // Independent mixer ownership of the outgoing track.
 f._cacheMusicClip('one',m1);f._cacheMusicClip('two',m2);
 assert.equal(f._musicClips.size,1);assert.equal(m1.refs,1,'Cache eviction must not destroy the outgoing mixer voice');
 assert.equal(m2.refs,1);f._cacheMusicClip('two',m2);assert.equal(m2.refs,1,'Repeated caching does not add references');
 m1.decRef();m2.decRef();f._musicClips.clear();
 f.save={data:{musicEnabled:false}};const muted=new Clip('late-while-muted');f._cacheMusicClip('muted',muted);
 assert.equal(muted.refs,0);assert.equal(f._musicClips.size,0,'A background music download must not repopulate the cache after muting');
 const p=new Flow(),released=[],closed=[];p.releasePageSpriteFrames=node=>released.push(node);
 p._cancelSecondaryNavigation=()=>{};
 const prefab=new Clip('page-prefab');prefab.addRef();
 const node={activeInHierarchy:false,destroy(){this.destroyed=true;}};
 p.collect={isValid:true,node,close(){closed.push('collect');}};p._secondaryPrefabs.set('collect',prefab);
 for(let i=0;i<29;i++)p._tickResourceCleanup(1);
 assert.ok(p.collect);assert.equal(prefab.refs,1);
 node.activeInHierarchy=true;p._tickResourceCleanup(1);node.activeInHierarchy=false;
 for(let i=0;i<29;i++)p._tickResourceCleanup(1);assert.ok(p.collect,'Opening a cached page resets its idle timeout');
 p._secondaryPagesPending.set('collect',Promise.resolve());p._tickResourceCleanup(1);p._secondaryPagesPending.delete('collect');
 for(let i=0;i<30;i++)p._tickResourceCleanup(1);
 assert.equal(p.collect,null);assert.equal(node.destroyed,true);assert.deepEqual(released,[node]);assert.deepEqual(closed,['collect']);
 assert.equal(prefab.refs,1,'Keep prefab dependencies until old node destruction reaches the next frame');
 p._tickResourceCleanup(0.016);assert.equal(prefab.refs,0);
 p._disposeSecondaryPages();p._tickResourceCleanup(1);assert.equal(prefab.refs,0,'Disposal must not release the retired prefab twice');
 console.log('PASS resource memory policy: chapter/cache invalidation, stale audio success/failure, one cached long track with mixer ownership, hidden-page TTL/reset, pending-page protection and next-frame prefab release');
})().catch(error=>{console.error(error);process.exitCode=1;});
