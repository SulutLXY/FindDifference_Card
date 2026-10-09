const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}){
 const text=fs.readFileSync(file,'utf8'), tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(ts.isClassDeclaration);
 const body=cls.members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule('class Test {'+body+'}\nTest;',{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console:{error(){}},...extra});
}

const Screen=methods('assets/scripts/ui/GameScreen.ts',['update']);const s=new Screen();
s._level={};s._reminderFound=0;s._lastFoundElapsed=0;s._hintReminder=false;s._timeReminder=false;
s.resolveNode=(_,name)=>name;const calls=[];s._setReminderAnimation=(node,on)=>calls.push([node,on]);
s.flow={foundIds:new Set(),elapsedTime:19,remainingTime:30,platform:{interstitialBusy:false}};
s.update();assert.equal(calls.length,0);s.flow.elapsedTime=20;s.update();assert.deepEqual(calls.pop(),['BtnHint',true]);s.update();assert.equal(calls.length,0);
s.flow.remainingTime=29.9;s.update();assert.deepEqual(calls.pop(),['BtnAddTime',true]);
s.flow.foundIds.add('a');s.update();assert.deepEqual(calls.pop(),['BtnHint',false]);
s.flow.remainingTime=59.9;s.update();assert.deepEqual(calls.pop(),['BtnAddTime',false]);
s.flow.elapsedTime=39;s.update();assert.equal(calls.length,0);s.flow.elapsedTime=40;s.update();assert.deepEqual(calls.pop(),['BtnHint',true]);
s.flow.isPaused=true;s.update();assert.deepEqual(calls.pop(),['BtnHint',false]);
console.log('PASS reminder thresholds, no per-frame restart, found reset, time extension and pause');
