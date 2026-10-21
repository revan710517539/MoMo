import React,{useEffect,useRef,useState} from 'react';
import {createVideoPetPlayback} from './video-pet-playback.js';
import './animated-pet.css';
const VIDEO=`${import.meta.env.BASE_URL}assets/momo-actions-continuous.webm`;
const POSTER=`${import.meta.env.BASE_URL}assets/momo-actions-poster.png`;
export function AnimatedPet({className='',imageOverride,style,alt='奶油色小兔 Momo',interactive=true,motion='ambient',motionState,onClick,...props}){
 const root=useRef(null),video=useRef(null),playback=useRef(null),suppressClicksUntil=useRef(0),[failed,setFailed]=useState(false),[overrideFailed,setOverrideFailed]=useState(false);
 const color=typeof style==='string'?style:'',inlineStyle=style&&typeof style==='object'?style:{};
 useEffect(()=>{
  setOverrideFailed(false);setFailed(false);
  if(imageOverride)return;
  let alive=true,visible=true;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const player=createVideoPetPlayback(video.current,{onError:()=>{if(alive)setFailed(true);}});
  playback.current=player;
  const sync=()=>player.update({visible,hidden:document.hidden,reduced:preference.matches});
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;sync();});
  observer.observe(root.current);
  document.addEventListener('visibilitychange',sync);
  preference.addEventListener('change',sync);
  // The media clock is never reset by hover, click, state or window movement.
  player.update({visible,hidden:document.hidden,reduced:preference.matches,still:motion==='still'||motion==='none'});
  return()=>{alive=false;observer.disconnect();document.removeEventListener('visibilitychange',sync);preference.removeEventListener('change',sync);player.dispose();if(playback.current===player)playback.current=null;};
 },[imageOverride]);
 useEffect(()=>{playback.current?.update({still:motion==='still'||motion==='none'});},[motion,imageOverride]);
 const retry=event=>{
  if(failed||overrideFailed){event.stopPropagation();suppressClicksUntil.current=Date.now()+500;if(imageOverride)setOverrideFailed(false);else{setFailed(false);playback.current?.retry();}return;}
  if(Date.now()<suppressClicksUntil.current){event.stopPropagation();return;}
  onClick?.(event);
 };
 const error=overrideFailed?'形象未能读取，点兔子重试':failed?'动画未播放，点兔子重试':'';
 return <span {...props} ref={root} role="img" aria-label={error?`${alt}。${error}`:alt} className={`animated-pet ${className} ${color} ${imageOverride?'animated-pet--still':'animated-pet--video'}`} style={inlineStyle} onClick={retry}>
  {!imageOverride&&<video ref={video} className="animated-pet__video" src={VIDEO} poster={POSTER} muted playsInline loop preload="auto" disablePictureInPicture aria-hidden="true" draggable="false"/>}
  {imageOverride&&!overrideFailed&&<img className="animated-pet__still" src={imageOverride} alt="" draggable="false" onError={()=>setOverrideFailed(true)}/>}
  {(overrideFailed||failed)&&<img className="animated-pet__poster" src={POSTER} alt="" draggable="false"/>}
  {error&&<span className="animated-pet__error" role="status" aria-live="polite">{error}</span>}
 </span>;
}
export default AnimatedPet;
