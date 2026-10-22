import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';const require=createRequire(import.meta.url);const{createPetController,clampPetBounds,motionAt}=require('../electron/pet-controller.cjs');
function harness({referenceVideo=true}={}){let time=100000,tick,petBounds={x:700,y:450,width:260,height:500},mainBounds={x:40,y:50,width:900,height:700},minimized=false,shown=true,focused=false,authed=true,settings={visible:true},cursor={x:0,y:0},listeners={},opacity=1,mainDead=false,petDead=false,focusFails=false,maximized=false;const packets=[],mouseModes=[],actions=[],timeouts=new Map();let timeoutId=0,intervals=0;
 const main={isDestroyed:()=>mainDead,isVisible:()=>shown,setOpacity(value){opacity=value;actions.push(['opacity',value]);},showInactive(){shown=true;actions.push(['showInactive']);},getNormalBounds:()=>({...mainBounds}),getBounds:()=>({...mainBounds}),isMaximized:()=>maximized,maximize(){maximized=true;actions.push(['maximize']);},isMinimized:()=>minimized,minimize(){minimized=true;actions.push(['minimize']);},hide(){shown=false;actions.push(['hide']);},restore(){minimized=false;shown=true;actions.push(['restore']);listeners.restore?.();},setBounds(bounds){mainBounds={...bounds};actions.push(['setBounds']);},show(){shown=true;actions.push(['show']);listeners.show?.();},focus(){if(focusFails)throw Error('focus unavailable');focused=true;actions.push(['focus']);},on(name,fn){listeners[name]=fn;},removeListener(name){delete listeners[name];}};
 const pet={setIgnoreMouseEvents:(ignore,options)=>mouseModes.push({ignore,options}),isDestroyed:()=>petDead,getBounds:()=>({...petBounds}),setBounds(bounds){petBounds={...bounds};},showInactive(){},webContents:{send:(channel,payload)=>packets.push({channel,...payload})}};
 const screen={getDisplayMatching:bounds=>({workArea:bounds.x<0?{x:-1440,y:0,width:1440,height:1000}:{x:0,y:0,width:1200,height:1000}}),getCursorScreenPoint:()=>cursor};
 const controller=createPetController({getMainWindow:()=>main,getPetWindow:()=>pet,screen,isAuthenticated:()=>authed,getPetState:()=>settings,referenceVideo,now:()=>time,setIntervalFn:fn=>{tick=fn;intervals++;return 1;},clearIntervalFn:()=>{intervals--;},setTimeoutFn:(fn,ms)=>{const id=++timeoutId;timeouts.set(id,{fn,at:time+ms});return id;},clearTimeoutFn:id=>timeouts.delete(id),emit:(channel,payload)=>packets.push({channel,...payload})});
 return{controller,packets,mouseModes,actions,get opacity(){return opacity;},get timerCount(){return timeouts.size;},setMainDead(value){mainDead=value;},setPetDead(value){petDead=value;},setFocusFails(value){focusFails=value;},setMaximized(value){maximized=value;},nativeMinimize(){main.minimize();},externalShow(){main.show();},get bounds(){return petBounds;},get mainBounds(){return mainBounds;},get shown(){return shown;},get focused(){return focused;},get minimized(){return minimized;},get intervals(){return intervals;},advance(ms){time+=ms;tick?.();for(const [id,timer]of timeouts)if(timer.at<=time){timeouts.delete(id);timer.fn();}},setCursor(point){cursor=point;},setAuth(value){authed=value;},setSettings(value){settings=value;},move(bounds){petBounds=bounds;}};
}
test('multi-display bounds stay in work area including negative display coordinates',()=>{assert.deepEqual(clampPetBounds({x:-1500,y:800,width:260,height:500},{x:-1440,y:0,width:1440,height:1000}),{x:-1440,y:500,width:260,height:500});assert.equal(clampPetBounds({x:2000,y:0,width:260,height:500},{x:0,y:0,width:1200,height:1000}).x,940);});
test('walking has smooth acceleration and deceleration',()=>{assert.equal(motionAt(0).mode,'idle');assert.equal(motionAt(7000).speed,0);assert.ok(motionAt(7200).speed<motionAt(8000).speed);assert.equal(motionAt(9000).speed,24);assert.ok(motionAt(11900).speed<24);assert.equal(motionAt(13000).mode,'idle');});
test('legacy controller uses same walking state as window movement; hover and reduced motion stop it',()=>{const h=harness({referenceVideo:false});h.controller.start();h.advance(9000);const before=h.bounds.x;for(let i=0;i<20;i++)h.advance(33);assert.ok(h.bounds.x<before);assert.equal(h.packets.at(-1).mode,'walk');h.controller.interaction({hover:true});const stopped=h.bounds.x;for(let i=0;i<20;i++)h.advance(33);assert.equal(h.bounds.x,stopped);assert.equal(h.packets.at(-1).mode,'idle');h.controller.interaction({hover:false,reducedMotion:true});h.advance(33);assert.equal(h.bounds.x,stopped);h.controller.dispose();});
test('mouse proximity and quiet/static custom pets disable window wandering',()=>{const h=harness();h.controller.start();h.advance(8500);h.setCursor({x:h.bounds.x+167,y:h.bounds.y+405});h.advance(33);assert.equal(h.packets.at(-1).mode,'idle');h.setCursor({x:0,y:0});h.setSettings({visible:true,imageData:'custom'});h.advance(33);assert.equal(h.packets.at(-1).mode,'idle');h.setSettings({visible:true,quiet:true});h.advance(33);assert.equal(h.packets.at(-1).mode,'idle');h.controller.dispose();});
test('fold hides without native minimization; prepared unfold preserves bounds and restores focus',async()=>{const h=harness();const original=h.mainBounds;h.controller.start();const folding=h.controller.fold();assert.equal(h.minimized,false);assert.equal(h.packets.at(-1).phase,'fold');h.advance(320);assert.equal((await folding).folded,true);assert.equal(h.minimized,false);assert.equal(h.shown,false);const unfolding=h.controller.unfold();const ready=h.packets.findLast(p=>p.phase==='prepare-unfold');assert.equal(h.opacity,0);h.controller.transitionReady({transitionId:ready.transitionId});await Promise.resolve();h.advance(320);assert.equal((await unfolding).folded,false);assert.equal(h.minimized,false);assert.equal(h.shown,true);assert.equal(h.focused,true);assert.deepEqual(h.mainBounds,original);h.controller.dispose();});
test('not authenticated cannot fold; start/stop/dispose are idempotent',async()=>{const h=harness();h.setAuth(false);h.controller.start();h.controller.start();assert.equal(h.intervals,1);assert.equal((await h.controller.fold()).folded,false);h.advance(9000);assert.equal(h.packets.at(-1).mode,'idle');h.controller.stop();h.controller.stop();assert.equal(h.intervals,0);h.controller.dispose();h.controller.start();assert.equal(h.intervals,0);});

test('unfold cancels an in-flight fold and prevents delayed minimization',async()=>{const h=harness();h.controller.start();const folding=h.controller.fold();h.advance(100);const unfolding=h.controller.unfold();const ready=h.packets.findLast(p=>p.phase==='prepare-unfold');h.controller.transitionReady({transitionId:ready.transitionId});await Promise.resolve();h.advance(320);await Promise.all([folding,unfolding]);assert.equal(h.minimized,false);assert.equal(h.focused,true);h.controller.dispose();});

test('transparent space forwards mouse movement and hit regions become clickable',()=>{const h=harness();h.controller.interaction({interactive:false});h.controller.interaction({interactive:false});h.controller.interaction({interactive:true});h.controller.interaction({interactive:true});h.controller.interaction({interactive:false});assert.deepEqual(h.mouseModes,[{ignore:true,options:{forward:true}},{ignore:false,options:{forward:true}},{ignore:true,options:{forward:true}}]);h.controller.dispose();});
test('stop cancels folding so a locked session cannot minimize later',async()=>{const h=harness();h.controller.start();const pending=h.controller.fold();h.advance(100);h.controller.stop();h.advance(500);await pending;assert.equal(h.minimized,false);h.controller.dispose();});
test('start cancels a previous transition before a new session',async()=>{const h=harness();h.controller.start();const pending=h.controller.fold();h.advance(100);h.controller.start();h.advance(500);await pending;assert.equal(h.minimized,false);h.controller.dispose();});

test('same-direction double clicks share one transition and renderer must prepare before unfold starts',async()=>{
 const h=harness();h.controller.start();const one=h.controller.fold(),two=h.controller.fold();assert.equal(one,two);assert.equal(h.packets.filter(p=>p.phase==='fold').length,1);assert.equal(h.timerCount,1);h.advance(320);await one;assert.equal(h.actions.filter(a=>a[0]==='minimize').length,0);assert.equal(h.shown,false);
 const first=h.controller.unfold(),second=h.controller.unfold();assert.equal(first,second);const prepare=h.packets.findLast(p=>p.phase==='prepare-unfold');assert.ok(prepare);assert.equal(h.opacity,0);assert.equal(h.focused,false);assert.equal(h.packets.filter(p=>p.phase==='unfold').length,0);assert.equal(h.controller.transitionReady({transitionId:'old'}).accepted,false);assert.equal(h.opacity,0);
 assert.equal(h.controller.transitionReady({transitionId:prepare.transitionId}).accepted,true);await Promise.resolve();assert.equal(h.opacity,1);assert.equal(h.packets.filter(p=>p.phase==='unfold').length,1);assert.equal(h.controller.transitionReady({transitionId:prepare.transitionId}).accepted,false);h.advance(320);await first;assert.equal(h.focused,true);assert.equal(h.timerCount,0);h.controller.dispose();
});

test('missing renderer acknowledgement falls back to full visibility after 500ms',async()=>{
 const h=harness();h.controller.start();const fold=h.controller.fold();h.advance(320);await fold;const opening=h.controller.unfold();const prepare=h.packets.findLast(p=>p.phase==='prepare-unfold');h.advance(499);assert.equal(h.opacity,0);h.advance(1);assert.equal((await opening).folded,false);assert.equal(h.shown,true);assert.equal(h.opacity,1);assert.equal(h.packets.filter(p=>p.phase==='unfold').length,0);assert.equal(h.controller.transitionReady({transitionId:prepare.transitionId}).accepted,false);h.controller.dispose();
});

test('reverse fold cancels prepared unfold without a stale acknowledgement flashing the window',async()=>{
 const h=harness();h.controller.start();const fold=h.controller.fold();h.advance(320);await fold;const opening=h.controller.unfold();const old=h.packets.findLast(p=>p.phase==='prepare-unfold');const folding=h.controller.fold();assert.equal(h.controller.transitionReady({transitionId:old.transitionId}).accepted,false);h.advance(320);await Promise.all([opening,folding]);assert.equal(h.shown,false);assert.equal(h.opacity,1);assert.equal(h.focused,false);assert.equal(h.timerCount,0);h.controller.dispose();
});

test('reduced motion hides and restores immediately without animations or timing waits',async()=>{
 const h=harness();h.controller.start();h.controller.interaction({reducedMotion:true});assert.equal((await h.controller.fold()).folded,true);assert.equal(h.shown,false);assert.equal(h.minimized,false);assert.equal(h.timerCount,0);assert.equal((await h.controller.unfold()).folded,false);assert.equal(h.shown,true);assert.equal(h.focused,true);assert.equal(h.packets.filter(p=>['fold','unfold','prepare-unfold'].includes(p.phase)).length,0);h.controller.dispose();
});

test('hidden pet prevents custom folding but ordinary native minimize can always restore',async()=>{
 const h=harness();h.controller.start();h.setSettings({visible:false});await assert.rejects(h.controller.fold(),{code:'PET_UNAVAILABLE'});assert.equal(h.shown,true);assert.equal(h.timerCount,0);h.nativeMinimize();const opening=h.controller.unfold();const prepare=h.packets.findLast(p=>p.phase==='prepare-unfold');assert.equal(h.actions.filter(a=>a[0]==='restore').length,1);h.controller.transitionReady({transitionId:prepare.transitionId});await Promise.resolve();h.advance(320);await opening;assert.equal(h.minimized,false);assert.equal(h.shown,true);assert.equal(h.opacity,1);h.controller.dispose();
});

test('pet hidden mid-fold leaves a recoverable visible main window',async()=>{
 const h=harness();h.controller.start();const folding=h.controller.fold();const rejection=assert.rejects(folding,{code:'PET_UNAVAILABLE'});h.setSettings({visible:false});h.advance(320);await rejection;assert.equal(h.shown,true);assert.equal(h.minimized,false);assert.ok(h.packets.some(p=>p.phase==='complete'));h.controller.dispose();
});

test('maximized restore does not overwrite normal bounds and failed focus is harmless',async()=>{
 const h=harness();h.setMaximized(true);h.setFocusFails(true);h.controller.start();const original=h.mainBounds;const fold=h.controller.fold();h.advance(320);await fold;const opening=h.controller.unfold();const prepare=h.packets.findLast(p=>p.phase==='prepare-unfold');h.controller.transitionReady({transitionId:prepare.transitionId});await Promise.resolve();h.advance(320);assert.equal((await opening).folded,false);assert.equal(h.shown,true);assert.equal(h.opacity,1);assert.deepEqual(h.mainBounds,original);assert.equal(h.actions.filter(a=>a[0]==='setBounds').length,0);assert.ok(h.actions.some(a=>a[0]==='maximize'));h.controller.dispose();
});

test('locking during prepare cancels acknowledgement and never restores or focuses later',async()=>{
 const h=harness();h.controller.start();const fold=h.controller.fold();h.advance(320);await fold;const opening=h.controller.unfold();const prepare=h.packets.findLast(p=>p.phase==='prepare-unfold');h.setAuth(false);h.controller.stop();assert.equal(h.controller.transitionReady({transitionId:prepare.transitionId}).accepted,false);h.advance(1000);await opening;assert.equal(h.shown,false);assert.equal(h.opacity,1);assert.equal(h.focused,false);assert.equal(h.timerCount,0);assert.equal(h.intervals,0);h.controller.dispose();
});

test('external Dock show clears folded state and stale shrinking styles after completed folding',async()=>{const h=harness();h.controller.start();const folding=h.controller.fold();h.advance(320);await folding;assert.equal(h.shown,false);h.externalShow();assert.equal(h.shown,true);assert.equal(h.opacity,1);assert.equal(h.packets.findLast(p=>p.channel==='momo:pet-motion').folded,false);assert.ok(h.packets.some(p=>p.phase==='complete'));h.controller.dispose();});


test('reference video remains fixed through sleeping, jumping and turning without a controller playback clock',()=>{
 const h=harness();h.controller.start();const original={...h.bounds};
 for(const elapsed of [33,900,2100,4000,7000,9000,12000,15100,26000,40000,90000]){
  h.advance(elapsed);assert.deepEqual(h.bounds,original);
  const packet=h.packets.at(-1);assert.equal(packet.mode,'video');assert.equal(packet.speed,0);assert.equal(packet.direction,1);
  for(const key of ['currentTime','playbackRate','seek','frame','videoTime'])assert.equal(key in packet,false);
 }
 // Interactions change hit testing/menu state, not video phase or window position.
 h.controller.interaction({hover:true,interactive:true,menu:true});h.advance(9000);assert.deepEqual(h.bounds,original);
 h.controller.interaction({hover:false,interactive:false,menu:false});h.advance(9000);assert.deepEqual(h.bounds,original);assert.equal(h.packets.at(-1).direction,1);
 h.controller.dispose();
});

test('reference video clamps externally dragged bounds without a border-triggered flip or autonomous drift',()=>{
 const h=harness();h.controller.start();h.move({x:1100,y:800,width:260,height:500});h.advance(9000);
 assert.deepEqual(h.bounds,{x:949,y:509,width:260,height:500});assert.equal(h.packets.at(-1).direction,1);
 const right={...h.bounds};for(let i=0;i<100;i++)h.advance(33);assert.deepEqual(h.bounds,right);
 h.move({x:-1600,y:450,width:260,height:500});h.advance(33);assert.deepEqual(h.bounds,{x:-1511,y:450,width:260,height:500});assert.equal(h.packets.at(-1).direction,1);
 h.controller.dispose();
});
