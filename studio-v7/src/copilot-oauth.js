import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {APP_SECRET,getSetting,setSetting,audit} from './db.js';
import {auth,requireRole} from './auth.js';

const ISSUER='ngs-copilot-connect';
const GH_API_VERSION='2026-03-10';
const baseUrl=req=>String(process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
const stateFor=(userId,flow)=>jwt.sign({sub:userId,flow},APP_SECRET,{expiresIn:'15m',issuer:ISSUER});
const verifyState=(req,flow)=>{const p=jwt.verify(String(req.query.state||''),APP_SECRET,{issuer:ISSUER});if(p.flow!==flow||p.sub!==req.user.id)throw new Error('OAuth state không hợp lệ');return p};
const htmlEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function startOAuth(req,res,clientId){
  const base=baseUrl(req),state=stateFor(req.user.id,'oauth');
  const verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  res.cookie('ngs_gh_pkce',verifier,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:15*60*1000});
  const q=new URLSearchParams({client_id:clientId,redirect_uri:`${base}/api/copilot/oauth/callback`,state,code_challenge:challenge,code_challenge_method:'S256'});
  res.redirect(`https://github.com/login/oauth/authorize?${q.toString()}`);
}

async function getGitHubUser(token){const r=await fetch('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':GH_API_VERSION}});if(!r.ok)return null;return r.json()}

export function registerCopilotOAuthRoutes(app){
  app.get('/api/copilot/connect',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    try{
      const clientId=await getSetting('github_app_client_id'),clientSecret=await getSetting('github_app_client_secret');
      if(clientId&&clientSecret)return startOAuth(req,res,clientId);
      const base=baseUrl(req),state=stateFor(req.user.id,'manifest');
      const manifest={name:'NGS Music Studio Copilot',url:base,description:'Private GitHub Copilot connection for NGS Music Studio',redirect_url:`${base}/api/copilot/manifest/callback`,callback_urls:[`${base}/api/copilot/oauth/callback`],public:false,default_permissions:{},default_events:[]};
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Kết nối GitHub</title><body style="font-family:system-ui;background:#0b0f15;color:#fff;padding:40px"><p>Đang chuyển sang GitHub để tạo kết nối Copilot…</p><form id="f" action="https://github.com/settings/apps/new?state=${encodeURIComponent(state)}" method="post"><input type="hidden" name="manifest" value="${htmlEsc(JSON.stringify(manifest))}"></form><script>document.getElementById('f').submit()</script></body>`);
    }catch(e){res.status(500).send(`Không thể bắt đầu GitHub OAuth: ${htmlEsc(e.message||e)}`)}
  });

  app.get('/api/copilot/manifest/callback',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    const base=baseUrl(req);
    try{verifyState(req,'manifest');const code=String(req.query.code||'');if(!code)throw new Error('GitHub không trả manifest code');const r=await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,{method:'POST',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':GH_API_VERSION}});const data=await r.json();if(!r.ok||!data.client_id||!data.client_secret)throw new Error(data.message||`GitHub manifest lỗi ${r.status}`);await setSetting('github_app_client_id',data.client_id,true);await setSetting('github_app_client_secret',data.client_secret,true);await setSetting('github_app_id',String(data.id||''),false);await setSetting('github_app_slug',String(data.slug||''),false);await audit(req.user.id,'github_app_created',String(data.id||''),{slug:data.slug||'',name:data.name||''});return startOAuth(req,res,data.client_id)}catch(e){res.redirect(`${base}/?copilot=error&reason=${encodeURIComponent(String(e.message||e).slice(0,180))}`)}
  });

  app.get('/api/copilot/oauth/callback',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    const base=baseUrl(req);
    try{
      verifyState(req,'oauth');const code=String(req.query.code||''),verifier=String(req.cookies.ngs_gh_pkce||'');if(!code||!verifier)throw new Error('Thiếu OAuth code/PKCE verifier');const clientId=await getSetting('github_app_client_id'),clientSecret=await getSetting('github_app_client_secret');if(!clientId||!clientSecret)throw new Error('GitHub App chưa được cấu hình');
      const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,redirect_uri:`${base}/api/copilot/oauth/callback`,code_verifier:verifier});const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body});const data=await r.json();if(!r.ok||!data.access_token)throw new Error(data.error_description||data.error||`GitHub OAuth lỗi ${r.status}`);
      await setSetting('copilot_token',data.access_token,true);await setSetting('copilot_refresh_token',data.refresh_token||'',true);await setSetting('copilot_token_expires_at',data.expires_in?String(Date.now()+Number(data.expires_in)*1000):'',false);await setSetting('copilot_refresh_expires_at',data.refresh_token_expires_in?String(Date.now()+Number(data.refresh_token_expires_in)*1000):'',false);await setSetting('copilot_status','unknown',false);await setSetting('copilot_last_error','',false);
      const gh=await getGitHubUser(data.access_token);await setSetting('copilot_login',gh?.login||'',false);await audit(req.user.id,'copilot_connected',gh?.login||'github',{githubUserId:gh?.id||null});res.clearCookie('ngs_gh_pkce');res.redirect(`${base}/?copilot=connected`);
    }catch(e){res.clearCookie('ngs_gh_pkce');res.redirect(`${base}/?copilot=error&reason=${encodeURIComponent(String(e.message||e).slice(0,180))}`)}
  });

  app.post('/api/copilot/disconnect',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
    const token=await getSetting('copilot_token'),clientId=await getSetting('github_app_client_id'),clientSecret=await getSetting('github_app_client_secret');if(token&&clientId&&clientSecret){try{await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`,{method:'DELETE',headers:{Accept:'application/vnd.github+json',Authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,'Content-Type':'application/json','X-GitHub-Api-Version':GH_API_VERSION},body:JSON.stringify({access_token:token})})}catch{}}
    for(const [k,secret] of [['copilot_token',true],['copilot_refresh_token',true],['copilot_token_expires_at',false],['copilot_refresh_expires_at',false],['copilot_login',false],['copilot_status',false],['copilot_last_error',false]])await setSetting(k,'',secret);await audit(req.user.id,'copilot_disconnected','github');res.json({ok:true});
  });
}
