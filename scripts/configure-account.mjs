import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {randomBytes,scryptSync} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
const target=new URL('../electron/unified-account.local.cjs',import.meta.url);
if(existsSync(target)){console.error('统一账号配置已存在；为防止意外覆盖，本脚本不会修改。');process.exit(1);}
let muted=false;
const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk);done();}});
const rl=createInterface({input:process.stdin,output,terminal:process.stdin.isTTY});
try{
 const username=(await rl.question('统一登录邮箱：')).trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username))throw Error('邮箱格式无效');
 process.stdout.write('密码（输入不显示）：');muted=true;
 const password=await rl.question('');muted=false;process.stdout.write('\n');
 if(password.length<6||password.length>128)throw Error('密码须为6至128个字符');
 const salt=randomBytes(32).toString('hex'),parameters={N:32768,r:8,p:1,keylen:64};
 const hash=scryptSync(password,Buffer.from(salt,'hex'),64,{...parameters,maxmem:64*1024*1024}).toString('hex');
 writeFileSync(target,"'use strict';\nmodule.exports = "+JSON.stringify({username,displayName:'我的工作台',salt,hash,parameters})+';\n',{mode:0o600,flag:'wx'});
 console.log('统一账号配置已写入本机，已被Git忽略。');
}catch(error){muted=false;console.error(error.message);process.exitCode=1;}finally{rl.close();}
