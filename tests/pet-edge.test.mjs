import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {createPetController}=createRequire(import.meta.url)('../electron/pet-controller.cjs');
function fixture(initial={}) {
 let time=100000,ticker,auth=true,bounds={x:600,y:250,width:260,height:500},cursor={x:760,y:650},settings={visible:true,...initial};
 const packets=[],saved=[],mouseModes=[];
 const areas=[{x:-1440,y:0,width:1440,height:1000},{x:0,y:0,width:1440,height:1000}];
 const display=p=>({workArea:areas[p.x<0?0:1]});
 const pet={isDestroyed:()=>false,getBounds:()=>({...bounds}),setBounds:b=>{bounds={...b}},setIgnoreMouseEvents:i=>mouseModes.push(i),webContents:{send:(_,p)=>packets.push(p)}};
 const controller=createPetController({getMainWindow:()=>null,getPetWindow:()=>pet,screen:{getDisplayMatching:display,getDisplayNearestPoint:display,getCursorScreenPoint:()=>cursor},getPetState:()=>settings,isAuthenticated:()=>auth,now:()=>time,setIntervalFn:fn=>{ticker=fn;return 1},clearIntervalFn:()=>{ticker=null},onPlacement:p=>{saved.push(p);settings={...settings,...p}}});
 return {controller,packets,saved,mouseModes,get bounds(){return {...bounds}},get state(){return packets.at(-1)},get settings(){return settings},advance(ms=33){time+=ms;ticker?.()},cursor(p){cursor=p},auth(v){auth=v},settingsPatch(p){settings={...settings,...p}},start(){controller.start()},dispose(){controller.dispose()}};
}
for(const [label,dx,dy] of [['left',-70,0],['right',70,0],['up',0,-70],['down',0,70]]) {
 test(`body drag ${label} follows main-process cursor and persists release`,()=>{
  const h=fixture();h.start();const before=h.bounds;h.cursor({x:760,y:650});assert.equal(h.controller.drag({phase:'start'}).accepted,true);
  h.cursor({x:760+dx,y:650+dy});h.advance();assert.equal(h.bounds.x,before.x+dx);assert.equal(h.bounds.y,before.y+dy);assert.equal(h.state.dragging,true);
  assert.equal(h.controller.drag({phase:'end'}).moved,true);assert.deepEqual(h.saved.at(-1).position,{x:h.bounds.x,y:h.bounds.y});const released=h.bounds;h.cursor({x:50,y:50});h.advance();assert.deepEqual(h.bounds,released);h.dispose();
 });
}
test('sub-threshold cursor jitter does not move or persist; invalid drag phase rejected',()=>{
 const h=fixture();h.start();const original=h.bounds;assert.equal(h.controller.drag({phase:'bad'}).accepted,false);h.controller.drag({phase:'start'});h.cursor({x:762,y:652});h.advance();assert.deepEqual(h.bounds,original);assert.equal(h.controller.drag({phase:'end'}).moved,false);assert.equal(h.saved.length,0);h.dispose();
});
test('cross-display drag uses negative work-area coordinates and clamps extreme travel',()=>{
 const h=fixture();h.start();h.controller.drag({phase:'start'});h.cursor({x:-700,y:500});h.advance();assert.ok(h.bounds.x<0);assert.ok(h.bounds.x+h.bounds.width<=0);assert.ok(h.bounds.x>=-1440-260);h.cursor({x:-9999,y:-9999});h.advance();assert.ok(h.bounds.x>=-1440-260);assert.ok(h.bounds.y>=-500);h.controller.drag({phase:'end'});h.dispose();
});
test('dock preserves companion visibility, peeks near its bar and retreats only after 300ms away',()=>{
 const h=fixture();h.start();const prior=h.bounds;assert.equal(h.controller.dock({docked:true}).accepted,true);assert.equal(h.settings.visible,true);assert.equal(h.settings.docked,true);assert.equal(h.state.docked,true);assert.equal(h.state.peek,false);const b=h.bounds;
 h.cursor({x:b.x+b.width-99,y:990});h.advance();assert.equal(h.state.peek,true);
 h.cursor({x:30,y:30});h.advance(1);h.advance(299);assert.equal(h.state.peek,true);h.advance(1);assert.equal(h.state.peek,false);
 h.controller.dock({docked:false});assert.equal(h.state.docked,false);assert.deepEqual(h.bounds,prior);h.dispose();
});
test('peek remains available across tall menu area; quiet toggles preserve dock state',()=>{
 const h=fixture();h.start();h.controller.dock({docked:true});const b=h.bounds;h.cursor({x:b.x+b.width-99,y:990});h.advance();h.controller.interaction({menu:true});h.cursor({x:b.x+12,y:b.y+35});h.advance(1000);assert.equal(h.state.peek,true);h.settingsPatch({quiet:true});h.advance();assert.equal(h.state.docked,true);assert.equal(h.state.peek,true);assert.equal(h.state.mode,'idle');h.settingsPatch({quiet:false});h.advance();assert.equal(h.state.docked,true);assert.equal(h.state.mode,'video');h.dispose();
});
test('persisted placement and docking restore on fresh controller',()=>{
 const h=fixture({position:{x:-900,y:150},docked:true});h.start();assert.equal(h.bounds.x,-900);assert.equal(h.state.docked,true);assert.equal(h.state.peek,false);assert.equal(h.bounds.y+h.bounds.height,1000);h.dispose();
});
test('dragging a peeked pet detaches from edge and persists free position',()=>{
 const h=fixture();h.start();h.controller.dock({docked:true});let b=h.bounds;h.cursor({x:b.x+b.width-99,y:990});h.advance();h.controller.drag({phase:'start'});h.cursor({x:b.x+b.width-150,y:850});h.advance();assert.equal(h.state.docked,false);assert.equal(h.controller.drag({phase:'end'}).moved,true);assert.equal(h.saved.at(-1).docked,false);h.dispose();
});
test('stop cancels drag and resume does not continue stale movement; logout rejects commands',()=>{
 const h=fixture();h.start();h.controller.drag({phase:'start'});h.cursor({x:790,y:650});h.advance();h.controller.stop();const stopped=h.bounds;h.cursor({x:300,y:300});h.start();h.advance();assert.deepEqual(h.bounds,stopped);h.auth(false);h.controller.stop();assert.equal(h.controller.drag({phase:'start'}).accepted,false);assert.equal(h.controller.dock({docked:true}).accepted,false);h.dispose();
});
test('timeout cancels lost-release drag, and disposed controller rejects new commands',()=>{
 const h=fixture();h.start();h.controller.drag({phase:'start'});h.advance(30001);const stopped=h.bounds;h.cursor({x:30,y:30});h.advance();assert.deepEqual(h.bounds,stopped);h.dispose();assert.equal(h.controller.drag({phase:'start'}).accepted,false);assert.equal(h.controller.dock({docked:true}).accepted,false);
});

for(const [label,dx,dy] of [['left',-70,0],['right',70,0],['up',0,-70],['down',0,70]]) {
 test(`fast pointer ${label} is sampled and saved without polling or global cursor movement`,()=>{
  const h=fixture();h.start();const before=h.bounds,start={x:760,y:650};
  assert.equal(h.controller.drag({phase:'start',point:start}).accepted,true);
  assert.equal(h.controller.drag({phase:'move',point:{x:start.x+dx/2,y:start.y+dy/2}}).moved,true);
  assert.equal(h.bounds.x,before.x+dx/2);assert.equal(h.bounds.y,before.y+dy/2);
  const result=h.controller.drag({phase:'end',point:{x:start.x+dx,y:start.y+dy}});
  assert.equal(result.moved,true);assert.equal(h.bounds.x,before.x+dx);assert.equal(h.bounds.y,before.y+dy);
  assert.deepEqual(h.saved.at(-1).position,{x:before.x+dx,y:before.y+dy});
  h.advance();assert.equal(h.bounds.x,before.x+dx);assert.equal(h.bounds.y,before.y+dy);h.dispose();
 });
}
test('pointer endpoint alone captures movement faster than one polling interval',()=>{
 const h=fixture();h.start();const before=h.bounds;h.controller.drag({phase:'start',point:{x:760,y:650}});
 assert.equal(h.controller.drag({phase:'end',point:{x:850,y:590}}).moved,true);
 assert.equal(h.bounds.x,before.x+90);assert.equal(h.bounds.y,before.y-60);assert.equal(h.saved.length,1);h.dispose();
});
test('non-finite or excessive renderer points never escape work areas or corrupt a drag',()=>{
 for(const invalid of [{x:NaN,y:0},{x:0,y:Infinity},{x:100000,y:0},{x:0,y:-100000},{x:'750',y:650},null,{}]) {
  const h=fixture();h.start();const before=h.bounds;h.controller.drag({phase:'start',point:{x:760,y:650}});
  h.controller.drag({phase:'move',point:invalid});assert.deepEqual(h.bounds,before);
  h.controller.drag({phase:'end',point:invalid});assert.deepEqual(h.bounds,before);assert.equal(h.saved.length,0);h.dispose();
 }
 const h=fixture();h.start();h.controller.drag({phase:'start',point:{x:760,y:650}});h.controller.drag({phase:'end',point:{x:99999,y:-99999}});
 const b=h.bounds;assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y));assert.ok(b.x>=-1511&&b.x<=1189);assert.ok(b.y>=-306&&b.y<=509);h.dispose();
});
test('renderer wires screen coordinates into start, move and final pointer samples',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/pet.jsx',import.meta.url),'utf8');
 assert.match(source,/invoke\('petDrag',\{phase:'start',point:\{x:event\.screenX,y:event\.screenY\}\}\)/);
 assert.match(source,/invoke\('petDrag',\{phase:'move',point:\{x:event\.screenX,y:event\.screenY\}\}\)/);
 assert.match(source,/phase:event\.type==='pointercancel'\?'cancel':'end',point:\{x:event\.screenX,y:event\.screenY\}/);
 assert.match(source,/onPointerMove=\{dragMove\}/);assert.match(source,/onPointerUp=\{dragEnd\}/);
});

test('fresh bounded renderer pointer hint peeks with stationary global cursor then expires and retreats',()=>{
 const h=fixture();h.start();h.cursor({x:30,y:30});h.controller.dock({docked:true});assert.equal(h.state.peek,false);
 h.controller.interaction({pointer:{x:h.bounds.width-99,y:h.bounds.height-10}});assert.equal(h.state.peek,true);
 h.advance(180);assert.equal(h.state.peek,true);h.advance(1);assert.equal(h.state.peek,true);
 h.advance(299);assert.equal(h.state.peek,true);h.advance(1);assert.equal(h.state.peek,false);h.dispose();
});
test('invalid or out-of-window hints cannot summon the docked pet',()=>{
 const h=fixture();h.start();h.cursor({x:30,y:30});h.controller.dock({docked:true});
 for(const pointer of [{x:NaN,y:490},{x:161,y:Infinity},{x:-1,y:490},{x:261,y:490},{x:161,y:501},{x:161,y:-1},{x:'161',y:490},{},null]) {
  h.controller.interaction({pointer});assert.equal(h.state.peek,false);h.advance(33);assert.equal(h.state.peek,false);
 }
 h.dispose();
});
test('leave clears a fresh hint; stop clears hint and peek before resume',()=>{
 const h=fixture();h.start();h.cursor({x:30,y:30});h.controller.dock({docked:true});const pointer={x:h.bounds.width-99,y:h.bounds.height-10};
 h.controller.interaction({pointer});assert.equal(h.state.peek,true);h.controller.interaction({pointer:null});h.advance(300);assert.equal(h.state.peek,false);
 h.controller.interaction({pointer});assert.equal(h.state.peek,true);h.controller.stop();assert.equal(h.state.peek,false);h.start();assert.equal(h.state.peek,false);h.advance(33);assert.equal(h.state.peek,false);h.dispose();
});
test('real global cursor maintains peek after fallback hint expires and then controls departure',()=>{
 const h=fixture();h.start();h.controller.dock({docked:true});const b=h.bounds;
 h.controller.interaction({pointer:{x:b.width-99,y:b.height-10}});assert.equal(h.state.peek,true);
 h.cursor({x:b.x+b.width-99,y:990});h.advance(1000);assert.equal(h.state.peek,true);
 h.cursor({x:30,y:30});h.advance(1);h.advance(300);assert.equal(h.state.peek,false);h.dispose();
});
