'use strict';
const clamp=(value,min,max)=>Math.max(min,Math.min(Math.max(min,max),value));
function clampPetBounds(bounds,area){return {...bounds,x:Math.round(clamp(bounds.x,area.x,area.x+area.width-bounds.width)),y:Math.round(clamp(bounds.y,area.y,area.y+area.height-bounds.height))};}
function motionAt(elapsed){const phase=((elapsed%26000)+26000)%26000;if(phase<7000||phase>12000)return {mode:'idle',speed:0};const t=(phase-7000)/5000;const fade=Math.min(1,t*6,(1-t)*6);return {mode:'walk',speed:24*Math.max(0,fade)};}
function createPetController({getMainWindow,getPetWindow,screen,isAuthenticated,getPetState,referenceVideo=true,emit=()=>{},now=Date.now,setIntervalFn=setInterval,clearIntervalFn=clearInterval,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}){
 let timer=null,last=0,started=0,direction=-1,hover=false,menu=false,reducedMotion=false,folded=false,savedBounds=null,savedMaximized=false,lastPacket='',restoreListener,showListener,observedMain,dead=false,movementFraction=0,transitionEpoch=0,transition=null,pointerInteractive,restoring=false;
 const valid=win=>win&&!win.isDestroyed?.();
 function send(packet){const data={...packet,folded};const key=JSON.stringify(data);if(key===lastPacket)return;lastPacket=key;const pet=getPetWindow();if(valid(pet))pet.webContents?.send('momo:pet-motion',data);emit('momo:pet-motion',data);}
 function tick(){if(dead)return;const time=now(),dt=last?Math.min(.08,Math.max(0,(time-last)/1000)):0;last=time;const pet=getPetWindow(),settings=getPetState()||{};if(!valid(pet)||!isAuthenticated()||settings.visible===false){send({mode:'idle',direction,speed:0});return;}
   const bounds=pet.getBounds();const display=screen.getDisplayMatching(bounds),area=display.workArea;const safe=clampPetBounds(bounds,area);
   // The reference movie already contains every hop/turn. Never layer desktop
   // wandering or a direction flip on top, and never drive its playback clock.
   let motion=referenceVideo?{mode:'video',speed:0}:motionAt(time-started);
   if(referenceVideo)direction=1;
   if(hover||menu||reducedMotion||settings.quiet||settings.imageData)motion={mode:'idle',speed:0};
   const cursor=screen.getCursorScreenPoint?.();if(cursor&&Math.hypot(cursor.x-(safe.x+safe.width-93),cursor.y-(safe.y+safe.height-95))<145)motion={mode:'idle',speed:0};
   let x=safe.x+direction*motion.speed*dt;
   if(!referenceVideo&&(x<=area.x||x+safe.width>=area.x+area.width)){direction=x<=area.x?1:-1;x=clamp(x,area.x,area.x+area.width-safe.width);}
   const next={...safe,x:Math.round(x)};
   // Keep sub-pixel movement accumulated between OS integer-position updates.
   if(motion.speed){const fraction=direction*motion.speed*dt;const total=movementFraction+fraction;const movement=Math.trunc(total);movementFraction=total-movement;next.x=clamp(Math.round(safe.x)+movement,area.x,area.x+area.width-safe.width);}
   else movementFraction=0;
   if(next.x!==bounds.x||next.y!==bounds.y)pet.setBounds(next,false);
   send({...motion,direction});
 }
 function safeCall(win,method,...args){try{if(valid(win)&&typeof win[method]==='function'){win[method](...args);return true;}}catch{}return false;}
 function shown(main){return valid(main)&&!main.isMinimized?.()&&(typeof main.isVisible!=='function'||main.isVisible());}
 function complete(){emit('momo:window-transition',{phase:'complete',duration:0});send({mode:'idle',direction,speed:0});}
 function bindMain(){const main=getMainWindow();if(main===observedMain)return;if(observedMain){if(restoreListener)observedMain.removeListener?.('restore',restoreListener);if(showListener)observedMain.removeListener?.('show',showListener);}observedMain=main;restoreListener=()=>{if(restoring)return;cancelTransition();folded=false;safeCall(main,'setOpacity',1);complete();};showListener=()=>{if(transition||dead)return;folded=false;safeCall(main,'setOpacity',1);complete();};if(valid(main)){main.on?.('restore',restoreListener);main.on?.('show',showListener);}}
 function start(){cancelTransition();if(dead||timer!==null)return;started=now();last=0;lastPacket='';bindMain();tick();timer=setIntervalFn(tick,33);timer?.unref?.();}
 function stop(){cancelTransition();if(timer!==null)clearIntervalFn(timer);timer=null;last=0;send({mode:'idle',direction,speed:0});}
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
 function interaction(input={}){if(typeof input.interactive==='boolean'&&input.interactive!==pointerInteractive){pointerInteractive=input.interactive;const pet=getPetWindow();if(valid(pet))pet.setIgnoreMouseEvents?.(!pointerInteractive,{forward:true});}if(typeof input.hover==='boolean')hover=input.hover;if(typeof input.menu==='boolean')menu=input.menu;if(typeof input.reducedMotion==='boolean')reducedMotion=input.reducedMotion;lastPacket='';tick();return {folded,paused:hover||menu||reducedMotion};}
 function dispose(){cancelTransition();stop();dead=true;if(observedMain){if(restoreListener)observedMain.removeListener?.('restore',restoreListener);if(showListener)observedMain.removeListener?.('show',showListener);}observedMain=null;}
 return {start,stop,fold,unfold,transitionReady,interaction,dispose};
}
module.exports={createPetController,clampPetBounds,motionAt};
