import crypto from 'crypto';
import {getSetting,setSetting,q,newid} from './db.js';

function stripJson(text){
  const s=String(text||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a<0||b<a)throw new Error('AI không trả JSON hợp lệ');
  return JSON.parse(s.slice(a,b+1));
}

function planPrompt(project,recent,music){
  return `Bạn là quản đốc NGS Music Studio. Lập kế hoạch video TikTok 9:16 theo nguyên tắc ý tưởng trước, nhạc sau.\nYêu cầu: ${project.idea||'(tự nghĩ nội dung mới)'}\nThời lượng: ${project.duration}s\nChế độ nhạc: ${project.music_mode}\n12 nội dung gần nhất để tránh lặp: ${JSON.stringify(recent)}\nThư viện nhạc: ${JSON.stringify(music)}\nTrả DUY NHẤT JSON thuần: {"title":"...","hook":"...","caption":"...","musicId":"id hoặc null","musicReason":"...","style":"cinematic|emotional|minimal|energetic","scenes":[{"duration":4,"text":"chữ ngắn trên video","imagePrompt":"prompt ảnh tiếng Anh chi tiết, cinematic, subject centered, no text, no watermark","motion":"slow_push|pan_left|pan_right|pull_out","effect":"grain|glow|light_leak|none"}]}\nTạo 3-6 scenes, tổng duration xấp xỉ ${project.duration}s. Không lặp bối cảnh/hook. Nếu music_mode=manual thì musicId=null.`;
}

function errText(e){return String(e?.message||e||'Lỗi không xác định')}
function isPolicyError(e){const s=errText(e).toLowerCase();return s.includes('not authorized to use this copilot feature')||s.includes('enterprise or organization policy')||s.includes('access denied by copilot policy')||s.includes('unauthorized: not authorized to use this copilot feature')}
async function markCopilot(status,error=''){await setSetting('copilot_status',status,false).catch(()=>{});await setSetting('copilot_last_error',error,false).catch(()=>{})}

async function refreshCopilotToken(){
  const clientId=await getSetting('github_app_client_id'),clientSecret=await getSetting('github_app_client_secret'),refreshToken=await getSetting('copilot_refresh_token');
  if(!clientId||!clientSecret||!refreshToken)throw new Error('Phiên GitHub Copilot đã hết hạn — hãy Kết nối lại GitHub Copilot trong Hệ thống');
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:refreshToken});
  const resp=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body});
  const data=await resp.json();
  if(!resp.ok||!data.access_token)throw new Error(`Không refresh được GitHub Copilot: ${data.error_description||data.error||resp.status}`);
  await setSetting('copilot_token',data.access_token,true);
  if(data.refresh_token)await setSetting('copilot_refresh_token',data.refresh_token,true);
  if(data.expires_in)await setSetting('copilot_token_expires_at',String(Date.now()+Number(data.expires_in)*1000),false);else await setSetting('copilot_token_expires_at','',false);
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

export async function testCopilotAccess(){
  const token=await getCopilotAccessToken(),{CopilotClient}=await import('@github/copilot-sdk'),client=new CopilotClient({gitHubToken:token,useLoggedInUser:false});
  try{
    await client.start();
    const models=await client.listModels();
    await markCopilot('ok','');
    return{ok:true,count:Array.isArray(models)?models.length:0,models:(Array.isArray(models)?models:[]).slice(0,12).map(x=>x.id||x.name||x.model||'').filter(Boolean)};
  }catch(e){
    await markCopilot(isPolicyError(e)?'blocked':'error',errText(e));
    throw e;
  }finally{try{await client.stop()}catch{}}
}

export async function copilotPlan(project,recent,music){
  const token=await getCopilotAccessToken(),model=(await getSetting('copilot_model'))||'gpt-5.4',{CopilotClient}=await import('@github/copilot-sdk'),client=new CopilotClient({gitHubToken:token,useLoggedInUser:false});let session;
  try{
    await client.start();
    session=await client.createSession({model,sessionId:`ngs-${project.id}-${Date.now()}`});
    const ev=await session.sendAndWait({prompt:planPrompt(project,recent,music)},120000);
    if(!ev)throw new Error('Copilot không phản hồi');
    await markCopilot('ok','');
    return stripJson(ev.data.content);
  }catch(e){
    await markCopilot(isPolicyError(e)?'blocked':'error',errText(e));
    throw e;
  }finally{try{if(session)await session.disconnect()}catch{}try{await client.stop()}catch{}}
}

async function cloudflarePlan(project,recent,music){
  const account=await getSetting('cf_account_id'),token=await getSetting('cf_api_token');
  if(!account||!token)throw new Error('Chưa cấu hình Cloudflare Workers AI');
  const model=(await getSetting('cf_text_model'))||'@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`;
  const resp=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:'You are the creative director and production planner for NGS Music Studio. Return only valid JSON, never markdown.'},{role:'user',content:planPrompt(project,recent,music)}],max_tokens:2400,temperature:0.65})});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok||data?.success===false)throw new Error(`Cloudflare Text lỗi ${resp.status}: ${data?.errors?.[0]?.message||data?.error||JSON.stringify(data).slice(0,300)}`);
  const text=data?.result?.response||data?.response||data?.result?.text||'';
  return stripJson(text);
}

async function geminiPlan(project,recent,music){
  const key=await getSetting('gemini_api_key'),model=(await getSetting('gemini_text_model'))||'gemini-3.7-flash';if(!key)throw new Error('Chưa cấu hình Gemini API key');
  const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:planPrompt(project,recent,music)}]}],generationConfig:{responseMimeType:'application/json'}})});
  const data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(`Gemini lỗi ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,300)}`);const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';return stripJson(text);
}

async function openaiPlan(project,recent,music){
  const key=await getSetting('openai_api_key'),model=(await getSetting('openai_text_model'))||'gpt-5.6-luna';if(!key)throw new Error('Chưa cấu hình OpenAI API key');
  const resp=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:planPrompt(project,recent,music)}],response_format:{type:'json_object'}})});
  const data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(`OpenAI lỗi ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,300)}`);return stripJson(data?.choices?.[0]?.message?.content||'');
}

export async function planWithFallback(project,recent,music){
  const errors=[];
  const hasCopilot=!!(await getSetting('copilot_token').catch(()=>''));
  const copilotStatus=(await getSetting('copilot_status').catch(()=>''))||'unknown';
  if(hasCopilot&&copilotStatus!=='blocked'){
    try{return{plan:await copilotPlan(project,recent,music),provider:'copilot'}}catch(e){errors.push(`Copilot: ${errText(e)}`)}
  }else if(copilotStatus==='blocked')errors.push('Copilot: GitHub policy đang chặn SDK');
  else errors.push('Copilot: chưa kết nối');

  const cfAccount=await getSetting('cf_account_id').catch(()=>''),cfToken=await getSetting('cf_api_token').catch(()=> '');
  if(cfAccount&&cfToken){
    try{return{plan:await cloudflarePlan(project,recent,music),provider:'cloudflare'}}catch(e){errors.push(`Cloudflare Text: ${errText(e)}`)}
  }

  const premium=String(await getSetting('premium_fallback').catch(()=>''))==='true';
  if(!premium)throw new Error(`${errors.join(' | ')}. Premium fallback đang TẮT.`);
  if(await getSetting('gemini_api_key').catch(()=>'')){try{return{plan:await geminiPlan(project,recent,music),provider:'gemini'}}catch(e){errors.push(`Gemini: ${errText(e)}`)}}
  if(await getSetting('openai_api_key').catch(()=>'')){try{return{plan:await openaiPlan(project,recent,music),provider:'openai'}}catch(e){errors.push(`OpenAI: ${errText(e)}`)}}
  throw new Error(`${errors.join(' | ')}. Không còn AI planner khả dụng.`);
}

export async function cloudflareImage(prompt){
  const account=await getSetting('cf_account_id'),token=await getSetting('cf_api_token');if(!account||!token)throw new Error('Chưa cấu hình Cloudflare Workers AI');
  const today=new Date().toISOString().slice(0,10),limit=Number((await getSetting('image_daily_limit'))||20),usage=Number((await q("select count(*)::int c from media where kind='image' and meta->>'generatedBy'='cloudflare' and created_at::date=$1::date",[today])).rows[0].c);if(usage>=limit)throw new Error(`Đã chạm giới hạn ảnh hôm nay (${limit})`);
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/black-forest-labs/flux-1-schnell`,resp=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({prompt,steps:4,seed:crypto.randomInt(1,999999999)})});if(!resp.ok)throw new Error(`Cloudflare FLUX lỗi ${resp.status}: ${(await resp.text()).slice(0,300)}`);const ct=resp.headers.get('content-type')||'';
  if(ct.includes('json')){const j=await resp.json(),b64=j?.result?.image||j?.image||j?.result;if(typeof b64!=='string')throw new Error('Cloudflare không trả ảnh');return{buffer:Buffer.from(b64,'base64'),mime:'image/jpeg',provider:'cloudflare'}}return{buffer:Buffer.from(await resp.arrayBuffer()),mime:ct.split(';')[0]||'image/jpeg',provider:'cloudflare'};
}

async function geminiImage(prompt){
  const key=await getSetting('gemini_api_key'),model=(await getSetting('gemini_image_model'))||'gemini-3.1-flash-image';if(!key)throw new Error('Chưa cấu hình Gemini API key');
  const resp=await fetch(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE'],responseFormat:{image:{aspectRatio:'9:16',imageSize:'1K'}}}})});
  const data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(`Gemini Image lỗi ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,300)}`);const parts=data?.candidates?.[0]?.content?.parts||[],part=parts.find(p=>p.inlineData?.data||p.inline_data?.data),inline=part?.inlineData||part?.inline_data;if(!inline?.data)throw new Error('Gemini không trả dữ liệu ảnh');return{buffer:Buffer.from(inline.data,'base64'),mime:inline.mimeType||inline.mime_type||'image/png',provider:'gemini'};
}

async function openaiImage(prompt){
  const key=await getSetting('openai_api_key'),model=(await getSetting('openai_image_model'))||'gpt-image-1-mini';if(!key)throw new Error('Chưa cấu hình OpenAI API key');
  const resp=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,prompt,size:'1024x1536',quality:'low'})});const data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(`OpenAI Image lỗi ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,300)}`);const b64=data?.data?.[0]?.b64_json;if(!b64)throw new Error('OpenAI không trả dữ liệu ảnh');return{buffer:Buffer.from(b64,'base64'),mime:'image/png',provider:'openai'};
}

export async function saveGeneratedImage(ownerId,projectId,index,prompt){
  const errors=[];let img;
  try{img=await cloudflareImage(prompt)}catch(e){
    errors.push(errText(e));
    const premium=String(await getSetting('premium_fallback').catch(()=>''))==='true';
    if(!premium)throw e;
    if(await getSetting('gemini_api_key').catch(()=>'')){try{img=await geminiImage(prompt)}catch(x){errors.push(errText(x))}}
    if(!img&&await getSetting('openai_api_key').catch(()=>'')){try{img=await openaiImage(prompt)}catch(x){errors.push(errText(x))}}
    if(!img)throw new Error(`Không tạo được ảnh: ${errors.join(' | ')}`);
  }
  const mid=newid(),ext=img.mime.includes('png')?'png':'jpg';
  await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[mid,ownerId,'image',`${projectId}-scene-${index+1}.${ext}`,img.mime,img.buffer,{generatedBy:img.provider,projectId,prompt,index}]);
  return{id:mid,provider:img.provider};
}

export async function testPremiumProvider(provider){
  if(provider==='gemini'){
    const key=await getSetting('gemini_api_key');if(!key)throw new Error('Chưa lưu Gemini API key');
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key}});if(!r.ok)throw new Error(`Gemini key lỗi ${r.status}: ${(await r.text()).slice(0,220)}`);return{ok:true};
  }
  if(provider==='openai'){
    const key=await getSetting('openai_api_key');if(!key)throw new Error('Chưa lưu OpenAI API key');
    const r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${key}`}});if(!r.ok)throw new Error(`OpenAI key lỗi ${r.status}: ${(await r.text()).slice(0,220)}`);return{ok:true};
  }
  throw new Error('Provider không hợp lệ');
}
