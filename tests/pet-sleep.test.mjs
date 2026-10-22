import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import React from 'react';
import {transform} from 'esbuild';
import {createVideoPetPlayback} from '../src/video-pet-playback.js';

test('sleep appearance preserves the original closed-eye source frame byte for byte',async()=>{
 const png=await readFile(new URL('../public/assets/momo-sleep.png',import.meta.url));
 assert.equal(createHash('sha256').update(png).digest('hex'),'c960305d7bbfa16666aa79eea53b13b7e1c48c884aa2a43d2beb6887933c6a2a');
 assert.equal(png.readUInt32BE(16),832);assert.equal(png.readUInt32BE(20),768);
});

test('sleep pauses the existing video and waking resumes its unchanged media time',async()=>{
 const source=(await readFile(new URL('../src/AnimatedPet.jsx',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/'");
 const compiled=await transform(source,{loader:'jsx',format:'cjs',target:'es2022'});
 const refs=[],states=[],effects=[];let cursor=0,pending=[],players=0;
 const useRef=value=>{const i=cursor++;return refs[i]??=( {current:value});};
 const useState=value=>{const i=cursor++;if(!(i in states))states[i]=value;return [states[i],v=>states[i]=v];};
 const useEffect=(effect,deps)=>{const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:effect()};});};
 const Component=new Function('React','useEffect','useRef','useState','createVideoPetPlayback',`const module={exports:{}};${compiled.code};return module.exports.AnimatedPet;`)(React,useEffect,useRef,useState,(...args)=>{players++;return createVideoPetPlayback(...args);});
 class Media extends EventTarget{constructor(){super();this.calls=[];}get currentTime(){return 8.125;}set currentTime(_){throw Error('sleep must preserve media position');}play(){this.calls.push('play');return Promise.resolve();}pause(){this.calls.push('pause');}}
 const media=new Media(),doc=new EventTarget();doc.hidden=false;
 const globals={window:globalThis.window,document:globalThis.document,IntersectionObserver:globalThis.IntersectionObserver};
 globalThis.window={matchMedia:()=>Object.assign(new EventTarget(),{matches:false})};globalThis.document=doc;globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
 const render=sleeping=>{cursor=0;pending=[];const el=Component({sleeping});el.props.ref.current={};const children=React.Children.toArray(el.props.children);const video=children.find(x=>x.type==='video');video.props.ref.current=media;for(const run of pending)run();return el;};
 try{
  render(false);await new Promise(setImmediate);assert.equal(media.calls.at(-1),'play');
  const sleeping=render(true);assert.equal(media.calls.at(-1),'pause');assert.match(sleeping.props['aria-label'],/正在睡觉/);
  assert.ok(React.Children.toArray(sleeping.props.children).some(x=>x.props.className==='animated-pet__sleep'));
  render(false);await new Promise(setImmediate);assert.equal(media.calls.at(-1),'play');assert.equal(players,1);assert.equal(media.currentTime,8.125);
 }finally{for(const effect of effects)effect?.cleanup?.();Object.assign(globalThis,globals);}
});
