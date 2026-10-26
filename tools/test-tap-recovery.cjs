const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source = fs.readFileSync('assets/scripts/ui/GameScreen.ts', 'utf8');
const tree = ts.createSourceFile('screen.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_onGestureStart', '_onGestureMove', '_onGestureEnd', '_onGestureCancel', '_remainingTouchCount', '_resetGesture', '_touchDistance', 'TAP_SLOP'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
class Vec2 { constructor(x=0,y=0) {this.x=x;this.y=y;} set(x,y){this.x=x;this.y=y;} }
const Screen = vm.runInNewContext(ts.transpileModule(`class GameScreen {${body}}; GameScreen;`, {compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText, {Vec2,Vec3:{ZERO:{x:0,y:0}}});
const screen = new Screen(); screen._zoomScale=1; screen._lastTouch=new Vec2(); screen._touchStart=new Vec2();
screen._setZoom = value => {screen._zoomScale=value;}; screen._image=()=>null;screen._setPan=()=>{};screen._screenDeltaToLocal=v=>v;
let taps=0;screen._onImageTouch=()=>taps++;
const touch=(id,x=0,y=0)=>({getID:()=>id,getUILocation:()=>({x,y})});
const event=(id,all,x=0,y=0)=>({touch:touch(id,x,y),getAllTouches:()=>all,getUILocation:()=>({x,y})});
function tap(id=1) {screen._onGestureStart(event(id,[touch(id)]));screen._onGestureEnd(event(id,[]),{});}
for(let i=0;i<100;i++)tap(i);
assert.equal(taps,100,'Rapid valid taps must all reach hit testing');
screen._onGestureStart(event(1,[touch(1)]));screen._onGestureMove(event(1,[touch(1,30)],30));
screen._onGestureEnd(event(1,[]),{});assert.equal(taps,100,'Drag is not a wrong/correct tap');
tap();assert.equal(taps,101);
// Pinch with no move event must not produce a click when either finger lifts.
screen._onGestureStart(event(1,[touch(1)]));screen._onGestureStart(event(2,[touch(1),touch(2,100)]));
screen._onGestureEnd(event(2,[touch(1)]),{});screen._onGestureEnd(event(1,[]),{});assert.equal(taps,101);
tap();assert.equal(taps,102);
// Reproduce a zoom/pan followed by native TOUCH_CANCEL, then a new correct tap.
screen._zoomScale=2;screen._onGestureStart(event(1,[touch(1)]));screen._onGestureMove(event(1,[touch(1,30)],30));
assert.equal(screen._ignoreTapUntilRelease,true);screen._onGestureCancel(event(1,[]));
assert.equal(screen._ignoreTapUntilRelease,false);tap();assert.equal(taps,103);
// Some bridges include the ending touch in getAllTouches; it must not remain stuck.
screen._ignoreTapUntilRelease=true;screen._onGestureEnd(event(1,[touch(1)]),{});
assert.equal(screen._ignoreTapUntilRelease,false);tap();assert.equal(taps,104);
// Lost release events cannot poison the next independent single-finger gesture.
screen._ignoreTapUntilRelease=true;tap();assert.equal(taps,105);
screen._onGestureStart(event(2,[touch(1),touch(2,100)]));screen._onGestureCancel(event(2,[touch(1)]));
screen._onGestureEnd(event(1,[]),{});assert.equal(taps,105);tap();assert.equal(taps,106);
console.log('PASS: rapid taps, drag/pinch suppression, cancelled/omitted/native-inclusive release recovery and next-tap delivery.');
