import * as THREE from 'three';
const clamp=value=>Math.max(0,Math.min(1,value));
const gaussian=(x,y,cx,cy,sx,sy)=>Math.exp(-((x-cx)**2/(sx*sx)+(y-cy)**2/(sy*sy))*2);
const smoothstep=value=>{const t=clamp(value);return t*t*(3-2*t);};
export const PHOTO_PET_CROP=Object.freeze({x:47.5,y:37,width:300,height:300,atlasSize:1254});
export const PHOTO_PET_LANDMARKS=Object.freeze({leftEar:{x:.385,y:.30},rightEar:{x:.455,y:.30},head:{x:.36,y:.416},leftEye:{x:.208,y:.377},rightEye:{x:.416,y:.403},nose:{x:.26,y:.45},footBaseline:.965});
export function photoPetBlink(time){const phase=((time%6.7)+6.7)%6.7;return phase>4.7&&phase<4.94?Math.sin((phase-4.7)/.24*Math.PI)**2:0;}
// Spatial Gaussian weights are immutable: calculate them once per vertex, never
// in the animation loop. Pixel identity, crop and the 96 × 112 mesh stay intact.
export function preparePhotoPetPoint(u,v){
 const anchor=1-smoothstep((v-.91)/.055),torso=gaussian(u,v,.47,.70,.22,.21)*anchor;
 let eyeY=0;for(const eye of [PHOTO_PET_LANDMARKS.leftEye,PHOTO_PET_LANDMARKS.rightEye])eyeY+=(v-eye.y)*.92*gaussian(u,v,eye.x,eye.y,eye.x<.3?.014:.026,eye.x<.3?.023:.027);
 const left=gaussian(u,v,.36,.87,.075,.08),right=gaussian(u,v,.49,.88,.075,.075);
 return{u,v,anchor,bodyX:(u-.47)*.0144*torso,bodyY:-.00256*torso,eyeY,nose:gaussian(u,v,.26,.45,.027,.022),earLeft:gaussian(u,v,.366,.15,.065,.16)*smoothstep((.30-v)/.07),earRight:gaussian(u,v,.565,.16,.13,.12)*smoothstep((.30-v)/.07),head:smoothstep((.59-v)/.11)*smoothstep((u-.10)/.08)*smoothstep((.73-u)/.10),strideX:.0028*(left-right)*anchor,strideY:.0018*(left+right)*anchor,paw:.002*gaussian(u,v,.38,.75,.075,.13)};
}
export function createPhotoPetPose({time=0,walk=0,direction=1,greet=0,blink=photoPetBlink(time),reduced=false}={}){
 const earGreeting=greet*Math.sin(time*4.1)*.055;
 return{reduced,breath:Math.sin(time*1.7),blink,noseX:Math.sin(time*2.1)*.0009,noseY:Math.sin(time*3.2)*.00055,earLeft:Math.sin(time*.91+1)*.05+earGreeting,earRight:-(Math.sin(time*.91-1)*.05+earGreeting),head:Math.sin(time*.48)*.022+walk*direction*.009,stride:Math.sin(time*7.3)*clamp(walk),paw:greet*Math.sin(time*4.6)};
}
// Optional output storage lets the renderer update every vertex without making
// thousands of short-lived objects. Pure point API below remains useful in tests.
export function deformPreparedPhotoPetPoint(point,pose,out={}){
 const{u,v}=point;if(pose.reduced||point.anchor===0){out.x=u;out.y=v;return out;}
 let x=u+point.bodyX*pose.breath,y=v+point.bodyY*pose.breath-point.eyeY*pose.blink;
 x+=pose.noseX*point.nose;y+=pose.noseY*point.nose;
 let angle=pose.earLeft*point.earLeft,cos=Math.cos(angle),sin=Math.sin(angle),dx=x-.385,dy=y-.30;
 x=.385+cos*dx-sin*dy;y=.30+sin*dx+cos*dy;
 angle=pose.earRight*point.earRight;cos=Math.cos(angle);sin=Math.sin(angle);dx=x-.455;dy=y-.30;
 x=.455+cos*dx-sin*dy;y=.30+sin*dx+cos*dy;
 angle=pose.head*point.head;cos=Math.cos(angle);sin=Math.sin(angle);dx=x-.43;dy=y-.58;
 x=.43+cos*dx-sin*dy;y=.58+sin*dx+cos*dy;
 x+=pose.stride*point.strideX+pose.paw*point.paw;y+=pose.stride*point.strideY-pose.paw*point.paw;
 out.x=u+(x-u)*point.anchor;out.y=v+(y-v)*point.anchor;return out;
}
// Coordinates use the original, fixed source frame. Feet remain anchored;
// restrained sitting-pose limb changes do not constitute a full walking cycle.
export function deformPhotoPetPoint(u,v,config={}){return deformPreparedPhotoPetPoint(preparePhotoPetPoint(u,v),createPhotoPetPose(config));}
export async function createPhotoPetScene(canvas,{source,onFailure=()=>{}}={}){
 const texture=await new THREE.TextureLoader().loadAsync(source);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;const crop=PHOTO_PET_CROP;texture.repeat.set(crop.width/crop.atlasSize,crop.height/crop.atlasSize);texture.offset.set(crop.x/crop.atlasSize,1-(crop.y+crop.height)/crop.atlasSize);
 let renderer;
 try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch(error){texture.dispose();throw error;}
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.debug.onShaderError=()=>onFailure();
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
 const geometry=new THREE.PlaneGeometry(2,2,96,112),material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}),mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
 const position=geometry.attributes.position,uv=geometry.attributes.uv;position.setUsage(THREE.DynamicDrawUsage);const prepared=Array.from({length:position.count},(_,i)=>preparePhotoPetPoint(uv.getX(i),1-uv.getY(i))),scratch={x:0,y:0};let elapsed=0,walk=0,greeting=0,disposed=false;const state={mode:'idle',speed:0,direction:1,reduced:false};
 function resize(width,height){if(width<1||height<1)return;renderer.setSize(width,height,false);const aspect=width/height;camera.left=-Math.max(1,aspect);camera.right=-camera.left;camera.top=Math.max(1,1/aspect);camera.bottom=-camera.top;camera.updateProjectionMatrix();}
 function setState(next){Object.assign(state,next);}
 function greet(){greeting=1;}
 function render(delta=0){if(disposed)return;const dt=Math.min(.07,Math.max(0,delta));elapsed+=state.reduced?0:dt;walk=state.reduced?0:walk+((state.mode==='walk'?Math.min(1,Math.abs(state.speed||0)/24):0)-walk)*(1-Math.exp(-dt*6));greeting=state.reduced?0:Math.max(0,greeting-dt*.55);
  const pose=createPhotoPetPose({time:elapsed,walk,direction:state.direction||1,greet:greeting,reduced:state.reduced});
  for(let i=0;i<position.count;i++){const p=deformPreparedPhotoPetPoint(prepared[i],pose,scratch);position.setXYZ(i,(p.x-.5)*2,(.5-p.y)*2,0);}position.needsUpdate=true;
  try{renderer.render(scene,camera);}catch{onFailure();}
 }
 const lost=event=>{event.preventDefault();onFailure();};canvas.addEventListener('webglcontextlost',lost);
 return{resize,setState,greet,render,dispose(){if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',lost);geometry.dispose();material.dispose();texture.dispose();renderer.dispose();}};
}
