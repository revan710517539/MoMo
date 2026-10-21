/** Native media owns timing: preserve the reference video's cadence and phase. */
export function createVideoPetPlayback(video,{onError=()=>{},onReady=()=>{}}={}){
 let disposed=false,visible=true,hidden=false,reduced=false,still=false,failed=false,playing=false,attempt=0;
 video.muted=true;
 video.defaultMuted=true;
 video.loop=true;
 video.playbackRate=1;
 video.defaultPlaybackRate=1;
 const shouldPlay=()=>!disposed&&!failed&&visible&&!hidden&&!reduced&&!still;
 const pause=()=>{attempt++;playing=false;video.pause();};
 const sync=()=>{
  if(!shouldPlay()){pause();return;}
  if(playing)return;
  playing=true;
  const token=++attempt;
  let result;
  try{result=video.play();}catch(error){fail(error,token);return;}
  Promise.resolve(result).then(()=>{
   if(disposed||!shouldPlay()){video.pause();return;}
   if(token===attempt)onReady();
  },error=>fail(error,token));
 };
 const fail=(error,token=attempt)=>{
  if(disposed||token!==attempt||!shouldPlay())return;
  // Browser pause/load cancellation is transient; visibility changes already
  // invalidate the attempt. Genuine media/play failures remain explicit.
  failed=true;pause();onError(error);
 };
 const mediaError=()=>{
  if(disposed)return;
  failed=true;pause();onError(video.error||new Error('无法读取宠物动画'));
 };
 const loaded=()=>{if(disposed)return;onReady();sync();};
 video.addEventListener('error',mediaError);
 video.addEventListener('loadeddata',loaded);
 return {
  update(state={}){if(disposed)return;({visible=visible,hidden=hidden,reduced=reduced,still=still}=state);sync();},
  retry(){if(disposed)return;failed=false;playing=false;attempt++;video.load();sync();},
  dispose(){if(disposed)return;disposed=true;pause();video.removeEventListener('error',mediaError);video.removeEventListener('loadeddata',loaded);},
 };
}
