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
let entries=[{itemId:'entry-a',id:'aaaaaaaaaaa',title:'Google fixture A'},{itemId:'entry-b',id:'bbbbbbbbbbb',title:'Google fixture B'},{itemId:'entry-copy',id:'aaaaaaaaaaa',title:'Google fixture A (copy)'}],writes=0,failWrite=false;
let releaseWrite;const writeGate=new Promise(resolve=>{releaseWrite=resolve;});
const selectedScopes=[];
let releaseProbe,enterProbe;
const probePending=new Promise(resolve=>{releaseProbe=resolve;}),probeEntered=new Promise(resolve=>{enterProbe=resolve;});
const app=createServer({oauthOptions:{owner:'owner@example.test',clientFile,tokenFile,python:'unused',fetchImpl:async(url,options)=>{
  if(url.startsWith('https://www.googleapis.com/youtube/v3/')){
   assert.equal(options.headers.Authorization,'Bearer fixture-access');
   const query=new URL(url);
   if(options.method!=='GET'){
    writes++;if(writes===2)await writeGate;
    if(failWrite)throw new Error('private-write-secret');
    if(options.method==='DELETE')entries=entries.filter(x=>x.itemId!==query.searchParams.get('id'));
    else {
     const body=JSON.parse(options.body),snippet=body.snippet;
     const entry=options.method==='POST'?{itemId:'inserted-'+writes,id:snippet.resourceId.videoId,title:'Search fixture C'}:entries.find(x=>x.itemId===body.id);
     assert.ok(entry);entries=entries.filter(x=>x!==entry);entries.splice(snippet.position,0,entry);
    }
    return options.method==='DELETE'?new Response(null,{status:204}):Response.json({id:'fixture'});
   }
   if(query.pathname.endsWith('/playlists'))return Response.json({items:query.searchParams.has('mine')
    ?[{id:'PLfixture123',snippet:{title:'Google-owned fixture'}}]
    :[{id:'PLfixture123',snippet:{title:'Google-owned fixture'},status:{privacyStatus:'private'},contentDetails:{itemCount:entries.length}}]});
   return Response.json({items:entries.map((x,i)=>({id:x.itemId,contentDetails:{videoId:x.id},snippet:{title:x.title,position:i,videoOwnerChannelTitle:'Fixture channel'}}))});
  }
  calls++; return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',scope:selectedScopes.at(-1),expires_in:3600});
},probe:async()=>{enterProbe();await probePending;const music=selectedScopes.at(-1)==='https://www.googleapis.com/auth/youtube';return {dataApiPrivatePlaylist:true,privatePlaylist:music,expectedOrder:music};}}});
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
  const params=new URL(route.request().url()).searchParams,state=params.get('state');selectedScopes.push(params.get('scope'));
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
 await page.waitForFunction(()=>document.querySelector('#oauth-status').textContent.includes('OAuth comparison'));
 assert.equal((await page.locator('#oauth-status').textContent()).includes('PASS'),false,'Partial Music access cannot display PASS');
 assert.equal(calls,2,'Probe exercises one token renewal');
 const before=await page.locator('audio').evaluate(a=>a.currentTime);
 await page.waitForFunction(before=>document.querySelector('audio').currentTime>before+.25,before);
 assert.equal((await page.locator('body').textContent()).includes('fixture-refresh'),false);
 await page.getByRole('button',{name:'Load my playlists with Google',exact:true}).click({timeout:2000});
 await page.waitForFunction(()=>document.querySelectorAll('#account-playlists li').length===1);
 assert.ok((await page.locator('#account-connection').textContent()).includes('Google OAuth'));
 await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#account-tracks li').length===3);
 assert.ok((await page.locator('#account-playlist-status').textContent()).includes('PRIVATE'));
 assert.equal(await page.getByRole('button',{name:'Play playlist',exact:true}).count(),1);
 assert.equal(await page.locator('audio').evaluate(a=>a.paused),false,'Google browsing preserves current audio');
 for(const width of [390,728]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`artifacts/oauth-owned-${width}.png`,fullPage:true});}
 await page.locator('#oauth-music-permission summary').click();
 assert.ok((await page.locator('#oauth-music-permission').textContent()).includes('Manage your YouTube account'));
 assert.deepEqual(selectedScopes,['https://www.googleapis.com/auth/youtube.readonly'],'No broader request before explicit choice');
 for(const width of [390,728]){
  await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`artifacts/oauth-${width}.png`,fullPage:true});
 }
 await page.locator('#oauth-connect-music').click();
 await page.waitForFunction(()=>document.querySelector('#oauth-status')?.textContent.includes('Authorization saved'));
 await page.locator('#oauth-probe').click();
 await page.waitForFunction(()=>document.querySelector('#oauth-status').textContent.includes('PASS'));
 assert.deepEqual(selectedScopes,['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/youtube']);
 assert.equal(calls,4);
 await page.locator('#account-load-google').click();await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 await page.getByRole('button',{name:'Edit playlist',exact:true}).click({timeout:2000});
 assert.equal(writes,0,'Starting a draft never writes');
 await page.locator('#account-tracks li').nth(2).getByRole('button',{name:'Move up',exact:true}).click();
 await page.locator('#account-tracks li').nth(1).getByRole('button',{name:'Move up',exact:true}).click();
 await page.locator('#account-tracks li').nth(1).getByRole('button',{name:'Remove from playlist',exact:true}).click();
 await page.route('**/api/search?*',route=>route.fulfill({json:{items:[{id:'ccccccccccc',title:'Search fixture C',artists:'Fixture artist'}]}}));
 await page.locator('#edit-query').fill('Fixture');await page.getByRole('button',{name:'Find songs',exact:true}).click();
 await page.getByRole('button',{name:'Add to draft',exact:true}).click();
 await page.locator('#account-tracks li').last().getByRole('button',{name:'Move up',exact:true}).click();
 assert.equal(writes,0,'Reordering, removal and search additions remain local');
 await page.locator('#account-check').click();await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('failed'));
 assert.equal(await page.locator('#edit-search').isVisible(),true,'A failed saved-session check preserves the separate Google draft');
 assert.equal(await page.locator('#account-tracks li').count(),3);
 let testRequests=0,discardPrompts=0;await page.route('**/api/account/playlist-test',async route=>{testRequests++;await route.fulfill({status:503,json:{error:'Synthetic test unavailable'}});});
 page.once('dialog',async dialog=>{discardPrompts++;await dialog.dismiss();});
 await page.locator('#account-test').click();
 assert.equal(discardPrompts,1,'The old one-time test must ask before discarding a dirty draft');
 assert.equal(testRequests,0);assert.equal(await page.locator('#edit-search').isVisible(),true);assert.equal(await page.locator('#account-test').isEnabled(),true);
 for(const width of [390,728]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#account-playlist-title').evaluate(e=>e.scrollIntoView());await page.screenshot({path:`artifacts/playlist-edit-draft-${width}.png`});}
 await page.getByRole('button',{name:'Save to YouTube',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('1 of 3'),null,{timeout:4000});
 assert.equal(await page.locator('#edit-save').isDisabled(),true);
 assert.ok((await page.locator('#edit-status').textContent()).includes('1 of 3'),'Progress stays visible beside Save');
 for(const width of [390,728]){await page.setViewportSize({width,height:1000});await page.locator('#save-status').evaluate(e=>e.scrollIntoView());await page.screenshot({path:`artifacts/playlist-save-progress-${width}.png`});}
 let dropStatus=true;await page.route('**/api/account/oauth/save-status',async route=>{if(dropStatus){dropStatus=false;await route.abort();}else await route.continue();});
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('unavailable'),null,{timeout:4000});
 assert.equal(writes,2);await page.locator('#save-check').click();
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('1 of 3'),null,{timeout:4000});
 await page.reload();await page.locator('#show-account').click();
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('1 of 3'),null,{timeout:4000});
 assert.equal(writes,2,'Reloading monitors the existing save without starting writes again');
 releaseWrite();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Saved to YouTube'),null,{timeout:4000});
 await page.locator('#account-load-google').click();await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 assert.deepEqual(entries.map(x=>x.id),['aaaaaaaaaaa','ccccccccccc','bbbbbbbbbbb']);assert.equal(entries[0].itemId,'entry-copy');
 for(const width of [390,728]){await page.setViewportSize({width,height:1000});await page.locator('#account-playlist-title').evaluate(e=>e.scrollIntoView());await page.screenshot({path:`artifacts/playlist-edit-saved-${width}.png`});}
 await page.getByRole('button',{name:'Edit playlist',exact:true}).click();
 await page.locator('#account-tracks li').last().getByRole('button',{name:'Move up',exact:true}).click();
 await page.route('**/api/account/oauth/playlist?*',route=>route.fulfill({status:503,json:{code:'ACCOUNT_OAUTH_UNAVAILABLE',error:'Synthetic reload failure'}}));
 await page.getByRole('button',{name:'Save to YouTube',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('view could not reload'),null,{timeout:4000});
 assert.ok((await page.locator('#save-status').textContent()).includes('Saved to YouTube'),'A failed UI reload must retain the verified save result');
 await page.unroute('**/api/account/oauth/playlist?*');await page.locator('#edit-reload').click();
 const lastJob=await(await page.request.get(base+'/api/account/oauth/save-status')).json();
 await page.getByRole('button',{name:'Edit playlist',exact:true}).click();await page.locator('#account-tracks li').first().getByRole('button',{name:'Remove from playlist',exact:true}).click();
 await page.evaluate(id=>sessionStorage.setItem('coda-save',id),lastJob.id);
 const recovered=page.waitForResponse(r=>r.url().endsWith('/save-status'));
 await page.locator('#save-check').evaluate(button=>button.click());await recovered;
 await page.waitForFunction(()=>!document.querySelector('#account-load-google').disabled);
 assert.equal(await page.locator('#account-tracks li').count(),2,'Checking an older save cannot discard a newer unsaved draft');
 await page.getByRole('button',{name:'Discard draft',exact:true}).click();
 const savedWrites=writes;
 await page.getByRole('button',{name:'Edit playlist',exact:true}).click();
 await page.locator('#account-tracks li').first().getByRole('button',{name:'Remove from playlist',exact:true}).click();
 await page.getByRole('button',{name:'Discard draft',exact:true}).click();assert.equal(writes,savedWrites);assert.equal(await page.locator('#account-tracks li').count(),3);
 await page.getByRole('button',{name:'Edit playlist',exact:true}).click();await page.locator('#account-tracks li').last().getByRole('button',{name:'Move up',exact:true}).click();
 entries.reverse();
 await page.getByRole('button',{name:'Save to YouTube',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('changed on YouTube'));
 assert.equal(writes,savedWrites);assert.equal(await page.getByRole('button',{name:'Save to YouTube',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Reload playlist',exact:true}).click();
 await page.getByRole('button',{name:'Edit playlist',exact:true}).click();await page.locator('#account-tracks li').last().getByRole('button',{name:'Move up',exact:true}).click();
 failWrite=true;await page.getByRole('button',{name:'Save to YouTube',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('unconfirmed'));
 assert.equal(await page.getByRole('button',{name:'Save to YouTube',exact:true}).isDisabled(),true);assert.equal(writes,savedWrites+1);
 assert.equal((await page.locator('body').textContent()).includes('private-write-secret'),false);

 await page.evaluate(()=>sessionStorage.setItem('coda-save','remembered-save-A'));
 let foreignChecks=0;await page.route('**/api/account/oauth/save-status',route=>route.fulfill({json:{id:'other-save-B',state:++foreignChecks===1?'running':'saved',phase:'saving',completed:1,total:1}}));
 await page.locator('#save-check').evaluate(button=>button.click());
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('previous save result is unavailable')||document.querySelector('#save-status').textContent.includes('Saved to YouTube'),null,{timeout:4000});
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('coda-save')),'remembered-save-A','Recovery must retain the original ID when another tab has a different save');
 assert.ok((await page.locator('#save-status').textContent()).includes('previous save result is unavailable'));
 await page.evaluate(()=>sessionStorage.setItem('coda-save','lost-fixture-save'));
 await page.route('**/api/account/oauth/save-status',route=>route.fulfill({json:{state:'idle'}}));
 const beforeRecovery=writes;await page.reload();await page.locator('#show-account').click();
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('previous save result is unavailable'),null,{timeout:4000});
 assert.equal(writes,beforeRecovery,'Lost server state never resubmits a draft');
 const discoveryPage=await context.newPage();let discoveryChecks=0;
 await discoveryPage.route('**/api/account/oauth/save-status',route=>route.fulfill({json:{id:'discovered-save',state:++discoveryChecks===1?'running':'saved',phase:'saving',completed:1,total:1}}));
 await discoveryPage.goto(base);await discoveryPage.locator('#show-account').click();
 await discoveryPage.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Saved to YouTube'));
 assert.ok(discoveryChecks>=2,'A fresh tab can still discover and monitor an active server save');await discoveryPage.close();
 const storagePage=await context.newPage();await storagePage.goto(base);await storagePage.locator('#show-account').click();
 await storagePage.locator('#account-load-google').click();await storagePage.getByRole('button',{name:'Open playlist',exact:true}).click();
 await storagePage.getByRole('button',{name:'Edit playlist',exact:true}).click();await storagePage.locator('#account-tracks li').first().getByRole('button',{name:'Remove from playlist',exact:true}).click();
 await storagePage.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};});
 await storagePage.route('**/api/account/oauth/save',route=>route.fulfill({status:202,json:{id:'accepted-save-A',state:'running'}}));
 let storageChecks=0;await storagePage.route('**/api/account/oauth/save-status',async route=>{
  storageChecks++;if(storageChecks===1)await route.abort();else await route.fulfill({json:{id:'other-save-B',state:storageChecks===2?'running':'saved',phase:'saving',completed:1,total:1}});
 });
 await storagePage.getByRole('button',{name:'Save to YouTube',exact:true}).click();
 await storagePage.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Save status is unavailable'));
 await storagePage.locator('#save-check').click();
 await storagePage.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('previous save result is unavailable')||document.querySelector('#save-status').textContent.includes('Saved to YouTube'));
 assert.ok((await storagePage.locator('#save-status').textContent()).includes('previous save result is unavailable'),'Accepted save identity must survive storage failure in the same tab');
 await storagePage.close();
 const racePage=await context.newPage();await racePage.goto(base);await racePage.locator('#show-account').click();
 await racePage.locator('#account-load-google').click();await racePage.getByRole('button',{name:'Open playlist',exact:true}).click();
 let enterRecovery,releaseRecovery,enterReload,releaseReload,raceChecks=0;
 const recoveryEntered=new Promise(r=>enterRecovery=r),recoveryGate=new Promise(r=>releaseRecovery=r),reloadEntered=new Promise(r=>enterReload=r),reloadGate=new Promise(r=>releaseReload=r);
 await racePage.route('**/api/account/oauth/save-status',async route=>{
  raceChecks++;if(raceChecks===1){enterRecovery();await recoveryGate;}
  await route.fulfill({json:{id:'stale-save',state:raceChecks===1?'running':'saved',phase:'saving',completed:1,total:1}});
 });
 const recovering=racePage.locator('#save-check').evaluate(button=>button.onclick());await recoveryEntered;
 await racePage.route('**/api/account/oauth/playlist?*',async route=>{enterReload();await reloadGate;await route.continue();});
 await racePage.locator('#edit-reload').click();await reloadEntered;releaseRecovery();await recovering;
 try {assert.equal(await racePage.locator('#account-edit').isDisabled(),true,'Recovery cannot release a pending playlist reload lock');assert.equal(raceChecks,1);}
 finally {releaseReload();}
 await racePage.waitForFunction(()=>!document.querySelector('#account-edit').disabled);await racePage.close();
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/oauth-browser-check.json',JSON.stringify({status:'PASS',source:'HTTPS fixture, simulated Google redirect/token exchange, synthetic scope-dependent read results',browserBoundCallback:true,explicitRenewalProbe:true,audioContinuesDuringProbe:true,partialComparisonNeverPasses:true,broaderScopeOnlyOnExplicitClick:true,permissionExplainedBeforeChoice:true,draftMakesNoWrites:true,duplicateAwareSave:true,discardMakesNoWrites:true,staleConflictStopsBeforeWrites:true,failedSaveCannotResubmit:true,layouts:[390,728],realGoogleAuthorization:'NOT RUN'},null,2)+'\n');
 console.log('PASS: HTTPS OAuth, draft search/add/remove/reorder/save, discard, conflict and uncertain failure; Google simulated.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
