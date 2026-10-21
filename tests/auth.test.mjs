import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),scrypt=promisify(crypto.scrypt);
const source=await fs.readFile(new URL('../electron/auth.cjs',import.meta.url),'utf8');
const accountLine=/^const ACCOUNT = Object\.freeze\(require\('\.\/unified-account\.local\.cjs'\)\);$/m;
const fixedAccount={username:'test@example.invalid',displayName:'测试工作台',parameters:{N:32768,r:8,p:1,keylen:64}};
assert.match(source,accountLine);

// Test-only account substitution keeps the real six-character credential out of
// source, fixtures, snapshots and output. The production factory has no override.
// All fixture logins still use real scrypt and timingSafeEqual, not a mocked KDF.
async function fixture(t){
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'momo-unified-auth-'));t.after(()=>fs.rm(userData,{recursive:true,force:true}));
 const password=crypto.randomBytes(8).toString('hex').slice(0,6),salt=crypto.randomBytes(32).toString('hex');
 const hash=await scrypt(password,Buffer.from(salt,'hex'),64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const account={...fixedAccount,salt,hash:hash.toString('hex')};let time=Date.UTC(2026,9,21),filesystemAccess=0;
 const module={exports:{}};
 const guardedRequire=id=>{if(!['node:crypto','node:util'].includes(id)){filesystemAccess++;throw Error('Auth must not access filesystem or external services');}return require(id);};
 vm.runInNewContext(source.replace(accountLine,`const ACCOUNT = Object.freeze(${JSON.stringify(account)});`),{module,exports:module.exports,require:guardedRequire,Buffer},{filename:'electron/auth.cjs'});
 const createAuth=module.exports.createAuth,auth=createAuth({userData,now:()=>time});
 return {userData,auth,createAuth,credentials:()=>({username:account.username,password}),advance:ms=>{time+=ms;},now:()=>time,get filesystemAccess(){return filesystemAccess;}};
}

test('unified account never requires setup, uses fixed identity and supports the six-character credential',async t=>{
 const f=await fixture(t);const initial=await f.auth.status();assert.equal(initial.setupRequired,false);assert.equal(initial.accountMode,'unified');assert.equal(initial.authenticated,false);assert.equal(initial.user,null);
 const session=await f.auth.login(f.credentials());assert.equal(session.authenticated,true);assert.equal(session.user.username,fixedAccount.username);assert.equal(session.user.displayName,fixedAccount.displayName);
 assert.equal((await f.auth.status()).accountMode,'unified');assert.equal((await f.auth.status()).setupRequired,false);
 const publicSession=JSON.stringify(f.auth.getSession());assert.equal(publicSession.includes('hash'),false);assert.equal(publicSession.includes('salt'),false);assert.equal(publicSession.includes('parameters'),false);
});

test('wrong email and wrong password have the same generic failure without logging credentials',async t=>{
 const f=await fixture(t);let first,second;
 try{await f.auth.login({...f.credentials(),username:'another@example.invalid'});}catch(e){first=e;}
 try{await f.auth.login({...f.credentials(),password:'invalid-fixture-password'});}catch(e){second=e;}
 assert.equal(first.code,'AUTH_INVALID_CREDENTIALS');assert.equal(second.code,first.code);assert.equal(second.message,first.message);assert.equal(f.auth.getSession().authenticated,false);
 for(const password of [null,{},'', 'x'.repeat(129)])await assert.rejects(f.auth.login({...f.credentials(),password}),e=>['AUTH_INVALID_CREDENTIALS','AUTH_RATE_LIMITED'].includes(e.code));
});

test('logout clears only in-memory session and reopening requires login',async t=>{
 const f=await fixture(t);await f.auth.login(f.credentials());
 const returned=f.auth.getSession();returned.user.displayName='changed-by-caller';assert.equal(f.auth.getSession().user.displayName,fixedAccount.displayName);
 assert.equal(f.auth.logout().authenticated,false);assert.equal(f.auth.getSession().user,null);
 const reopened=f.createAuth({userData:f.userData,now:f.now});assert.equal(reopened.getSession().authenticated,false);assert.equal((await reopened.status()).setupRequired,false);assert.equal((await reopened.login(f.credentials())).authenticated,true);
});

test('registration is disabled and auth creates no account files or directories',async t=>{
 const f=await fixture(t);await assert.rejects(f.auth.register({...f.credentials(),displayName:'ignored'}),{code:'AUTH_REGISTRATION_DISABLED'});
 await f.auth.status();await f.auth.login(f.credentials());f.auth.logout();assert.deepEqual(await fs.readdir(f.userData),[]);assert.equal(f.filesystemAccess,0);
 const missing=path.join(f.userData,'does-not-exist');const other=f.createAuth({userData:missing,now:f.now});await other.status();await other.login(f.credentials());await assert.rejects(fs.stat(missing),{code:'ENOENT'});
});

test('legacy damaged or different local account records never affect unified authentication',async t=>{
 const f=await fixture(t),directory=path.join(f.userData,'auth'),file=path.join(directory,'account.json');await fs.mkdir(directory);
 for(const content of ['{damaged legacy record',JSON.stringify({username:'legacy@example.invalid',hash:'unrelated',displayName:'旧本机账户'})]){
 await fs.writeFile(file,content,{mode:0o600});f.auth.logout();assert.equal((await f.auth.status()).setupRequired,false);assert.equal((await f.auth.login(f.credentials())).authenticated,true);assert.equal(await fs.readFile(file,'utf8'),content);}
 assert.equal(f.filesystemAccess,0);assert.deepEqual(await fs.readdir(directory),['account.json']);
});

test('concurrent failures share process cooldown and successful login after expiry resets attempts',async t=>{
 const f=await fixture(t),other=f.createAuth({userData:path.join(f.userData,'another'),now:f.now});
 const results=await Promise.allSettled(Array.from({length:8},(_,index)=>(index%2?other:f.auth).login({...f.credentials(),password:'wrong-fixture'})));
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='AUTH_INVALID_CREDENTIALS').length,5);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='AUTH_RATE_LIMITED').length,3);
 const blocked=await f.auth.status();assert.equal(blocked.cooldownUntil,new Date(f.now()+30000).toISOString());
 await assert.rejects(other.login(f.credentials()),e=>e.code==='AUTH_RATE_LIMITED'&&e.retryAfterMs===30000);
 f.advance(30001);await assert.rejects(other.login({...f.credentials(),password:'wrong-fixture'}),e=>e.code==='AUTH_INVALID_CREDENTIALS'&&e.retryAfterMs===60000);
 f.advance(60001);assert.equal((await other.login(f.credentials())).authenticated,true);assert.equal((await other.status()).cooldownUntil,null);
 await assert.rejects(other.login({...f.credentials(),password:'wrong-fixture'}),e=>e.code==='AUTH_INVALID_CREDENTIALS'&&!e.retryAfterMs);
 assert.deepEqual(await fs.readdir(f.userData),[]);
});

test('concurrent successful logins are serialized and logout cancels queued and in-flight login',async t=>{
 const f=await fixture(t);const outcomes=await Promise.all([f.auth.login(f.credentials()),f.auth.login(f.credentials())]);assert.ok(outcomes.every(r=>r.authenticated));
 const queued=f.auth.login(f.credentials());f.auth.logout();await assert.rejects(queued,{code:'AUTH_CANCELLED'});assert.equal(f.auth.getSession().authenticated,false);
 const pending=f.auth.login(f.credentials());const rejected=assert.rejects(pending,{code:'AUTH_CANCELLED'});await new Promise(resolve=>setTimeout(resolve,10));f.auth.logout();await rejected;assert.equal(f.auth.getSession().authenticated,false);
 assert.equal((await f.auth.login(f.credentials())).authenticated,true);
});

test('failed repeat login cannot silently sign out an existing valid session',async t=>{
 const f=await fixture(t);await f.auth.login(f.credentials());await assert.rejects(f.auth.login({...f.credentials(),password:'wrong-fixture'}),{code:'AUTH_INVALID_CREDENTIALS'});assert.equal(f.auth.getSession().authenticated,true);
});

// Optional end-to-end hash verification. Root injects the human-provided password
// only into this one test process. Never interpolate it into messages or snapshots.
const realPassword=process.env.MOMO_TEST_UNIFIED_PASSWORD;
test('production fixed-account hash accepts the explicitly injected credential', {skip:!realPassword},async()=>{
 const {createAuth}=require('../electron/auth.cjs');const auth=createAuth();
 let result;try{result=await auth.login({username:fixedAccount.username,password:realPassword});}catch{assert.fail('Fixed credential verification failed; check the configured hash in the main task.');}
 assert.equal(result.authenticated,true);assert.equal(result.user.username,fixedAccount.username);auth.logout();assert.equal(auth.getSession().authenticated,false);
});
