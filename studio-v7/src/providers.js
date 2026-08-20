import crypto from 'crypto';
import {getSetting,setSetting,q,newid} from './db.js';

function stripJson(text){const s=String(text||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim(),a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<a)throw new Error('Copilot không trả JSON hợp lệ');return JSON.parse(s.slice(a,b+1))}

async function refreshCopilotToken(){
  const clientId=await getSetting('github_app_client_id'),clientSecret=await getSetting('github_app_client_secret'),refreshToken=await getSetting('copilot_refresh_token');
  if(!clientId||!clientSecret||!refreshToken)throw new Error('Phiên GitHub Copilot đã hết hạn — hãy Kết nối lại GitHub Copilot trong Hệ thống');
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:refreshToken});
  const resp=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body});
  const data=await resp.json();
  if(!resp.ok||!data.access_token)throw new Error(`Không refresh được GitHub Copilot: ${data.error_description||data.error||resp.status}`);
  await setSetting('copilot_token',data.access_token,true);
  if(data.refresh_token)await setSetting('copilot_refresh_token',data.refresh_token,true);
  if(data.expires_in)await setSetting('copilot_token_expires_at',String(Date.now()+Number(data.expires_in)*1000),false);
  else await setSetting('copilot_token_expires_at','',false);
  if(data.refresh_token_expires_in)await setSetting('copilot_refresh_expires_at',String(Date.now()+Number(data.refresh_token_expires_in)*1000),false);
  return data.access_token;
}

export async function getCopilotAccessToken(){
  const token=await getSetting('copilot_token');
  if(!token)throw new Error('Chưa kết nối GitHub Copilot');
  const exp=Number((await getSetting('copilot_token_expires_at'))||0);
  if(!exp||Date.now()<exp-5*60*1000)return token;
  return refreshCopilotToken();
}

export async function copilotPlan(project,recent,music){
  const token=await getCopilotAccessToken();
  const model=(await getSetting('copilot_model'))||'gpt-5.4';
  const {CopilotClient}=await import('@github/copilot-sdk');
  const client=new CopilotClient({gitHubToken:token,useLoggedInUser:false});let session;
  try{
    await client.start();
    session=await client.createSession({model,sessionId:`ngs-${project.id}-${Date.now()}`});
    const prompt=`Bạn là quản đốc NGS Music Studio. Lập kế hoạch video TikTok 9:16 theo nguyên tắc ý tưởng trước, nhạc sau.\nYêu cầu: ${project.idea||'(tự nghĩ nội dung mới)'}\nThời lượng: ${project.duration}s\nChế độ nhạc: ${project.music_mode}\n12 nội dung gần nhất để tránh lặp: ${JSON.stringify(recent)}\nThư viện nhạc: ${JSON.stringify(music)}\nTrả DUY NHẤT JSON thuần: {"title":"...","hook":"...","caption":"...","musicId":"id hoặc null","musicReason":"...","style":"cinematic|emotional|minimal|energetic","scenes":[{"duration":4,"text":"chữ ngắn trên video","imagePrompt":"prompt ảnh tiếng Anh chi tiết, cinematic, subject centered, no text, no watermark","motion":"slow_push|pan_left|pan_right|pull_out","effect":"grain|glow|light_leak|none"}]}\nTạo 3-6 scenes, tổng duration xấp xỉ ${project.duration}s. Không lặp bối cảnh/hook. Nếu music_mode=manual thì musicId=null.`;
    const ev=await session.sendAndWait({prompt},120000);if(!ev)throw new Error('Copilot không phản hồi');return stripJson(ev.data.content);
  }finally{try{if(session)await session.disconnect()}catch{}try{await client.stop()}catch{}}
}

export async function cloudflareImage(prompt){
  const account=await getSetting('cf_account_id'),token=await getSetting('cf_api_token');if(!account||!token)throw new Error('Chưa cấu hình Cloudflare Workers AI');
  const today=new Date().toISOString().slice(0,10),limit=Number((await getSetting('image_daily_limit'))||20),usage=Number((await q("select count(*)::int c from media where kind='image' and meta->>'generatedBy'='cloudflare' and created_at::date=$1::date",[today])).rows[0].c);if(usage>=limit)throw new Error(`Đã chạm giới hạn ảnh hôm nay (${limit})`);
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/black-forest-labs/flux-1-schnell`,resp=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({prompt,steps:4,seed:crypto.randomInt(1,999999999)})});if(!resp.ok)throw new Error(`Cloudflare FLUX lỗi ${resp.status}: ${(await resp.text()).slice(0,300)}`);const ct=resp.headers.get('content-type')||'';
  if(ct.includes('json')){const j=await resp.json(),b64=j?.result?.image||j?.image||j?.result;if(typeof b64!=='string')throw new Error('Cloudflare không trả ảnh');return{buffer:Buffer.from(b64,'base64'),mime:'image/jpeg'}}return{buffer:Buffer.from(await resp.arrayBuffer()),mime:ct.split(';')[0]||'image/jpeg'}
}

export async function saveGeneratedImage(ownerId,projectId,index,prompt){const img=await cloudflareImage(prompt),mid=newid();await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[mid,ownerId,'image',`${projectId}-scene-${index+1}.jpg`,img.mime,img.buffer,{generatedBy:'cloudflare',projectId,prompt,index}]);return mid}
