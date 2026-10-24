import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

const owner='owner@example.test';
const scope='https://www.googleapis.com/auth/youtube.readonly';
test('web OAuth requires owner consent, binds callback to browser/state, saves privately and renews without cookies', async t => {
  const directory=await mkdtemp(join(tmpdir(),'coda-oauth-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const clientFile=join(directory,'client.json'), tokenFile=join(directory,'token.json');
  let base, tokenCalls=0, reads=0;
  const server=createServer({oauthOptions:{owner,clientFile,tokenFile,python:'unused',
    fetchImpl:async(url,options)=>{
      assert.equal(url,'https://oauth2.googleapis.com/token'); tokenCalls++;
      const data=new URLSearchParams(options.body);
      assert.equal(data.get('client_secret'),'fixture-secret');
      if(tokenCalls===1) { assert.equal(data.get('grant_type'),'authorization_code'); assert.ok(data.get('code_verifier')); }
      else assert.equal(data.get('grant_type'),'refresh_token');
      return Response.json({access_token:'fixture-access-'+tokenCalls,...(tokenCalls===1?{refresh_token:'fixture-refresh'}:{}),token_type:'Bearer',scope,expires_in:3600});
    },probe:async token=>{ reads++; assert.ok(token.startsWith('fixture-access-')); return {privatePlaylist:true,expectedOrder:true}; }
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  base='http://127.0.0.1:'+server.address().port;
  const redirect=base.replace('http:','https:')+'/api/account/oauth/callback';
  await writeFile(clientFile,JSON.stringify({web:{client_id:'fixture-client',client_secret:'fixture-secret',redirect_uris:[redirect]}}),{mode:0o600});
  const headers={'Tailscale-User-Login':owner,Origin:base.replace('http:','https:')};
  const endpoint=base+'/api/account/oauth/connect';
  assert.equal((await fetch(endpoint,{method:'POST'})).status,403);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{'Tailscale-User-Login':owner}})).status,403);
  const start=await fetch(endpoint,{method:'POST',headers}); assert.equal(start.status,200);
  const auth=new URL((await start.json()).authorizationUrl);
  assert.equal(auth.origin,'https://accounts.google.com'); assert.equal(auth.searchParams.get('scope'),scope);
  assert.equal(auth.searchParams.get('access_type'),'offline'); assert.equal(auth.searchParams.get('redirect_uri'),redirect);
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  const state=auth.searchParams.get('state'), cookie=start.headers.get('set-cookie').split(';')[0];
  assert.match(start.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  const callback=base+'/api/account/oauth/callback?state='+state+'&code=fixture-code';
  assert.equal((await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'})).status,403);
  assert.equal((await fetch(callback.replace('state='+state,'state=wrong'),{headers:{'Tailscale-User-Login':owner,Cookie:cookie},redirect:'manual'})).status,400);
  assert.equal((await fetch(callback+'&state='+state,{headers:{'Tailscale-User-Login':owner,Cookie:cookie},redirect:'manual'})).status,400);
  assert.equal((await fetch(callback,{headers:{'Tailscale-User-Login':owner},redirect:'manual'})).status,400);
  assert.equal(tokenCalls,0);
  const finish=await fetch(callback,{headers:{'Tailscale-User-Login':owner,Cookie:cookie,'Sec-Fetch-Site':'cross-site'},redirect:'manual'});
  assert.equal(finish.status,303); assert.equal(finish.headers.get('location'),'/?oauth=connected');
  assert.equal(finish.headers.get('referrer-policy'),'no-referrer');
  assert.equal((await stat(tokenFile)).mode&0o777,0o600);
  assert.equal(JSON.parse(await readFile(tokenFile,'utf8')).refresh_token,'fixture-refresh');
  assert.equal((await fetch(callback,{headers:{'Tailscale-User-Login':owner,Cookie:cookie},redirect:'manual'})).status,400);
  const check=await fetch(base+'/api/account/oauth/probe',{method:'POST',headers});
  assert.equal(check.status,200);
  assert.deepEqual(await check.json(),{before:{privatePlaylist:true,expectedOrder:true},renewal:true,after:{privatePlaylist:true,expectedOrder:true}});
  assert.equal(tokenCalls,2); assert.equal(reads,2);
  assert.equal(JSON.parse(await readFile(tokenFile,'utf8')).refresh_token,'fixture-refresh','Renewal preserves the original refresh token when Google omits it');
  assert.equal((await fetch(base+'/api/account/oauth/probe',{method:'POST',headers,body:'{}'})).status,400);
  await chmod(clientFile,0o644);
  const unsafe=await fetch(endpoint,{method:'POST',headers}); assert.equal(unsafe.status,503);
  assert.equal((await unsafe.text()).includes('fixture-secret'),false);
  assert.equal(tokenCalls,2,'Unsafe configuration cannot issue a token request');
});

test('OAuth token errors are fixed, do not save credentials and consume the login attempt', async t => {
  const directory=await mkdtemp(join(tmpdir(),'coda-oauth-failure-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const clientFile=join(directory,'client.json'),tokenFile=join(directory,'token.json');
  let calls=0;
  const server=createServer({oauthOptions:{owner,clientFile,tokenFile,fetchImpl:async()=>{calls++;throw new Error('private-upstream-secret');}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port, origin=base.replace('http:','https:');
  await writeFile(clientFile,JSON.stringify({web:{client_id:'fixture-client',client_secret:'fixture-secret',redirect_uris:[origin+'/api/account/oauth/callback']}}),{mode:0o600});
  const start=await fetch(base+'/api/account/oauth/connect',{method:'POST',headers:{'Tailscale-User-Login':owner,Origin:origin}});
  const state=new URL((await start.json()).authorizationUrl).searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
  const callback=base+'/api/account/oauth/callback?state='+state+'&code=fixture-code';
  const headers={'Tailscale-User-Login':owner,Cookie:cookie};
  const result=await fetch(callback,{headers,redirect:'manual'});
  assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/?oauth=failed');
  assert.equal((await result.text()).includes('private-upstream-secret'),false);
  await assert.rejects(readFile(tokenFile),{code:'ENOENT'});
  assert.equal((await fetch(callback,{headers,redirect:'manual'})).status,400);assert.equal(calls,1);
});
