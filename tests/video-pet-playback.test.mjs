import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVideoPetPlayback} from '../src/video-pet-playback.js';
class Media extends EventTarget{
 constructor(){super();this.calls=[];this.time=6.75;this.playResult=()=>Promise.resolve();}
 get currentTime(){return this.time;}
 set currentTime(value){throw new Error(`reference timeline must not reset: ${value}`);}
 play(){this.calls.push('play');return this.playResult();}
 pause(){this.calls.push('pause');}
 load(){this.calls.push('load');}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('native media keeps original speed and timeline; repeated UI state does not restart playback',async()=>{
 const media=new Media(),player=createVideoPetPlayback(media);
 assert.equal(media.muted,true);assert.equal(media.loop,true);assert.equal(media.playbackRate,1);assert.equal(media.defaultPlaybackRate,1);
 player.update();await settle();player.update({visible:true});player.update({hidden:false});
 assert.deepEqual(media.calls,['play']);assert.equal(media.currentTime,6.75);player.dispose();
});
test('document hidden and offscreen pause; resume continues the same source time',async()=>{
 const media=new Media(),player=createVideoPetPlayback(media);player.update();await settle();
 player.update({hidden:true});assert.equal(media.calls.at(-1),'pause');
 player.update({hidden:false});await settle();assert.equal(media.calls.at(-1),'play');
 player.update({visible:false});assert.equal(media.calls.at(-1),'pause');
 player.update({visible:true});await settle();assert.equal(media.calls.at(-1),'play');assert.equal(media.currentTime,6.75);player.dispose();
});
test('reduced motion and still modes pause until all requested constraints release',async()=>{
 const media=new Media(),player=createVideoPetPlayback(media);player.update({reduced:true});assert.ok(!media.calls.includes('play'));
 player.update({still:true,reduced:false});assert.ok(!media.calls.includes('play'));
 player.update({still:false});await settle();assert.equal(media.calls.at(-1),'play');player.update({reduced:true});assert.equal(media.calls.at(-1),'pause');player.dispose();
});
test('play rejection is visible and retry can recover without falling back to old animation',async()=>{
 const media=new Media(),errors=[];media.playResult=()=>Promise.reject(new Error('decode failed'));
 const player=createVideoPetPlayback(media,{onError:error=>errors.push(error.message)});player.update();await settle();
 assert.deepEqual(errors,['decode failed']);const count=media.calls.filter(x=>x==='play').length;player.update({visible:true});assert.equal(media.calls.filter(x=>x==='play').length,count);
 media.playResult=()=>Promise.resolve();player.retry();await settle();assert.equal(media.calls.at(-2),'load');assert.equal(media.calls.at(-1),'play');assert.equal(media.currentTime,6.75);player.dispose();
});
test('media decode errors are surfaced even when initial load was paused',()=>{
 const media=new Media(),errors=[];const player=createVideoPetPlayback(media,{onError:error=>errors.push(error.message)});player.update({still:true});media.dispatchEvent(new Event('error'));assert.equal(errors.length,1);player.dispose();
});
test('late play rejection after visibility cancellation or unmount does not report false failures',async()=>{
 const media=new Media(),errors=[];let reject;media.playResult=()=>new Promise((_,r)=>{reject=r;});
 const player=createVideoPetPlayback(media,{onError:error=>errors.push(error)});player.update();player.update({hidden:true});reject(new Error('interrupted'));await settle();assert.equal(errors.length,0);
 player.update({hidden:false});player.dispose();reject(new Error('disposed'));await settle();media.dispatchEvent(new Event('error'));assert.equal(errors.length,0);const count=media.calls.length;player.update();player.retry();assert.equal(media.calls.length,count);
});
test('late play completion cannot restart a hidden or disposed pet',async()=>{
 const media=new Media();let resolve;media.playResult=()=>new Promise(r=>{resolve=r;});const player=createVideoPetPlayback(media);player.update();player.dispose();resolve();await settle();assert.equal(media.calls.at(-1),'pause');
});
test('component uses one fixed full-frame video and cleans up when image override changes',async()=>{
 const component=await readFile(new URL('../src/AnimatedPet.jsx',import.meta.url),'utf8');
 const css=await readFile(new URL('../src/animated-pet.css',import.meta.url),'utf8');
 assert.match(component,/assets\/momo-actions-crisp\.webm/);assert.match(component,/assets\/momo-actions-crisp-poster\.png/);
 assert.match(component,/muted playsInline loop/);assert.match(css,/object-fit:contain/);
 assert.match(component,/\},\[imageOverride\]\)/);assert.match(component,/player\.dispose\(\)/);
 assert.doesNotMatch(component,/PhotoPetScene|PetScene|requestAnimationFrame|onPointerEnter|currentTime\s*=/);
 assert.doesNotMatch(component,/<button/);assert.match(component,/event\.stopPropagation\(\)/);
});

test('failed-video retry suppresses click menu while double-click still reaches desktop restore',async()=>{
 const React=await import('react');
 const {transform}=await import('esbuild');
 const source=(await readFile(new URL('../src/AnimatedPet.jsx',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/'");
 const compiled=await transform(source,{loader:'jsx',format:'cjs',target:'es2022'});
 let stateIndex=0,retries=0,explicitDoubles=0,parentRestores=0,parentMenus=0;
 const useRef=value=>({current:value});
 const useState=()=>[stateIndex++===0,value=>{if(value===false)retries++;}];
 const Component=new Function('React','useEffect','useRef','useState','createVideoPetPlayback',`const module={exports:{}};${compiled.code};return module.exports.AnimatedPet;`)(React,()=>{},useRef,useState,()=>{});
 const element=Component({onDoubleClick:()=>explicitDoubles++});
 const event=()=>({stopped:false,stopPropagation(){this.stopped=true;}});
 const click=event();element.props.onClick(click);if(!click.stopped)parentMenus++;
 assert.equal(retries,1);assert.equal(parentMenus,0,'failed media click retries without opening menu');
 const double=event();element.props.onDoubleClick?.(double);if(!double.stopped)parentRestores++;
 assert.equal(explicitDoubles,1,'caller double-click callback is retained');assert.equal(parentRestores,1,'error retry cannot trap access to main window');
 const rapidClick=event();element.props.onClick(rapidClick);assert.equal(rapidClick.stopped,true);
 const rapidDouble=event();element.props.onDoubleClick?.(rapidDouble);if(!rapidDouble.stopped)parentRestores++;
 assert.equal(parentRestores,2,'repeated decode failure cannot extend a double-click lockout');
});
