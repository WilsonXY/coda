import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';

export async function editingFixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'coda-edit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const clientFile=join(dir,'client.json'),tokenFile=join(dir,'token.json');
 await writeFile(clientFile,JSON.stringify({web:{client_id:'fixture',client_secret:'fixture'}}),{mode:0o600});
 const scope='https://www.googleapis.com/auth/youtube';
 await writeFile(tokenFile,JSON.stringify({client_id:'fixture',access_token:'fixture',refresh_token:'fixture',scope,requested_scope:scope,expires_at:Date.now()+3600000}),{mode:0o600});
 const state={items:[{itemId:'entry-a',id:'aaaaaaaaaaa'},{itemId:'entry-b',id:'bbbbbbbbbbb'},{itemId:'entry-copy',id:'aaaaaaaaaaa'}],writes:[],fail:false};
 const server=createServer({oauthOptions:{owner:'owner@example.test',clientFile,tokenFile,fetchImpl:async (url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://www.googleapis.com');
  if(options.method!=='GET'){
   state.writes.push({method:options.method,body:options.body?JSON.parse(options.body):null});
   if(state.writes.length===state.holdAt)await state.wait;
   if(state.fail || state.writes.length===state.failAt)throw new Error('upstream-private-secret');
   if(options.method==='DELETE')state.items=state.items.filter(x=>x.itemId!==u.searchParams.get('id'));
   else {
    const b=JSON.parse(options.body),s=b.snippet;
    const entry=options.method==='POST'?{itemId:'inserted-'+state.writes.length,id:s.resourceId.videoId}:state.items.find(x=>x.itemId===b.id);
    assert.ok(entry);assert.equal(entry.id,s.resourceId.videoId);assert.equal(s.playlistId,'PLfixture123');
    state.items=state.items.filter(x=>x!==entry);state.items.splice(s.position,0,entry);
   }
   return options.method==='DELETE'?new Response(null,{status:204}):Response.json({id:'fixture-result'});
  }
  if(u.pathname.endsWith('/playlists'))return Response.json({items:u.searchParams.has('mine')?[{id:'PLfixture123',snippet:{title:'Fixture'}}]:[{id:'PLfixture123',snippet:{title:'Fixture'},status:{privacyStatus:'private'},contentDetails:{itemCount:state.items.length}}]});
  return Response.json({items:state.items.map((x,i)=>({id:x.itemId,contentDetails:{videoId:x.id},snippet:{title:x.id,position:i}}))});
 }}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port;
 const headers={'Tailscale-User-Login':'owner@example.test',Origin:base.replace('http:','https:'),'Content-Type':'application/json'};
 const read=async()=>{await fetch(base+'/api/account/oauth/playlists',{headers});return(await fetch(base+'/api/account/oauth/playlist?id=PLfixture123',{headers})).json();};
 const save=(body,extra={})=>fetch(base+'/api/account/oauth/save',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 const status=async()=> (await fetch(base+'/api/account/oauth/save-status',{headers})).json();
 const wait=async()=>{for(let i=0;i<100;i++){const result=await status();if(result.state!=='running')return result;await new Promise(r=>setTimeout(r,5));}throw new Error('Fixture save did not settle');};
 return {state,read,save,status,wait,tokenFile,scope,headers,base};
}

test('save applies a duplicate-aware draft and verifies the resulting playlist; its ticket cannot run twice',async t=>{
 const f=await editingFixture(t),p=await f.read();
 assert.ok(p.edit?.ticket,'A complete owned Google playlist offers an editing ticket');
 assert.equal(p.items[2].itemId,'entry-copy');
 const desired=[p.items[2],{itemId:null,id:'ccccccccccc'},p.items[1]].map(({itemId,id})=>({itemId,id}));
 const body={id:p.id,ticket:p.edit.ticket,items:desired};
 const response=await f.save(body);assert.equal(response.status,202);assert.equal((await f.wait()).state,'saved');
 assert.deepEqual(f.state.items.map(x=>x.id),desired.map(x=>x.id));assert.equal(f.state.items[0].itemId,'entry-copy');
 const count=f.state.writes.length;assert.ok(count>0);
 assert.equal((await f.save(body)).status,409);assert.equal(f.state.writes.length,count,'Consumed ticket cannot repeat writes');
});

test('stale drafts and malformed edits cannot write, and failed saves cannot be replayed',async t=>{
 const f=await editingFixture(t);
 let p=await f.read(),body={id:p.id,ticket:p.edit.ticket,items:p.items.map(({itemId,id})=>({itemId,id}))};
 f.state.items.reverse();
 let response=await f.save(body);assert.equal(response.status,202);assert.equal((await f.wait()).code,'ACCOUNT_EDIT_CONFLICT');assert.equal(f.state.writes.length,0);
 p=await f.read();body={...body,ticket:p.edit.ticket};
 for(const items of [[{itemId:'entry-a',id:'ccccccccccc'}],[{itemId:null,id:12345678901}],[p.items[0],p.items[0]],Array.from({length:101},()=>({itemId:null,id:'aaaaaaaaaaa'}))])assert.equal((await f.save({...body,items})).status,400);
 assert.equal(f.state.writes.length,0);
 f.state.fail=true;
 body.items=[{itemId:null,id:'ccccccccccc'},...p.items.map(({itemId,id})=>({itemId,id}))];
 response=await f.save(body);assert.equal(response.status,202);const stopped=await f.wait();assert.equal(stopped.state,'unconfirmed');assert.equal(JSON.stringify(stopped).includes('upstream-private-secret'),false);
 assert.equal(f.state.writes.length,1);assert.equal((await f.save(body)).status,409);assert.equal(f.state.writes.length,1);
});

test('removing one entry from a full playlist needs only one Google write',async()=>{
 const {editPlan}=await import('../playlist-edit.mjs');
 const original=Array.from({length:100},(_,i)=>({itemId:'entry-'+i,id:'aaaaaaaaaaa'}));
 assert.deepEqual(editPlan(original,original.slice(1)).map(op=>op.method),['DELETE']);
});

test('only the owner on the HTTPS origin can save a bounded draft with broader permission',async t=>{
 const f=await editingFixture(t),p=await f.read(),body={id:p.id,ticket:p.edit.ticket,items:[]};
 assert.equal((await f.save(body,{'Tailscale-User-Login':'other@example.test'})).status,403);
 assert.equal((await f.save(body,{Origin:'https://attacker.example'})).status,403);
 assert.equal((await f.save(body,{'Content-Type':'text/plain'})).status,400);
 assert.equal((await f.save({...body,ticket:'x'.repeat(40000)})).status,400);
 const token={client_id:'fixture',access_token:'fixture',refresh_token:'fixture',scope:'https://www.googleapis.com/auth/youtube.readonly',expires_at:Date.now()+3600000};
 await writeFile(f.tokenFile,JSON.stringify(token),{mode:0o600});
 assert.equal((await f.save(body)).status,403);assert.equal(f.state.writes.length,0);
 const readonly=await f.read();assert.equal(readonly.edit.canSave,false);assert.equal(readonly.edit.ticket,undefined);
});

test('playlist occurrence IDs are opaque printable strings, including punctuation',async()=>{
 const {editable}=await import('../playlist-edit.mjs');
 assert.equal(editable([{itemId:'opaque.entry=identifier',id:'aaaaaaaaaaa'}]),true);
 assert.equal(editable([{itemId:'entry\nsecret',id:'aaaaaaaaaaa'}]),false);
});

test('moving a song from either end to the other uses a single Google update',async()=>{
 const {editPlan}=await import('../playlist-edit.mjs');
 const original=Array.from({length:12},(_,i)=>({itemId:'entry-'+i,id:'aaaaaaaaaaa'}));
 for(const desired of [[...original.slice(1),original[0]],[original.at(-1),...original.slice(0,-1)]]) {
  const plan=editPlan(original,desired);assert.equal(plan.length,1);assert.equal(plan[0].method,'PUT');
 }
});


test('one accepted save handles more than ten writes and exposes progress without replay',async t=>{
 const f=await editingFixture(t);f.state.items=[];
 const p=await f.read();let release;f.state.wait=new Promise(resolve=>{release=resolve;});f.state.holdAt=2;t.after(()=>release());
 const desired=Array.from({length:12},()=>({itemId:null,id:'aaaaaaaaaaa'}));
 const response=await f.save({id:p.id,ticket:p.edit.ticket,items:desired});assert.equal(response.status,202);
 const accepted=await response.json();assert.equal(accepted.state,'running');
 for(let i=0;i<100 && f.state.writes.length<2;i++)await new Promise(r=>setTimeout(r,5));
 const progress=await f.status();assert.equal(progress.state,'running');assert.equal(progress.completed,1);assert.equal(progress.total,12);assert.equal(progress.id,accepted.id);
 assert.equal((await f.save({id:p.id,ticket:p.edit.ticket,items:desired})).status,409);
 assert.equal((await fetch(f.base+'/api/account/oauth/save-status')).status,403);
 release();let final;
 for(let i=0;i<100;i++){final=await f.status();if(final.state!=='running')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(final.state,'saved');assert.equal(final.completed,12);assert.equal(f.state.items.length,12);assert.equal(f.state.writes.length,12);
 for(const value of ['aaaaaaaaaaa','fixture','Bearer'])assert.equal(JSON.stringify(final).includes(value),false);
});


test('a partial larger save reports acknowledged writes and stops at the first uncertain operation',async t=>{
 const f=await editingFixture(t);f.state.items=[];const p=await f.read();f.state.failAt=4;
 const response=await f.save({id:p.id,ticket:p.edit.ticket,items:Array.from({length:12},()=>({itemId:null,id:'aaaaaaaaaaa'}))});
 assert.equal(response.status,202);const result=await f.wait();
 assert.equal(result.state,'unconfirmed');assert.equal(result.completed,3);assert.equal(result.total,12);assert.equal(f.state.writes.length,4);assert.equal(f.state.items.length,3);
 assert.equal((await f.save({id:p.id,ticket:p.edit.ticket,items:[]})).status,409);assert.equal(f.state.writes.length,4);
});
