import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../server.mjs';
const directory=process.env.CODA_MUSIC_DIR;if(!directory)throw new Error('Set CODA_MUSIC_DIR');
let fail=false, hostile=false, releaseFirst;
const firstGate=new Promise(resolve=>releaseFirst=resolve);let holdFirst=true;
const server=createServer({musicDirectory:directory,accountOptions:{owner:'owner@example.test',authFile:'/fixture/private.json',python:'unused',execute:async r=>r.operation==='library'?{items:[{id:'PLfixture123',title:'Fixture playlist'}],limit:50}:{title:'Fixture playlist',privacy:'PRIVATE',total:3,limit:100,items:[{id:'aaaaaaaaaaa',title:hostile?'<img src=x onerror=alert(1)>'+ 'x'.repeat(200):'Private fixture A',artists:'Fixture artist'},{id:'bbbbbbbbbbb',title:'Private fixture B',artists:'Fixture artist'},{id:fail?'ccccccccccc':null,title:'Unavailable fixture',artists:''}]}},liveMusic:async id=>{
 if(fail)throw new Error('synthetic-private-secret');
 if(id==='aaaaaaaaaaa'&&holdFirst){holdFirst=false;await firstGate;}
 const bytes=await readFile(join(directory,`${id==='aaaaaaaaaaa'?'4D7u5KF7SP8':'t0AvpJ74sBc'}.webm`));
 return{bytes:bytes.length,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},extraHTTPHeaders:{'Tailscale-User-Login':'owner@example.test'}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#show-account').click();await page.locator('#account-load').click();await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 await page.locator('#account-tracks li').first().getByRole('button',{name:'Play',exact:true}).click({timeout:2000});
 await page.locator('#account-tracks li').nth(1).getByRole('button',{name:'Play',exact:true}).click();releaseFirst();
 await page.waitForFunction(()=>document.querySelector('#now').textContent==='Private fixture B'&&document.querySelector('audio').currentTime>0.25,null,{timeout:5000});
 await page.locator('#account-tracks li').first().getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.25);
 assert.equal(await page.locator('#now').textContent(),'Private fixture A');
 await page.waitForFunction(()=>document.querySelector('#buffer-status').textContent.includes('Next song ready'),null,{timeout:15000});
 await page.locator('audio').evaluate(a=>a.currentTime=150);await page.waitForFunction(()=>document.querySelector('audio').currentTime>150.25);
 await page.locator('audio').evaluate(a=>{a.pause();a.currentTime=a.duration-0.5;});
 await page.waitForFunction(()=>!document.querySelector('audio').seeking&&document.querySelector('audio').readyState>=3);
 await page.context().setOffline(true);await page.locator('#play').click();
 await page.waitForFunction(()=>document.querySelector('#now').textContent==='Private fixture B'&&document.querySelector('audio').currentTime>0.25);
 await page.context().setOffline(false);
 await page.locator('#account-tracks li').first().getByRole('button',{name:'Add to queue',exact:true}).click();
 await page.locator('#show-player').click();assert.equal(await page.locator('#queue li').count(),3);
 await page.locator('#queue li').last().getByRole('button',{name:'Remove',exact:true}).click();assert.equal(await page.locator('#queue li').count(),2);
 const download=page.waitForEvent('download');await page.locator('#export').click();await(await download).saveAs('artifacts/library-playback-export.json');
 const exported=JSON.parse(await readFile('artifacts/library-playback-export.json','utf8'));assert.equal(exported.audioDelivery,'library');
 const encoded=JSON.stringify(exported);for(const privateValue of['Private fixture A','Private fixture B','aaaaaaaaaaa','bbbbbbbbbbb'])assert.equal(encoded.includes(privateValue),false,'Export must redact private library selections');
 await page.locator('#show-account').click();

 assert.equal(await page.locator('#account-tracks li').last().getByRole('button',{name:'Play',exact:true}).count(),0);
 await page.getByRole('button',{name:'Play playlist',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#now').textContent==='Private fixture A'&&document.querySelector('audio').currentTime>0.25);
 await page.waitForFunction(()=>document.querySelector('#buffer-status').textContent.includes('Next song ready'));
 for(const width of[390,728]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`artifacts/library-playback-${width}.png`,fullPage:true});}
 await page.locator('audio').evaluate(a=>new Promise(resolve=>{if(a.paused)return resolve();a.addEventListener('pause',resolve,{once:true});a.pause();}));
 await page.evaluate(()=>{window.pendingPlays=[];document.querySelector('audio').play=()=>new Promise((resolve,reject)=>window.pendingPlays.push({resolve,reject}));});
 await page.locator('#show-player').click();
 for(const index of[0,1,0])await page.locator('#queue li').nth(index).getByRole('button',{name:'Play',exact:true}).click();
 await page.evaluate(async()=>{window.pendingPlays[2].resolve();window.pendingPlays[1].reject(new DOMException('Synthetic old B','AbortError'));window.pendingPlays[0].reject(new DOMException('Synthetic old A','AbortError'));await Promise.resolve();await Promise.resolve();});
 assert.equal(await page.locator('#now').textContent(),'Private fixture A','An older A attempt cannot overwrite the latest selection of the same queue object');
 await page.reload();await page.locator('#show-account').click();await page.locator('#account-load').click();await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 await page.locator('#account-tracks li').first().getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.25);
 await page.locator('audio').evaluate(a=>new Promise(resolve=>{a.addEventListener('pause',resolve,{once:true});a.pause();}));
 assert.equal(await page.locator('#playback-status').textContent(),'Paused');
 await page.locator('#show-player').click();await page.locator('#reset').click();assert.equal(await page.locator('#playback-status').textContent(),'');
 await page.locator('#queue li').first().getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.25&&document.querySelector('#playback-status').textContent==='Playing');
 await page.locator('#queue li').first().getByRole('button',{name:'Remove',exact:true}).click();assert.equal(await page.locator('#playback-status').textContent(),'');
 hostile=true;await page.reload();await page.locator('#show-account').click();await page.locator('#account-load').click();await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 await page.locator('#account-tracks li').first().getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.25);
 assert.equal(await page.locator('#account-tracks img').count(),0);
 await page.locator('#show-player').click();await page.setViewportSize({width:390,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long track titles fit in the player and queue');
 fail=true;await page.reload();await page.locator('#show-account').click();await page.locator('#account-load').click();await page.getByRole('button',{name:'Open playlist',exact:true}).click();
 await page.locator('#account-tracks li').last().getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#playback-status').textContent.includes('could not be played'));
 assert.equal((await page.locator('body').textContent()).includes('synthetic-private-secret'),false);
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/library-playback-browser-check.json',JSON.stringify({status:'PASS',source:'synthetic private library; prepared audio aliased to arbitrary fixture IDs; not fresh upstream',rowPlay:true,queueAtoBtoARace:true,pauseResetRemovalStatus:true,playlistPlay:true,addAndRemoveQueue:true,seeking:true,bufferedOfflineNextTrack:true,exportRedaction:true,safeFailure:true,literalLongTitles:true,layouts:[390,728],physicalPhone:'NOT RUN'},null,2)+'\n');
 console.log('PASS: playlist/row Play, Add to queue, seeking, offline buffered transition, private export redaction and390/728.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
