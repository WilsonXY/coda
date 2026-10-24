import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

const directory=await mkdtemp(join(tmpdir(),'coda-oauth-browser-'));
const clientFile=join(directory,'client.json'),tokenFile=join(directory,'token.json');
let calls=0;
let releaseProbe,enterProbe;
const probePending=new Promise(resolve=>{releaseProbe=resolve;}),probeEntered=new Promise(resolve=>{enterProbe=resolve;});
const app=createServer({oauthOptions:{owner:'owner@example.test',clientFile,tokenFile,python:'unused',fetchImpl:async()=>{
  calls++; return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/youtube.readonly',expires_in:3600});
},probe:async()=>{enterProbe();await probePending;return {dataApiPrivatePlaylist:true,privatePlaylist:true,expectedOrder:true};}}});
execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-noenc','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem')],{stdio:'ignore'});
const server=createHttpsServer({key:await readFile(join(directory,'key.pem')),cert:await readFile(join(directory,'cert.pem'))},(req,res)=>{
 req.headers['tailscale-user-login']='owner@example.test';app.listeners('request')[0](req,res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='https://127.0.0.1:'+server.address().port;
await writeFile(clientFile,JSON.stringify({web:{client_id:'fixture-client',client_secret:'fixture-secret',redirect_uris:[base+'/api/account/oauth/callback']}}),{mode:0o600});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 await mkdir('artifacts',{recursive:true});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}});
 // Google is simulated; no identity header or real request leaves this fixture.
 await context.route('https://accounts.google.com/**',async route=>{
  const state=new URL(route.request().url()).searchParams.get('state');
  await route.fulfill({status:302,headers:{location:base+'/api/account/oauth/callback?state='+state+'&code=fixture-code'}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#show-account').click();assert.equal(calls,0);
 await page.getByRole('button',{name:'Connect Google (read-only)',exact:true}).click({timeout:2000});
 await page.waitForFunction(()=>document.querySelector('#oauth-status')?.textContent.includes('Authorization saved'),null,{timeout:4000});
 assert.equal(new URL(page.url()).search,'','Callback result is removed from page URL');
 assert.equal(calls,1);
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.25);
 await page.locator('#oauth-probe').click();
 await probeEntered;
 const during=await page.locator('audio').evaluate(a=>a.currentTime);
 await page.waitForFunction(before=>document.querySelector('audio').currentTime>before+.25,during);
 assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
 assert.equal(await page.locator('#oauth-status').textContent(),'Checking OAuth…','Audio advances while the probe is still pending');
 releaseProbe();
 await page.waitForFunction(()=>document.querySelector('#oauth-status').textContent.includes('PASS'));
 assert.equal(calls,2,'Probe exercises one token renewal');
 const before=await page.locator('audio').evaluate(a=>a.currentTime);
 await page.waitForFunction(before=>document.querySelector('audio').currentTime>before+.25,before);
 assert.equal((await page.locator('body').textContent()).includes('fixture-refresh'),false);
 for(const width of [390,728]){
  await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`artifacts/oauth-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/oauth-browser-check.json',JSON.stringify({status:'PASS',source:'HTTPS fixture, simulated Google redirect/token exchange, synthetic private-read results',browserBoundCallback:true,explicitRenewalProbe:true,audioContinuesDuringProbe:true,layouts:[390,728],realGoogleAuthorization:'NOT RUN'},null,2)+'\n');
 console.log('PASS: browser-bound HTTPS OAuth redirect and read/renew/read controls; Google and account reads simulated.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
