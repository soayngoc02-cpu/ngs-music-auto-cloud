import {getSetting,q,newid} from './db.js';
import {planWithFallback as basePlanWithFallback,testCopilotAccess,testPremiumProvider} from './providers-v4.js';

export {testCopilotAccess,testPremiumProvider};

function errText(e){return String(e?.message||e||'Lỗi không xác định')}

const STYLE_MARKER=/\s*\[NGS_VISUAL_STYLE:(realistic|illustration)\]\s*$/i;
function visualStyleFromIdea(idea){const m=String(idea||'').match(STYLE_MARKER);return m?.[1]?.toLowerCase()==='illustration'?'illustration':'realistic'}
function cleanIdea(idea){return String(idea||'').replace(STYLE_MARKER,'').trim()}

function stylePrompt(prompt,style='realistic'){
  const base=String(prompt||'').trim();
  if(style==='illustration'){
    return `Cinematic editorial illustration, emotionally expressive composition, sophisticated contemporary visual storytelling, vertical 9:16. ${base}. No text, no watermark.`.slice(0,3000);
  }
  return `PHOTOREALISTIC REAL-LIFE CINEMATIC PHOTOGRAPH. This must look like a genuine camera photo, NOT artwork. Use real adult Vietnamese or Asian people when people appear; natural human anatomy; believable facial proportions; realistic skin texture and pores; real hair; realistic eyes and hands; natural clothing; physically plausible environment; cinematic but realistic lighting; DSLR/photojournalistic photography; shallow depth of field only when appropriate; contemporary Vietnam/Asian atmosphere when relevant; vertical 9:16. Absolutely NO anime, NO cartoon, NO illustration, NO painting, NO digital art, NO 3D render, NO CGI, NO game art, NO doll-like face, NO comic style, NO vector art. ${base}. No text, no watermark.`.slice(0,3000);
}

export async function planWithFallback(project,recent,music){
  const visualStyle=visualStyleFromIdea(project?.idea);
  const cleanedProject={...project,idea:cleanIdea(project?.idea)};
  const result=await basePlanWithFallback(cleanedProject,recent,music);
  result.plan=result.plan||{};
  result.plan.visualStyle=visualStyle;
  result.plan.scenes=(result.plan.scenes||[]).map(scene=>({...scene,imagePrompt:stylePrompt(scene.imagePrompt,visualStyle)}));
  return result;
}

async function fetchTimed(url,options={},timeoutMs=60000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal})}
  catch(e){if(controller.signal.aborted)throw new Error(`Timeout sau ${Math.round(timeoutMs/1000)} giây`);throw e}
  finally{clearTimeout(timer)}
}

function cloudflareErrorText(raw,status){
  try{
    const j=JSON.parse(raw);
    const msg=j?.errors?.[0]?.message||j?.error||j?.message;
    if(msg)return `Cloudflare FLUX ${status}: ${msg}`;
  }catch{}
  return `Cloudflare FLUX ${status}: ${String(raw||'Lỗi không xác định').slice(0,180)}`;
}

async function cloudflareImage(prompt){
  const account=await getSetting('cf_account_id'),token=await getSetting('cf_api_token');
  if(!account||!token)throw new Error('Chưa cấu hình Cloudflare Workers AI');

  const today=new Date().toISOString().slice(0,10);
  const limit=Number((await getSetting('image_daily_limit'))||20);
  const usage=Number((await q("select count(*)::int c from media where kind='image' and meta->>'generatedBy'='cloudflare' and created_at::date=$1::date",[today])).rows[0].c);
  if(usage>=limit)throw new Error(`Đã chạm giới hạn ảnh hôm nay (${limit})`);

  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const resp=await fetchTimed(url,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({prompt,steps:4})
      },60000);

      if(!resp.ok){
        const raw=await resp.text();
        throw new Error(cloudflareErrorText(raw,resp.status));
      }

      const ct=resp.headers.get('content-type')||'';
      if(ct.includes('json')){
        const j=await resp.json();
        const b64=j?.result?.image||j?.image||(typeof j?.result==='string'?j.result:null);
        if(!b64)throw new Error('Cloudflare FLUX không trả dữ liệu ảnh');
        return{buffer:Buffer.from(b64,'base64'),mime:'image/jpeg',provider:'cloudflare'};
      }
      const buffer=Buffer.from(await resp.arrayBuffer());
      if(!buffer.length)throw new Error('Cloudflare FLUX trả ảnh rỗng');
      return{buffer,mime:ct.split(';')[0]||'image/jpeg',provider:'cloudflare'};
    }catch(e){lastErr=e}
  }
  throw lastErr||new Error('Cloudflare FLUX lỗi');
}

async function geminiImage(prompt){
  const key=await getSetting('gemini_api_key');
  const model=(await getSetting('gemini_image_model'))||'gemini-3.1-flash-image';
  if(!key)throw new Error('Chưa cấu hình Gemini API key');
  const resp=await fetchTimed(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,{
    method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE'],responseFormat:{image:{aspectRatio:'9:16',imageSize:'1K'}}}})
  },70000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(`Gemini Image ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,180)}`);
  const parts=data?.candidates?.[0]?.content?.parts||[];
  const part=parts.find(p=>p.inlineData?.data||p.inline_data?.data),inline=part?.inlineData||part?.inline_data;
  if(!inline?.data)throw new Error('Gemini không trả dữ liệu ảnh');
  return{buffer:Buffer.from(inline.data,'base64'),mime:inline.mimeType||inline.mime_type||'image/png',provider:'gemini'};
}

async function openaiImage(prompt){
  const key=await getSetting('openai_api_key');
  const model=(await getSetting('openai_image_model'))||'gpt-image-1-mini';
  if(!key)throw new Error('Chưa cấu hình OpenAI API key');
  const resp=await fetchTimed('https://api.openai.com/v1/images/generations',{
    method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,prompt,size:'1024x1536',quality:'low'})
  },70000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(`OpenAI Image ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,180)}`);
  const b64=data?.data?.[0]?.b64_json;
  if(!b64)throw new Error('OpenAI không trả dữ liệu ảnh');
  return{buffer:Buffer.from(b64,'base64'),mime:'image/png',provider:'openai'};
}

export async function saveGeneratedImage(ownerId,projectId,index,prompt){
  const errors=[];let img;
  try{img=await cloudflareImage(prompt)}catch(e){errors.push(`Cloudflare: ${errText(e)}`)}

  const premium=String(await getSetting('premium_fallback').catch(()=>''))==='true';
  if(!img&&premium&&await getSetting('gemini_api_key').catch(()=>'')){
    try{img=await geminiImage(prompt)}catch(e){errors.push(`Gemini: ${errText(e)}`)}
  }
  if(!img&&premium&&await getSetting('openai_api_key').catch(()=>'')){
    try{img=await openaiImage(prompt)}catch(e){errors.push(`OpenAI: ${errText(e)}`)}
  }
  if(!img)throw new Error(`Không tạo được ảnh: ${errors.join(' | ')}`);

  const mid=newid(),ext=img.mime.includes('png')?'png':'jpg';
  await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[
    mid,ownerId,'image',`${projectId}-scene-${index+1}.${ext}`,img.mime,img.buffer,{generatedBy:img.provider,projectId,prompt,index}
  ]);
  return{id:mid,provider:img.provider};
}
