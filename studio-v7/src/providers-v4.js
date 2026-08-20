import crypto from 'crypto';
import {getSetting,setSetting,q,newid} from './db.js';

const CF_TEXT_MODELS=['@cf/meta/llama-3.1-8b-instruct-fast','@cf/meta/llama-3.2-3b-instruct'];

function errText(e){
  if(e?.name==='AbortError'||e?.name==='TimeoutError')return 'quá thời gian chờ';
  return String(e?.message||e||'Lỗi không xác định');
}

async function fetchTimed(url,options={},timeoutMs=25000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal})}
  catch(e){if(controller.signal.aborted)throw new Error(`Timeout sau ${Math.round(timeoutMs/1000)} giây`);throw e}
  finally{clearTimeout(timer)}
}

function stripJson(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  const raw=String(value||'').trim();
  if(!raw)throw new Error('AI không trả dữ liệu kế hoạch');
  try{const direct=JSON.parse(raw);if(direct&&typeof direct==='object')return direct}catch{}
  const s=raw.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
  try{const direct=JSON.parse(s);if(direct&&typeof direct==='object')return direct}catch{}
  const starts=[];for(let i=0;i<s.length;i++)if(s[i]==='{')starts.push(i);
  for(const a of starts){let depth=0,inString=false,esc=false;for(let i=a;i<s.length;i++){const ch=s[i];if(inString){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')inString=false;continue}if(ch==='"'){inString=true;continue}if(ch==='{')depth++;else if(ch==='}'){depth--;if(depth===0){try{return JSON.parse(s.slice(a,i+1))}catch{}break}}}}
  throw new Error(`AI không trả JSON hợp lệ: ${s.slice(0,120)}`);
}

function safeStyle(v){return ['cinematic','emotional','minimal','energetic'].includes(v)?v:'cinematic'}
function safeMotion(v){return ['slow_push','pan_left','pan_right','pull_out'].includes(v)?v:'slow_push'}
function safeEffect(v){return ['grain','glow','light_leak','none'].includes(v)?v:'none'}

function normalizePlan(input,project){
  const p=stripJson(input);
  const rawScenes=Array.isArray(p.scenes)?p.scenes:[];
  const fallbackTopic=String(project.idea||p.title||'một khoảnh khắc cảm xúc trong tình yêu').slice(0,500);
  const scenes=rawScenes.slice(0,6).map((s,i)=>({
    duration:Math.max(1,Number(s?.duration)||Math.max(3,Math.round(Number(project.duration||20)/Math.max(3,rawScenes.length||4)))),
    text:String(s?.text||'').slice(0,160),
    imagePrompt:String(s?.imagePrompt||s?.image_prompt||`cinematic emotional music visual about ${fallbackTopic}, scene ${i+1}, vertical 9:16, realistic photography, no text, no watermark`).slice(0,1800),
    motion:safeMotion(s?.motion),effect:safeEffect(s?.effect)
  }));
  while(scenes.length<3){const i=scenes.length;scenes.push({duration:Math.max(3,Math.round(Number(project.duration||20)/4)),text:'',imagePrompt:`cinematic emotional music visual about ${fallbackTopic}, distinct scene ${i+1}, vertical 9:16, realistic photography, soft cinematic light, no text, no watermark`,motion:['slow_push','pan_left','pull_out'][i%3],effect:['grain','glow','light_leak'][i%3]})}
  return {
    title:String(p.title||project.idea||'Video mới').slice(0,140),
    hook:String(p.hook||'').slice(0,220),
    caption:String(p.caption||'').slice(0,1200),
    musicId:p.musicId==null?null:String(p.musicId),
    musicReason:String(p.musicReason||''),
    style:safeStyle(p.style),
    scenes
  };
}

function planPrompt(project,recent,music){
  const compactRecent=(recent||[]).slice(0,12).map(x=>({title:x.title,idea:x.idea}));
  const compactMusic=(music||[]).slice(0,50).map(x=>({id:x.id,name:x.name,meta:x.meta||{}}));
  return `Bạn là Creative Director của NGS Music Studio. Hãy tạo kế hoạch video TikTok dọc 9:16 theo nguyên tắc Ý TƯỞNG TRƯỚC, NHẠC SAU.
Yêu cầu người dùng: ${project.idea||'(tự nghĩ một concept mới, giàu cảm xúc, không lặp nội dung gần đây)'}
Thời lượng: ${project.duration||20} giây.
Chế độ nhạc: ${project.music_mode||'auto'}.
Nội dung gần đây cần tránh lặp: ${JSON.stringify(compactRecent)}
Thư viện nhạc: ${JSON.stringify(compactMusic)}

Chỉ trả về MỘT JSON object hợp lệ, không markdown, không giải thích. Cấu trúc bắt buộc:
{"title":"...","hook":"...","caption":"...","musicId":null,"musicReason":"...","style":"cinematic","scenes":[{"duration":5,"text":"text ngắn","imagePrompt":"English cinematic image prompt, vertical 9:16, no text, no watermark","motion":"slow_push","effect":"grain"}]}

Quy tắc: 3-5 scenes; mỗi scene khác bối cảnh; tổng duration xấp xỉ ${project.duration||20}; motion chỉ slow_push|pan_left|pan_right|pull_out; effect chỉ grain|glow|light_leak|none; style chỉ cinematic|emotional|minimal|energetic. Nếu music_mode=manual thì musicId=null. Nếu auto, chỉ chọn musicId có thật trong thư viện; không chắc thì null.`;
}

function emergencyPlan(project,music){
  const ideas=[
    'một người đi ngang nơi cũ và nhận ra ký ức vẫn ở lại',
    'hai người cùng nhìn một thành phố nhưng đã ở hai cuộc đời khác nhau',
    'một tin nhắn chưa từng gửi trở thành điều cuối cùng còn giữ lại',
    'một buổi chiều bình thường bỗng nhắc nhớ một người không còn bên cạnh',
    'cảm giác bình yên khi cuối cùng học được cách buông một người từng rất thương'
  ];
  const topic=String(project.idea||ideas[Math.floor(Math.random()*ideas.length)]).slice(0,500);
  const duration=Number(project.duration||20),count=4,each=Math.max(3,Math.round(duration/count));
  const settings=['rainy city window at blue hour','quiet riverside at sunset','empty cafe table near a window','night street with soft neon reflections'];
  const texts=['Có những điều chỉ khi đi qua rồi...','mình mới biết đã từng thật lòng đến mức nào.','','Rồi một ngày, ký ức cũng học cách dịu lại.'];
  const scenes=settings.map((setting,i)=>({duration:each,text:texts[i],imagePrompt:`Cinematic emotional realistic photography illustrating: ${topic}. ${setting}. Vietnamese/Asian contemporary atmosphere, one adult subject when appropriate, elegant composition, soft natural light, vertical 9:16, no text, no watermark`,motion:['slow_push','pan_left','pan_right','pull_out'][i],effect:['grain','glow','light_leak','none'][i]}));
  return {title:project.idea?String(project.idea).slice(0,100):'Điều còn lại sau một người',hook:texts[0],caption:'Có những cảm xúc không cần gọi tên, chỉ cần một bài nhạc là đủ nhớ.',musicId:project.music_mode==='auto'?(music?.[0]?.id||null):null,musicReason:'Fallback an toàn khi AI planner tạm thời không phản hồi.',style:'emotional',scenes};
}

async function callCloudflareText(project,recent,music,model,timeoutMs){
  const account=await getSetting('cf_account_id'),token=await getSetting('cf_api_token');
  if(!account||!token)throw new Error('Chưa cấu hình Cloudflare Workers AI');
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`;
  const resp=await fetchTimed(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:'Return only strict JSON. No markdown. Keep the answer concise.'},{role:'user',content:planPrompt(project,recent,music)}],max_tokens:1500,temperature:0.25,top_p:0.9})},timeoutMs);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok||data?.success===false)throw new Error(`Cloudflare ${resp.status}: ${data?.errors?.[0]?.message||data?.error||JSON.stringify(data).slice(0,220)}`);
  const raw=data?.result?.response??data?.response??data?.result?.text??data?.result;
  return normalizePlan(raw,project);
}

async function cloudflarePlan(project,recent,music){
  const errors=[];
  for(const [i,model] of CF_TEXT_MODELS.entries()){
    try{return await callCloudflareText(project,recent,music,model,i===0?25000:15000)}catch(e){errors.push(`${model.split('/').pop()}: ${errText(e)}`)}
  }
  throw new Error(errors.join(' | '));
}

async function geminiPlan(project,recent,music){
  const key=await getSetting('gemini_api_key'),model=(await getSetting('gemini_text_model'))||'gemini-3.7-flash';
  if(!key)throw new Error('Chưa cấu hình Gemini API key');
  const resp=await fetchTimed(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:planPrompt(project,recent,music)}]}],generationConfig:{responseMimeType:'application/json',temperature:0.35,maxOutputTokens:1800}})},30000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(`Gemini ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,220)}`);
  const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
  return normalizePlan(text,project);
}

async function openaiPlan(project,recent,music){
  const key=await getSetting('openai_api_key'),model=(await getSetting('openai_text_model'))||'gpt-5.6-luna';
  if(!key)throw new Error('Chưa cấu hình OpenAI API key');
  const resp=await fetchTimed('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:planPrompt(project,recent,music)}],response_format:{type:'json_object'}})},30000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(`OpenAI ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,220)}`);
  return normalizePlan(data?.choices?.[0]?.message?.content||'',project);
}

export async function planWithFallback(project,recent,music){
  const errors=[];
  try{return{plan:await cloudflarePlan(project,recent,music),provider:'cloudflare'}}catch(e){errors.push(`Cloudflare Text: ${errText(e)}`)}
  const premium=String(await getSetting('premium_fallback').catch(()=>''))==='true';
  if(premium&&await getSetting('gemini_api_key').catch(()=>'')){try{return{plan:await geminiPlan(project,recent,music),provider:'gemini'}}catch(e){errors.push(`Gemini: ${errText(e)}`)}}
  if(premium&&await getSetting('openai_api_key').catch(()=>'')){try{return{plan:await openaiPlan(project,recent,music),provider:'openai'}}catch(e){errors.push(`OpenAI: ${errText(e)}`)}}
  console.warn('AI planner fallback local:',errors.join(' | '));
  return{plan:emergencyPlan(project,music),provider:'local-safe'};
}

export async function testCopilotAccess(){
  await setSetting('copilot_status','disabled',false).catch(()=>{});
  await setSetting('copilot_last_error','Đã tắt khỏi pipeline vì GitHub đang trả 403 policy cho tài khoản này.',false).catch(()=>{});
  throw new Error('Copilot đã tắt khỏi pipeline vì GitHub policy đang chặn SDK. Cloudflare AI hiện là quản đốc mặc định.');
}

export async function cloudflareImage(prompt){
  const account=await getSetting('cf_account_id'),token=await getSetting('cf_api_token');
  if(!account||!token)throw new Error('Chưa cấu hình Cloudflare Workers AI');
  const today=new Date().toISOString().slice(0,10),limit=Number((await getSetting('image_daily_limit'))||20);
  const usage=Number((await q("select count(*)::int c from media where kind='image' and meta->>'generatedBy'='cloudflare' and created_at::date=$1::date",[today])).rows[0].c);
  if(usage>=limit)throw new Error(`Đã chạm giới hạn ảnh hôm nay (${limit})`);
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
      const resp=await fetchTimed(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({prompt,steps:4,seed:crypto.randomInt(1,999999999)})},45000);
      if(!resp.ok)throw new Error(`Cloudflare FLUX ${resp.status}: ${(await resp.text()).slice(0,220)}`);
      const ct=resp.headers.get('content-type')||'';
      if(ct.includes('json')){const j=await resp.json(),b64=j?.result?.image||j?.image||j?.result;if(typeof b64!=='string')throw new Error('Cloudflare không trả dữ liệu ảnh');return{buffer:Buffer.from(b64,'base64'),mime:'image/jpeg',provider:'cloudflare'}}
      return{buffer:Buffer.from(await resp.arrayBuffer()),mime:ct.split(';')[0]||'image/jpeg',provider:'cloudflare'};
    }catch(e){lastErr=e}
  }
  throw lastErr||new Error('Cloudflare FLUX lỗi');
}

async function geminiImage(prompt){
  const key=await getSetting('gemini_api_key'),model=(await getSetting('gemini_image_model'))||'gemini-3.1-flash-image';
  if(!key)throw new Error('Chưa cấu hình Gemini API key');
  const resp=await fetchTimed(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE'],responseFormat:{image:{aspectRatio:'9:16',imageSize:'1K'}}}})},60000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(`Gemini Image ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,220)}`);
  const parts=data?.candidates?.[0]?.content?.parts||[],part=parts.find(p=>p.inlineData?.data||p.inline_data?.data),inline=part?.inlineData||part?.inline_data;
  if(!inline?.data)throw new Error('Gemini không trả dữ liệu ảnh');
  return{buffer:Buffer.from(inline.data,'base64'),mime:inline.mimeType||inline.mime_type||'image/png',provider:'gemini'};
}

async function openaiImage(prompt){
  const key=await getSetting('openai_api_key'),model=(await getSetting('openai_image_model'))||'gpt-image-1-mini';
  if(!key)throw new Error('Chưa cấu hình OpenAI API key');
  const resp=await fetchTimed('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,prompt,size:'1024x1536',quality:'low'})},60000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(`OpenAI Image ${resp.status}: ${data?.error?.message||JSON.stringify(data).slice(0,220)}`);
  const b64=data?.data?.[0]?.b64_json;if(!b64)throw new Error('OpenAI không trả dữ liệu ảnh');
  return{buffer:Buffer.from(b64,'base64'),mime:'image/png',provider:'openai'};
}

export async function saveGeneratedImage(ownerId,projectId,index,prompt){
  const errors=[];let img;
  try{img=await cloudflareImage(prompt)}catch(e){errors.push(`Cloudflare: ${errText(e)}`)}
  const premium=String(await getSetting('premium_fallback').catch(()=>''))==='true';
  if(!img&&premium&&await getSetting('gemini_api_key').catch(()=>'')){try{img=await geminiImage(prompt)}catch(e){errors.push(`Gemini: ${errText(e)}`)}}
  if(!img&&premium&&await getSetting('openai_api_key').catch(()=>'')){try{img=await openaiImage(prompt)}catch(e){errors.push(`OpenAI: ${errText(e)}`)}}
  if(!img)throw new Error(`Không tạo được ảnh: ${errors.join(' | ')}`);
  const mid=newid(),ext=img.mime.includes('png')?'png':'jpg';
  await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[mid,ownerId,'image',`${projectId}-scene-${index+1}.${ext}`,img.mime,img.buffer,{generatedBy:img.provider,projectId,prompt,index}]);
  return{id:mid,provider:img.provider};
}

export async function testPremiumProvider(provider){
  if(provider==='gemini'){
    const key=await getSetting('gemini_api_key');if(!key)throw new Error('Chưa lưu Gemini API key');
    const r=await fetchTimed('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key}},15000);if(!r.ok)throw new Error(`Gemini key lỗi ${r.status}: ${(await r.text()).slice(0,180)}`);return{ok:true};
  }
  if(provider==='openai'){
    const key=await getSetting('openai_api_key');if(!key)throw new Error('Chưa lưu OpenAI API key');
    const r=await fetchTimed('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${key}`}},15000);if(!r.ok)throw new Error(`OpenAI key lỗi ${r.status}: ${(await r.text()).slice(0,180)}`);return{ok:true};
  }
  throw new Error('Provider không hợp lệ');
}
