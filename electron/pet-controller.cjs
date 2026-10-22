'use strict';
const clamp=(value,min,max)=>Math.max(min,Math.min(Math.max(min,max),value));
function clampPetBounds(bounds,area){return {...bounds,x:Math.round(clamp(bounds.x,area.x,area.x+area.width-bounds.width)),y:Math.round(clamp(bounds.y,area.y,area.y+area.height-bounds.height))};}
// Clamp the visible rabbit, not the transparent space reserved above it for menus.
function clampPetPlacement(bounds,area){const safe={...bounds,x:Math.round(clamp(bounds.x,area.x-(bounds.width-189),area.x+area.width-bounds.width+9)),y:Math.round(clamp(bounds.y,area.y-(bounds.height-194),area.y+area.height-bounds.height+9))};if(safe.y<area.y){safe.height=Math.max(194,safe.height-(area.y-safe.y));safe.y=area.y;}return safe;}
function fullPetBounds(bounds){return {...bounds,y:bounds.y+bounds.height-500,height:500};}
function motionAt(elapsed){const phase=((elapsed%26000)+26000)%26000;if(phase<7000||phase>12000)return {mode:'idle',speed:0};const t=(phase-7000)/5000;const fade=Math.min(1,t*6,(1-t)*6);return {mode:'walk',speed:24*Math.max(0,fade)};}
function createPetController({getMainWindow,getPetWindow,screen,isAuthenticated,getPetState,referenceVideo=true,emit=()=>{},now=Date.now,setIntervalFn=setInterval,clearIntervalFn=clearInterval,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,onPlacement=()=>{}}){
 let timer=null,last=0,started=0,direction=-1,hover=false,menu=false,reducedMotion=false,folded=false,savedBounds=null,savedMaximized=false,lastPacket='',restoreListener,showListener,observedMain,dead=false,movementFraction=0,transitionEpoch=0,transition=null,pointerInteractive,restoring=false,docked=false,peek=false,freeBounds=null,placedWindow=null,dragging=null,awaySince=null,pointerHint=null;
 const valid=win=>win&&!win.isDestroyed?.();
 function send(packet){const data={...packet,folded,docked,peek,dragging:Boolean(dragging?.moved)};const key=JSON.stringify(data);if(key===lastPacket)return;lastPacket=key;const pet=getPetWindow();if(valid(pet))pet.webContents?.send('momo:pet-motion',data);emit('momo:pet-motion',data);}
 function mouseMode(interactive){if(interactive===pointerInteractive)return;pointerInteractive=interactive;const pet=getPetWindow();if(valid(pet))pet.setIgnoreMouseEvents?.(!interactive,{forward:true});}
 function validPoint(point){return point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&Math.abs(point.x)<100000&&Math.abs(point.y)<100000;}
 function displayFor(bounds){return screen.getDisplayNearestPoint?.({x:Math.round(bounds.x+bounds.width-99),y:Math.round(bounds.y+bounds.height-95)})||screen.getDisplayMatching(bounds);}
 function persist(){onPlacement({docked,position:freeBounds?{x:freeBounds.x,y:freeBounds.y+freeBounds.height-500}:undefined});}
 function place(){const pet=getPetWindow();if(!valid(pet)||placedWindow===pet)return;placedWindow=pet;const settings=getPetState()||{},bounds=pet.getBounds();if(Number.isFinite(settings.position?.x)&&Number.isFinite(settings.position?.y)){const desired={...bounds,x:settings.position.x,y:settings.position.y};freeBounds=clampPetPlacement(desired,displayFor(desired).workArea);pet.setBounds(freeBounds,false);}else freeBounds={...bounds};docked=settings.docked===true;peek=false;awaySince=null;}
 function dock({docked:next=true}={}){if(dead||!isAuthenticated()||(getPetState()||{}).visible===false||typeof next!=='boolean')return {accepted:false};place();const pet=getPetWindow();if(!valid(pet))return {accepted:false};dragging=null;menu=false;hover=false;if(next&&!docked)freeBounds={...pet.getBounds()};docked=next;peek=false;awaySince=null;pointerHint=null;if(!docked&&freeBounds)pet.setBounds(clampPetPlacement(fullPetBounds(freeBounds),displayFor(fullPetBounds(freeBounds)).workArea),false);mouseMode(false);persist();lastPacket='';tick();return {accepted:true,docked};}
 function drag({phase,point}={}){if(dead||!isAuthenticated()||(getPetState()||{}).visible===false)return {accepted:false};place();const pet=getPetWindow();if(!valid(pet))return {accepted:false};if(phase==='start'){const cursor=validPoint(point)?point:screen.getCursorScreenPoint?.();if(!cursor||dragging)return {accepted:false};dragging={cursor,latest:validPoint(point)?point:null,bounds:pet.getBounds(),started:now(),moved:false};mouseMode(true);return {accepted:true};}if((phase==='move'||phase==='end')&&dragging&&validPoint(point)){dragging.latest={x:point.x,y:point.y};tick();}if(phase==='move')return {accepted:Boolean(dragging),moved:Boolean(dragging?.moved)};if(phase==='end'||phase==='cancel'){const moved=Boolean(dragging?.moved);dragging=null;if(moved){freeBounds={...pet.getBounds()};persist();}mouseMode(hover||menu);lastPacket='';tick();return {accepted:true,moved};}return {accepted:false};}
 function tick(){if(dead)return;const time=now(),dt=last?Math.min(.08,Math.max(0,(time-last)/1000)):0;last=time;const pet=getPetWindow(),settings=getPetState()||{};if(!valid(pet)||!isAuthenticated()||settings.visible===false){dragging=null;send({mode:'idle',direction,speed:0});return;}
   place();const bounds=pet.getBounds(),cursor=screen.getCursorScreenPoint?.();
   if(dragging){if(time-dragging.started>30000){drag({phase:'cancel'});return;}const target=dragging.latest||cursor;if(target){const dx=target.x-dragging.cursor.x,dy=target.y-dragging.cursor.y;if(Math.hypot(dx,dy)>=5)dragging.moved=true;if(dragging.moved){if(docked){docked=false;peek=false;menu=false;}const anchor=fullPetBounds(dragging.bounds);const desired={...anchor,x:anchor.x+dx,y:anchor.y+dy};const area=(screen.getDisplayNearestPoint?.(target)||screen.getDisplayMatching(desired)).workArea;pet.setBounds(clampPetPlacement(desired,area),false);}}send({mode:'idle',direction:1,speed:0});return;}
   const display=displayFor(bounds),area=display.workArea;
   if(docked){const safe=clampPetBounds(fullPetBounds(bounds),area);const next={...safe,y:area.y+area.height-safe.height};if(next.x!==bounds.x||next.y!==bounds.y||next.height!==bounds.height)pet.setBounds(next,false);
     const bottom=area.y+area.height,center=next.x+next.width-99;
     const hint=pointerHint&&time-pointerHint.at<=180?{x:next.x+pointerHint.x,y:next.y+pointerHint.y}:null;
     const points=[cursor,hint].filter(Boolean);
     const near=points.some(p=>Math.abs(p.x-center)<=58&&p.y>=bottom-32&&p.y<=bottom+12);
     const inside=points.some(p=>p.x>=next.x+(menu?0:next.width-205)&&p.x<=next.x+next.width&&p.y>=bottom-(menu?next.height:230)&&p.y<=bottom+12);
     if(near||peek&&inside){peek=true;awaySince=null;}else if(peek){if(awaySince===null)awaySince=time;if(time-awaySince>=300){peek=false;awaySince=null;hover=false;mouseMode(false);}}
     if(!peek)mouseMode(false);send({mode:peek&&!settings.quiet?'video':'idle',direction:1,speed:0});return;
   }
   const safe=referenceVideo&&!menu?clampPetPlacement(bounds,area):clampPetBounds(fullPetBounds(bounds),area);
   // The reference movie owns every hop/turn; dragging moves only the OS window.
   let motion=referenceVideo?{mode:'video',speed:0}:motionAt(time-started);
   if(referenceVideo)direction=1;
   if(hover||menu||reducedMotion||settings.quiet||settings.imageData)motion={mode:'idle',speed:0};
   if(cursor&&Math.hypot(cursor.x-(safe.x+safe.width-93),cursor.y-(safe.y+safe.height-95))<145)motion={mode:'idle',speed:0};
   let x=safe.x+direction*motion.speed*dt;
   if(!referenceVideo&&(x<=area.x||x+safe.width>=area.x+area.width)){direction=x<=area.x?1:-1;x=clamp(x,area.x,area.x+area.width-safe.width);}
   const next={...safe,x:Math.round(x)};
   if(motion.speed){const total=movementFraction+direction*motion.speed*dt;const movement=Math.trunc(total);movementFraction=total-movement;next.x=clamp(Math.round(safe.x)+movement,area.x,area.x+area.width-safe.width);}else movementFraction=0;
   if(next.x!==bounds.x||next.y!==bounds.y||next.height!==bounds.height)pet.setBounds(next,false);send({...motion,direction});
 }
 function safeCall(win,method,...args){try{if(valid(win)&&typeof win[method]==='function'){win[method](...args);return true;}}catch{}return false;}
 function shown(main){return valid(main)&&!main.isMinimized?.()&&(typeof main.isVisible!=='function'||main.isVisible());}
 function complete(){emit('momo:window-transition',{phase:'complete',duration:0});send({mode:'idle',direction,speed:0});}
 function bindMain(){const main=getMainWindow();if(main===observedMain)return;if(observedMain){if(restoreListener)observedMain.removeListener?.('restore',restoreListener);if(showListener)observedMain.removeListener?.('show',showListener);}observedMain=main;restoreListener=()=>{if(restoring)return;cancelTransition();folded=false;safeCall(main,'setOpacity',1);complete();};showListener=()=>{if(transition||dead)return;folded=false;safeCall(main,'setOpacity',1);complete();};if(valid(main)){main.on?.('restore',restoreListener);main.on?.('show',showListener);}}
 function start(){cancelTransition();if(dead||timer!==null)return;started=now();last=0;lastPacket='';bindMain();tick();timer=setIntervalFn(tick,33);timer?.unref?.();}
 function stop(){pointerHint=null;dragging=null;peek=false;menu=false;hover=false;awaySince=null;mouseMode(false);cancelTransition();if(timer!==null)clearIntervalFn(timer);timer=null;last=0;send({mode:'idle',direction,speed:0});}
 function cancelTransition(){const pending=transition;transitionEpoch++;transition=null;if(!pending)return;if(pending.timer!==null)clearTimeoutFn(pending.timer);pending.resolveWait?.(false);pending.resolveWait=null;const main=getMainWindow();if(pending.direction==='unfold'&&pending.wasHidden)safeCall(main,'hide');safeCall(main,'setOpacity',1);folded=!shown(main);complete();}
 function transitionOrigin(main){const bounds=main.getBounds(),pet=getPetWindow();const target=valid(pet)?pet.getBounds():{x:bounds.x+bounds.width,y:bounds.y+bounds.height,width:0,height:0};return{x:Math.round(clamp(target.x+target.width-95-bounds.x,0,bounds.width)),y:Math.round(clamp(target.y+target.height-95-bounds.y,0,bounds.height))};}
 function wait(pending,ms){return new Promise(resolve=>{pending.resolveWait=resolve;pending.timer=setTimeoutFn(()=>{pending.timer=null;pending.resolveWait=null;resolve(true);},ms);});}
 function live(pending,main){return !dead&&transition===pending&&pending.epoch===transitionEpoch&&valid(main)&&isAuthenticated();}
 function finish(pending){if(transition===pending)transition=null;}
 function transitionReady({transitionId}={}){const pending=transition;if(!pending||pending.phase!=='prepare-unfold'||pending.id!==transitionId||!live(pending,getMainWindow()))return {accepted:false};if(pending.timer!==null)clearTimeoutFn(pending.timer);pending.timer=null;pending.ready=true;pending.resolveWait?.(true);pending.resolveWait=null;return {accepted:true};}
 function fold(){
   const main=getMainWindow(),pet=getPetWindow();
   if(dead||!isAuthenticated()||!valid(main))return Promise.resolve({folded:false});
   if(transition?.direction==='fold')return transition.promise;
   if(!valid(pet)||(getPetState()||{}).visible===false)return Promise.reject(Object.assign(Error('Momo 已收起，请先开启桌边陪伴，再收起工作台。'),{code:'PET_UNAVAILABLE'}));
   if(!transition&&folded&&!shown(main))return Promise.resolve({folded:true});
   cancelTransition();bindMain();
   if(!folded){savedBounds={...(main.getNormalBounds?.()||main.getBounds())};savedMaximized=Boolean(main.isMaximized?.());}
   const pending={id:`window:${++transitionEpoch}`,epoch:transitionEpoch,direction:'fold',phase:'fold',timer:null};transition=pending;
   pending.promise=(async()=>{
     folded=true;send({mode:'idle',direction,speed:0});
     if(!reducedMotion){emit('momo:window-transition',{phase:'fold',transitionId:pending.id,origin:transitionOrigin(main),duration:320});await wait(pending,320);}
     if(!live(pending,main)){finish(pending);return {folded};}
     if(!valid(getPetWindow())||(getPetState()||{}).visible===false){folded=false;finish(pending);complete();throw Object.assign(Error('Momo 已收起，工作台保持展开，避免无法恢复。'),{code:'PET_UNAVAILABLE'});}
     // Hide once: native minimize would add a second OS/Dock animation.
     if(!safeCall(main,'hide')){folded=false;finish(pending);complete();return {folded:false};}
     safeCall(main,'setOpacity',1);safeCall(pet,'showInactive');finish(pending);complete();return {folded:true};
   })();return pending.promise;
 }
 function unfold(){
   const main=getMainWindow();if(dead||!isAuthenticated()||!valid(main))return Promise.resolve({folded});
   if(transition?.direction==='unfold')return transition.promise;
   if(!transition&&!folded&&shown(main)){safeCall(main,'focus');return Promise.resolve({folded:false});}
   const wasHidden=!shown(main);cancelTransition();bindMain();
   const pending={id:`window:${++transitionEpoch}`,epoch:transitionEpoch,direction:'unfold',phase:'prepare-unfold',timer:null,ready:false,wasHidden};transition=pending;
   pending.promise=(async()=>{
     safeCall(main,'setOpacity',reducedMotion?1:0);
     if(main.isMinimized?.()){restoring=true;safeCall(main,'restore');restoring=false;}
     if(savedBounds&&!savedMaximized)safeCall(main,'setBounds',savedBounds,false);
     if(savedMaximized)safeCall(main,'maximize');
     if(!safeCall(main,'showInactive'))safeCall(main,'show');
     if(!reducedMotion){
       const preparation=wait(pending,500);
       emit('momo:window-transition',{phase:'prepare-unfold',transitionId:pending.id,origin:transitionOrigin(main),duration:320});
       await preparation;
       if(!live(pending,main)){finish(pending);return {folded};}
       if(pending.ready){pending.phase='unfold';safeCall(main,'setOpacity',1);emit('momo:window-transition',{phase:'unfold',transitionId:pending.id,origin:transitionOrigin(main),duration:320});await wait(pending,320);}
       // A missing renderer acknowledgement falls back to an ordinary full window.
     }
     if(!live(pending,main)){finish(pending);return {folded};}
     safeCall(main,'setOpacity',1);safeCall(main,'show');folded=false;finish(pending);complete();safeCall(main,'focus');return {folded:false};
   })();return pending.promise;
 }
 function interaction(input={}){if(dead||!isAuthenticated()||(getPetState()||{}).visible===false){pointerHint=null;dragging=null;hover=false;menu=false;mouseMode(false);return {accepted:false};}if('pointer' in input){const pet=getPetWindow(),b=valid(pet)?pet.getBounds():null;pointerHint=b&&validPoint(input.pointer)&&input.pointer.x>=0&&input.pointer.y>=0&&input.pointer.x<=b.width&&input.pointer.y<=b.height?{...input.pointer,at:now()}:null;}if(typeof input.hover==='boolean')hover=input.hover;if(typeof input.menu==='boolean')menu=input.menu;if(typeof input.reducedMotion==='boolean')reducedMotion=input.reducedMotion;if(typeof input.interactive==='boolean')mouseMode(dragging?true:docked&&!peek?false:input.interactive);lastPacket='';tick();return {folded,docked,peek,paused:hover||menu||reducedMotion};}
 function dispose(){cancelTransition();stop();dead=true;if(observedMain){if(restoreListener)observedMain.removeListener?.('restore',restoreListener);if(showListener)observedMain.removeListener?.('show',showListener);}observedMain=null;}
 return {start,stop,fold,unfold,transitionReady,interaction,dock,drag,dispose};
}
module.exports={createPetController,clampPetBounds,clampPetPlacement,motionAt};
