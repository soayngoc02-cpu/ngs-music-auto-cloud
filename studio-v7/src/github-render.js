import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {APP_SECRET,getSetting,setSetting,q,newid,audit} from './db.js';
import {auth,requireRole} from './auth.js';

const REPO='soayngoc02-cpu/ngs-music-auto-cloud';
const OWNER='soayngoc02-cpu';
const REPO_NAME='ngs-music-auto-cloud';
const WORKFLOW='render-ngs-v8.yml';
const REF='main';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='ngs-music-render-v8';
const baseUrl=()=>String(process.env.PUBLIC_URL||'https://ngs-music-studio-v7.onrender.com').replace(/\/$/,'');
const htmlEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let cachedInstallationToken=null;
let cachedJwks={at:0,keys:[]};

function stateFor(userId,flow){return jwt.sign({sub:userId,flow},APP_SECRET,{expiresIn:'20m',issuer:'ngs-render-connect'})}
function verifyState(req,flow){const p=jwt.verify(String(req.query.state||''),APP_SECRET,{issuer:'ngs-render-connect'});if(p.flow!==flow||p.sub!==req.user.id)throw new Error('GitHub state không hợp lệ');return p}

async function appJwt(){
  const appId=await getSetting('render_github_app_id');
  const pem=await getSetting('render_github_app_pem');
  if(!appId||!pem)throw new Error('GitHub Render App chưa được tạo');
  const now=Math.floor(Date.now()/1000);
  return jwt.sign({iat:now-60,exp:now+540,iss:String(appId)},pem,{algorithm:'RS256'});
}

async function installationToken(){
  if(cachedInstallationToken&&cachedInstallationToken.expires>Date.now()+5*60*1000)return cachedInstallationToken.token;
  const installationId=await getSetting('render_github_installation_id');
  if(!installationId)throw new Error('GitHub Render App chưa được cài vào repo');
  const r=await fetch(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,{
    method:'POST',
    headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${await appJwt()}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
    body:JSON.stringify({repositories:[REPO_NAME],permissions:{actions:'write',contents:'read'}})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.token)throw new Error(`Không lấy được GitHub installation token: ${data.message||r.status}`);
  cachedInstallationToken={token:data.token,expires:Date.parse(data.expires_at)||Date.now()+50*60*1000};
  return data.token;
}

export async function githubRenderState(){
  const appId=await getSetting('render_github_app_id').catch(()=>''),slug=await getSetting('render_github_app_slug').catch(()=>''),installationId=await getSetting('render_github_installation_id').catch(()=> '');
  return{ready:!!(appId&&installationId),app_ready:!!appId,installed:!!installationId,slug:slug||''};
}

async function dispatchWorkflow(projectId){
  const token=await installationToken();
  const url=`https://api.github.com/repos/${OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW}/dispatches`;
  const r=await fetch(url,{method:'POST',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify({ref:REF,inputs:{project_id:String(projectId),base_url:baseUrl()}})});
  if(r.status!==204){const raw=await r.text();throw new Error(`GitHub Actions ${r.status}: ${raw.slice(0,240)}`)}
  return{ok:true,projectId,workflow:WORKFLOW};
}

export async function dispatchGithubRender(projectId){return dispatchWorkflow(projectId)}
export async function testGithubRender(){await dispatchWorkflow('__healthcheck__');return{ok:true,message:'Đã gửi healthcheck tới GitHub Actions'}}

async function getJwks(){
  if(cachedJwks.keys.length&&Date.now()-cachedJwks.at<60*60*1000)return cachedJwks.keys;
  const r=await fetch(`${OIDC_ISSUER}/.well-known/jwks`);if(!r.ok)throw new Error('Không đọc được GitHub OIDC JWKS');
  const j=await r.json();cachedJwks={at:Date.now(),keys:j.keys||[]};return cachedJwks.keys;
}

async function verifyWorkerToken(token){
  const decoded=jwt.decode(token,{complete:true});const kid=decoded?.header?.kid;if(!kid)throw new Error('OIDC token thiếu kid');
  const jwk=(await getJwks()).find(k=>k.kid===kid);if(!jwk)throw new Error('OIDC signing key không khớp');
  const key=crypto.createPublicKey({key:jwk,format:'jwk'});
  const p=jwt.verify(token,key,{algorithms:['RS256'],issuer:OIDC_ISSUER,audience:OIDC_AUDIENCE});
  if(p.repository!==REPO)throw new Error('OIDC repo không hợp lệ');
  if(p.ref!=='refs/heads/main')throw new Error('OIDC ref không hợp lệ');
  const workflowRef=String(p.workflow_ref||'');
  if(!workflowRef.includes(`${REPO}/.github/workflows/${WORKFLOW}@refs/heads/main`))throw new Error('OIDC workflow không hợp lệ');
  return p;
}

async function workerAuth(req,res,next){
  try{const raw=String(req.headers.authorization||'');if(!raw.startsWith('Bearer '))throw new Error('Thiếu Worker OIDC');req.worker=await verifyWorkerToken(raw.slice(7));next()}catch(e){res.status(401).json({error:String(e.message||e)})}
}

function mimeFor(m){
  const raw=String(m?.mime||'').toLowerCase();if(raw&&raw!=='application/octet-stream')return raw;
  const n=String(m?.name||'').toLowerCase();
  if(n.endsWith('.mp3'))return'audio/mpeg';if(n.endsWith('.wav'))return'audio/wav';if(n.endsWith('.png'))return'image/png';if(n.endsWith('.webp'))return'image/webp';if(n.endsWith('.mp4'))return'video/mp4';return'image/jpeg';
}

export function registerGithubRenderRoutes(app){
  app.get('/api/github-render/status',auth,requireRole('SUPER_ADMIN'),async(_req,res)=>res.json(await githubRenderState()));

  app.get('/api/github-render/connect',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    try{
      const existing=await githubRenderState();
      if(existing.app_ready&&existing.slug&&!existing.installed)return res.redirect(`https://github.com/apps/${encodeURIComponent(existing.slug)}/installations/new`);
      const base=baseUrl(),state=stateFor(req.user.id,'manifest');
      const manifest={
        name:'NGS Music Render Worker soayngoc02',url:base,description:'Private 1080p/2K cloud render worker for NGS Music Studio',
        redirect_url:`${base}/api/github-render/manifest/callback`,setup_url:`${base}/api/github-render/setup`,public:false,
        default_permissions:{actions:'write',contents:'read'},default_events:[]
      };
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>NGS Render Worker</title><body style="font-family:system-ui;background:#0b0f15;color:white;padding:40px"><p>Đang chuyển sang GitHub để tạo Render Worker…</p><form id="f" action="https://github.com/settings/apps/new?state=${encodeURIComponent(state)}" method="post"><input type="hidden" name="manifest" value="${htmlEsc(JSON.stringify(manifest))}"></form><script>document.getElementById('f').submit()</script></body>`);
    }catch(e){res.status(500).send(`Không thể bắt đầu GitHub Render: ${htmlEsc(e.message||e)}`)}
  });

  app.get('/api/github-render/manifest/callback',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    try{
      verifyState(req,'manifest');const code=String(req.query.code||'');if(!code)throw new Error('GitHub không trả manifest code');
      const r=await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,{method:'POST',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
      const data=await r.json();if(!r.ok||!data.id||!data.pem)throw new Error(data.message||`Manifest conversion ${r.status}`);
      await setSetting('render_github_app_id',String(data.id),false);await setSetting('render_github_app_slug',String(data.slug||''),false);await setSetting('render_github_app_pem',String(data.pem),true);
      await audit(req.user.id,'render_github_app_created',String(data.id),{slug:data.slug||''});
      return res.redirect(`https://github.com/apps/${encodeURIComponent(data.slug)}/installations/new`);
    }catch(e){return res.redirect(`${baseUrl()}/?render=error&reason=${encodeURIComponent(String(e.message||e).slice(0,180))}`)}
  });

  app.get('/api/github-render/setup',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    try{const installationId=String(req.query.installation_id||'');if(!installationId)throw new Error('Thiếu installation_id');await setSetting('render_github_installation_id',installationId,false);cachedInstallationToken=null;await installationToken();await audit(req.user.id,'render_github_installed',installationId,{repo:REPO});return res.redirect(`${baseUrl()}/?render=connected`)}catch(e){return res.redirect(`${baseUrl()}/?render=error&reason=${encodeURIComponent(String(e.message||e).slice(0,180))}`)}
  });

  app.post('/api/github-render/test',auth,requireRole('SUPER_ADMIN'),async(_req,res)=>{try{res.json(await testGithubRender())}catch(e){res.status(400).json({error:String(e.message||e)})}});
  app.post('/api/github-render/disconnect',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{for(const [k,s] of [['render_github_installation_id',false],['render_github_app_id',false],['render_github_app_slug',false],['render_github_app_pem',true]])await setSetting(k,'',s);cachedInstallationToken=null;await audit(req.user.id,'render_github_disconnected','github');res.json({ok:true})});

  app.get('/api/worker/job/:id',workerAuth,async(req,res)=>{
    const p=(await q('select id,owner_id,title,duration,plan,music_id,status from projects where id=$1',[req.params.id])).rows[0];
    if(!p)return res.status(404).json({error:'Project không tồn tại'});
    if(!p.plan?.scenes?.length||!p.music_id)return res.status(409).json({error:'Project chưa đủ visual/nhạc'});
    res.json({project:{id:p.id,title:p.title,duration:p.duration,musicId:p.music_id,plan:p.plan},render:{width:1080,height:1920,fps:30,crf:18}});
  });

  app.get('/api/worker/media/:id',workerAuth,async(req,res)=>{
    const m=(await q('select name,mime,data from media where id=$1',[req.params.id])).rows[0];if(!m)return res.status(404).end();
    const data=Buffer.isBuffer(m.data)?m.data:Buffer.from(m.data);res.setHeader('Content-Type',mimeFor(m));res.setHeader('Content-Length',String(data.length));res.setHeader('Cache-Control','private,no-store');res.end(data);
  });

  app.post('/api/worker/progress/:id',workerAuth,async(req,res)=>{
    const progress=Math.max(68,Math.min(99,Number(req.body?.progress)||70)),message=String(req.body?.message||'GitHub Actions đang render').slice(0,240);
    await q('update projects set status=$1,progress=$2,message=$3,error=null,updated_at=now() where id=$4',['rendering',progress,message,req.params.id]);res.json({ok:true});
  });

  app.post('/api/worker/result/:id',workerAuth,express.raw({type:'video/mp4',limit:'120mb'}),async(req,res)=>{
    const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'Project không tồn tại'});
    const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||[]);if(!data.length)return res.status(400).json({error:'Video rỗng'});
    const outId=newid(),name=`${String(p.title||p.id).replace(/[\\/:*?"<>|]+/g,'_').slice(0,100)}-1080p.mp4`;
    await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[outId,p.owner_id,'video',name,'video/mp4',data,{generatedBy:'github-actions',projectId:p.id,width:1080,height:1920,fps:30}]);
    await q('update projects set output_media_id=$1,status=$2,progress=100,message=$3,error=null,updated_at=now() where id=$4',[outId,'done','Video 1080×1920 hoàn thành',p.id]);
    res.json({ok:true,mediaId:outId,size:data.length});
  });

  app.post('/api/worker/failure/:id',workerAuth,async(req,res)=>{const error=String(req.body?.error||'GitHub Actions render lỗi').slice(0,1800);await q('update projects set status=$1,progress=68,message=$2,error=$3,updated_at=now() where id=$4',['waiting_render','Render cloud lỗi — có thể thử lại',error,req.params.id]);res.json({ok:true})});
}
