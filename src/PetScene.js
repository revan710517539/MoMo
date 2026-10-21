import * as THREE from 'three';

const smooth=(a,b,t)=>a+(b-a)*(1-Math.exp(-t*7));
export function createPetScene(canvas,{onFailure=()=>{}}={}){
 const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;renderer.debug.onShaderError=()=>onFailure();
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(31,1,.1,50);camera.position.set(0,1.78,6.6);camera.lookAt(0,1.36,0);
 scene.add(new THREE.HemisphereLight(0xfff8ea,0x9baf91,3.3));const key=new THREE.DirectionalLight(0xfff8ed,3.6);key.position.set(-3,5,4);scene.add(key);const rim=new THREE.DirectionalLight(0xe7f2dc,2);rim.position.set(3,3,-2);scene.add(rim);
 const cream=new THREE.MeshPhysicalMaterial({color:0xf6eedc,roughness:.94,metalness:0,sheen:1,sheenColor:new THREE.Color(0xfff6df),sheenRoughness:1});
 // Fine surface variation gives the procedural model a soft felt finish; no external textures.
 cream.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor + (fract(sin(dot(vViewPosition.xy, vec2(12.9898,78.233)))*43758.5453)-0.5)*0.06,0.0,1.0);');};
 const pink=new THREE.MeshStandardMaterial({color:0xe8bdb2,roughness:.94}),green=new THREE.MeshStandardMaterial({color:0x8b9e70,roughness:.95}),dark=new THREE.MeshStandardMaterial({color:0x493c33,roughness:.42}),noseMat=new THREE.MeshStandardMaterial({color:0xbb8a7c,roughness:.8}),white=new THREE.MeshStandardMaterial({color:0xfffdf7,roughness:.5});
 const geometry=new THREE.SphereGeometry(1,32,24);const root=new THREE.Group();scene.add(root);
 function ellipsoid(parent,material,x,y,z,sx,sy,sz){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;}
 const pelvis=new THREE.Group();pelvis.position.y=.56;root.add(pelvis);
 const body=ellipsoid(pelvis,cream,0,.27,0,.56,.63,.43);ellipsoid(pelvis,cream,0,.14,-.43,.2,.21,.2);
 const belly=ellipsoid(pelvis,white,0,.18,.36,.34,.38,.09);
 const hips=[-1,1].map(side=>{const joint=new THREE.Group();joint.position.set(side*.31,-.08,.04);pelvis.add(joint);ellipsoid(joint,cream,0,-.22,.18,.235,.18,.32);return joint;});
 const shoulders=[-1,1].map(side=>{const joint=new THREE.Group();joint.position.set(side*.46,.55,.08);pelvis.add(joint);joint.rotation.z=side*.15;ellipsoid(joint,cream,0,-.23,.01,.145,.32,.15);return joint;});
 const head=new THREE.Group();head.position.set(0,1.42,.025);root.add(head);const headShell=ellipsoid(head,cream,0,0,.02,.63,.55,.48);ellipsoid(head,cream,-.26,-.17,.36,.28,.24,.19);ellipsoid(head,cream,.26,-.17,.36,.28,.24,.19);
 const earShells=[];
 const ears=[-1,1].map(side=>{const joint=new THREE.Group();joint.position.set(side*.28,.38,-.01);head.add(joint);joint.rotation.z=-side*.12;earShells.push(ellipsoid(joint,cream,0,.43,0,.18,.57,.15));ellipsoid(joint,pink,0,.45,.122,.105,.405,.035);return joint;});
 const eyes=[-1,1].map(side=>{const eye=ellipsoid(head,dark,side*.235,.045,.447,.055,.071,.036);ellipsoid(eye,white,-.28,.32,.8,.22,.22,.16);return eye;});
 ellipsoid(head,noseMat,0,-.12,.545,.065,.043,.04);const mouth=new THREE.Group();head.add(mouth);[-1,1].forEach(side=>{const mesh=new THREE.Mesh(new THREE.TorusGeometry(.053,.009,6,18,Math.PI*.65),dark);mesh.position.set(side*.039,-.184,.514);mesh.rotation.z=side===1?Math.PI:Math.PI*.35;mouth.add(mesh);});
 [-1,1].forEach(side=>ellipsoid(head,pink,side*.39,-.125,.421,.107,.046,.02));
 const scarf=ellipsoid(root,green,0,1.035,.025,.48,.115,.385);const scarfTail=ellipsoid(root,green,.25,.85,.36,.115,.3,.055);scarfTail.rotation.z=.19;
 // Small overlapping tufts are part of the model silhouette, rather than a moving flat image.
 for(let i=0;i<18;i++){const theta=i*2.399963;const yy=(i/17-.5)*.8;const xx=Math.cos(theta)*Math.sqrt(Math.max(0,.26-yy*yy))*.98;const zz=Math.sin(theta)*Math.sqrt(Math.max(0,.17-yy*yy*.3));ellipsoid(pelvis,cream,xx,yy+.3,zz,.065,.095,.065);}
 // Procedural short pile: 6,000 low-poly instanced fibres across four joint-bound
 // surfaces. Size-based instance counts keep tiny sidebar pets inexpensive.
 const furGeometry=new THREE.ConeGeometry(.0045,.037,3,1,true);
 const furMaterial=new THREE.MeshStandardMaterial({color:0xf5eddd,roughness:1,metalness:0,side:THREE.DoubleSide});
 const furMeshes=[];
 function addFur(surface,count,seed,face=false){
  const strands=new THREE.InstancedMesh(furGeometry,furMaterial,count);strands.frustumCulled=false;
  const dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3(),position=new THREE.Vector3(),shade=new THREE.Color();
  let randomState=seed;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  for(let i=0;i<count;i++){
   let y,z,x;
   do{y=random()*2-1;const angle=random()*Math.PI*2,r=Math.sqrt(1-y*y);x=r*Math.cos(angle);z=r*Math.sin(angle);}while(face&&z>.78&&Math.abs(x)<.57&&y>-.31&&y<.35);
   normal.set(x,y,z);const length=.65+random()*.65;
   position.copy(normal).multiplyScalar(1+.014*length);
   dummy.position.copy(position);dummy.quaternion.setFromUnitVectors(up,normal);dummy.scale.set(.7+random()*.6,length,.7+random()*.6);dummy.updateMatrix();strands.setMatrixAt(i,dummy.matrix);
   const variation=.89+random()*.11;shade.setRGB(variation,variation*.982,variation*.946);strands.setColorAt(i,shade);
  }
  strands.instanceMatrix.needsUpdate=true;strands.instanceColor.needsUpdate=true;surface.add(strands);furMeshes.push({mesh:strands,max:count});
 }
 addFur(body,2300,174);addFur(headShell,2500,413,true);earShells.forEach((ear,i)=>addFur(ear,600,693+i));
 const shadowGeo=new THREE.PlaneGeometry(2.1,1.15),shadowTexture=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');const g=ctx.createRadialGradient(32,32,2,32,32,31);g.addColorStop(0,'rgba(58,72,46,.2)');g.addColorStop(1,'rgba(58,72,46,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();const shadow=new THREE.Mesh(shadowGeo,new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.025;scene.add(shadow);
 let elapsed=0,walk=0,turn=0,greeting=0,disposed=false;const state={mode:'idle',direction:1,speed:0,reduced:false};
 function resize(width,height){if(width<1||height<1)return;renderer.setSize(width,height,false);const detail=width<110?.24:width<180?.55:1;furMeshes.forEach(item=>{item.mesh.count=Math.max(1,Math.floor(item.max*detail));});camera.aspect=width/height;camera.updateProjectionMatrix();}
 function setState(next){Object.assign(state,next);}
 function greet(){greeting=2.3;}
 function render(delta=0){if(disposed)return;elapsed+=Math.min(delta,.06);const dt=Math.min(delta,.06);walk=state.reduced?0:smooth(walk,state.mode==='walk'?Math.min(1,Math.abs(state.speed||24)/24):0,dt);turn=smooth(turn,walk*state.direction*.68,dt);greeting=state.reduced?0:Math.max(0,greeting-dt);const t=elapsed;
 const breath=state.reduced?0:Math.sin(t*1.8)*.012;body.scale.y=.63+breath+walk*.05;head.position.y=1.42+walk*.07;belly.scale.y=.38+breath*.5;root.rotation.y=turn;pelvis.position.y=.56+walk*.04+breath*.5+Math.abs(Math.sin(t*8))*walk*.035;
 hips.forEach((joint,i)=>{joint.rotation.x=Math.sin(t*8+i*Math.PI)*walk*.45;joint.position.y=-.08+Math.max(0,Math.sin(t*8+i*Math.PI))*walk*.055;});
 shoulders.forEach((joint,i)=>{joint.rotation.x=-Math.sin(t*8+i*Math.PI)*walk*.28;joint.rotation.z=(i?1:-1)*.15+(greeting>0&&i===1?-.75+Math.sin(t*13)*.16:0);});
 const blinkPhase=t%5.4;const blink=state.reduced?1:blinkPhase<.17?Math.max(.08,Math.abs(blinkPhase-.085)/.085):1;eyes.forEach(eye=>eye.scale.y=.071*blink);
 head.rotation.y=state.reduced?0:Math.sin(t*.45)*.09*(1-walk);head.rotation.z=state.reduced?0:Math.sin(t*.63)*.025;
 ears.forEach((ear,i)=>{ear.rotation.z=(i?-.12:.12)+(state.reduced?0:Math.sin(t*1.4+i)*.035)+walk*Math.sin(t*8-i)*.045;ear.rotation.x=walk*.13+(state.reduced?0:Math.sin(t*.76+i)*.025);});
 scarfTail.rotation.x=Math.sin(t*5)*walk*.07;shadow.scale.setScalar(1-walk*.025);try{renderer.render(scene,camera);}catch{onFailure();}
 }
 const lost=event=>{event.preventDefault();onFailure();};canvas.addEventListener('webglcontextlost',lost);
 return{resize,setState,greet,render,dispose(){if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',lost);scene.traverse(object=>{if(object.isMesh){if(object.geometry!==geometry)object.geometry.dispose();}});geometry.dispose();furMaterial.dispose();[cream,pink,green,dark,noseMat,white,shadow.material].forEach(m=>m.dispose());shadowTexture.dispose();renderer.dispose();}};
}
