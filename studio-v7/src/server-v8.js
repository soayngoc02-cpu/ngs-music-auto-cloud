import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import {fileURLToPath} from 'url';
import {pool,q,initDb,getSetting,setSetting,newid,audit} from './db.js';
import {auth,requireRole,registerAuthRoutes} from './auth.js';
import {planWithFallback,saveGeneratedImage,testPremiumProvider} from './providers.js';
import {registerGithubRenderRoutes,githubRenderState,dispatchGithubRender} from './github-render.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'..');
const PORT=Number(process.env.PORT||3000);
const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:40*1024*1024}});

app.disable('x-powered-by');
app.use(express.json({limit:'3mb'}));
app.use(cookieParser());
app.use(express.static(path.join(ROOT,'public'),{index:false}));
registerAuthRoutes(app);
registerGithubRenderRoutes(app);

export function normalizeSceneDurations(scenes,total){
  const src=scenes?.length?scenes:[{duration:total,text:'',motion:'slow_push',effect:'none'}];
  const raw=src.map(s=>Math.max(2,Number(s.duration)||3)),sum=raw.reduce((a,b)=>a+b,0);let used=0;
  return src.map((s,i)=>{const d=i===src.length-1?Math.max(2,total-used):Math.max(2,Math.round(raw[i]/sum*total));used+=d;return{...s,duration:d}});
}

async function updateProject(id,patch){
  const ks=Object.keys(patch),vals=[],sets=[];
  for(const k of ks){vals.push(patch[k]);sets.push(`${k}=$${vals.length}`)}
  if(!sets.length)return;
  vals.push(id);
  await q(`update projects set ${sets.join(',')},updated_at=now() where id=$${vals.length}`,vals);
}

const STYLE_MARKER=/\s*\[NGS_VISUAL_STYLE:(realistic|illustration)\]\s*$/i;
function cleanIdea(v){return String(v||'').replace(STYLE_MARKER,'').trim()}
function visualStyle(v){return String(v||'').match(STYLE_MARKER)?.[1]?.toLowerCase()==='illustration'?'illustration':'realistic'}
function publicProject(p){return{...p,idea:cleanIdea(p.idea),visual_style:visualStyle(p.idea)}}

function mediaMime(m){
  const raw=String(m.mime||'').toLowerCase();
  if(raw&&raw!=='application/octet-stream'&&raw!=='binary/octet-stream')return raw;
  const ext=path.extname(String(m.name||'')).toLowerCase();
  return ({'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.webm':'video/webm','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[ext]||'application/octet-stream');
}

app.get('/',(_req,res)=>res.sendFile(path.join(ROOT,'public','index-v8.html')));

app.get('/api/health',async(_req,res)=>{
  let db=false,renderWorker={ready:false};
  try{if(pool){await q('select 1');db=true;renderWorker=await githubRenderState()}}catch{}
  const providers={cloudflare:false,cloudflareText:false,gemini:false,openai:false,premium:false,renderWorker:!!renderWorker.ready};
  if(db){
    try{
      providers.cloudflare=!!((await getSetting('cf_account_id'))&&(await getSetting('cf_api_token')));
      providers.cloudflareText=providers.cloudflare;
      providers.gemini=!!(await getSetting('gemini_api_key'));
      providers.openai=!!(await getSetting('openai_api_key'));
      providers.premium=String(await getSetting('premium_fallback'))==='true';
    }catch{}
  }
  res.json({ok:true,version:'8.0.0-cloud-render',db,providers,renderWorker});
});
app.get('/api/ready',async(_req,res)=>{try{await q('select 1');res.json({ok:true})}catch{res.status(503).json({ok:false})}});

app.get('/api/settings',auth,requireRole('SUPER_ADMIN'),async(_req,res)=>{
  const keys=['cf_account_id','cf_api_token','image_daily_limit','premium_fallback','gemini_api_key','gemini_text_model','gemini_image_model','openai_api_key','openai_text_model','openai_image_model'];
  const v={};for(const k of keys)v[k]=await getSetting(k).catch(()=> '');
  res.json({settings:{
    cf_account_id:!!v.cf_account_id,cf_api_token:!!v.cf_api_token,image_daily_limit:v.image_daily_limit||'20',premium_fallback:v.premium_fallback||'false',
    gemini_api_key:!!v.gemini_api_key,gemini_text_model:v.gemini_text_model||'gemini-3.7-flash',gemini_image_model:v.gemini_image_model||'gemini-3.1-flash-image',
    openai_api_key:!!v.openai_api_key,openai_text_model:v.openai_text_model||'gpt-5.6-luna',openai_image_model:v.openai_image_model||'gpt-image-1-mini',
    render_worker:await githubRenderState()
  }});
});
app.post('/api/settings',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
  const b=req.body||{};
  if(b.cf_account_id)await setSetting('cf_account_id',String(b.cf_account_id),true);
  if(b.cf_api_token)await setSetting('cf_api_token',String(b.cf_api_token),true);
  if(b.gemini_api_key)await setSetting('gemini_api_key',String(b.gemini_api_key),true);
  if(b.gemini_text_model)await setSetting('gemini_text_model',String(b.gemini_text_model),false);
  if(b.gemini_image_model)await setSetting('gemini_image_model',String(b.gemini_image_model),false);
  if(b.openai_api_key)await setSetting('openai_api_key',String(b.openai_api_key),true);
  if(b.openai_text_model)await setSetting('openai_text_model',String(b.openai_text_model),false);
  if(b.openai_image_model)await setSetting('openai_image_model',String(b.openai_image_model),false);
  if(b.image_daily_limit!==undefined)await setSetting('image_daily_limit',String(Math.max(1,Math.min(100,Number(b.image_daily_limit)||20))),false);
  if(b.premium_fallback!==undefined)await setSetting('premium_fallback',String(!!b.premium_fallback),false);
  await audit(req.user.id,'settings_update_v8','providers',{keys:Object.keys(b).filter(k=>!k.includes('key')&&!k.includes('token'))});
  res.json({ok:true});
});
app.post('/api/providers/test/:provider',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
  try{const p=String(req.params.provider);if(!['gemini','openai'].includes(p))return res.status(400).json({error:'Provider không hỗ trợ'});res.json(await testPremiumProvider(p))}catch(e){res.status(400).json({error:String(e.message||e)})}
});

app.post('/api/media',auth,upload.single('file'),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Thiếu file'});
  const kind=String(req.body.kind||'image');
  if(!['music','image','logo','video'].includes(kind))return res.status(400).json({error:'Loại media không hợp lệ'});
  const id=newid();
  await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[id,req.user.id,kind,req.file.originalname,req.file.mimetype||'application/octet-stream',req.file.buffer,{}]);
  res.json({media:{id,kind,name:req.file.originalname,mime:req.file.mimetype,size:req.file.size}});
});
app.get('/api/media',auth,async(req,res)=>{
  const k=req.query.kind?String(req.query.kind):null;
  const sql=k?'select id,owner_id,kind,name,mime,meta,shared,created_at,octet_length(data) size from media where kind=$1 order by created_at desc':'select id,owner_id,kind,name,mime,meta,shared,created_at,octet_length(data) size from media order by created_at desc';
  res.json({media:(await q(sql,k?[k]:[])).rows});
});
app.get('/api/media/:id',auth,async(req,res)=>{
  const m=(await q('select * from media where id=$1',[req.params.id])).rows[0];if(!m)return res.status(404).end();
  const data=Buffer.isBuffer(m.data)?m.data:Buffer.from(m.data),size=data.length,mime=mediaMime(m);
  res.setHeader('Content-Type',mime);res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private,max-age=3600');res.setHeader('X-Content-Type-Options','nosniff');
  const range=String(req.headers.range||'');if(!range){res.setHeader('Content-Length',String(size));return res.end(data)}
  const match=/^bytes=(\d*)-(\d*)/.exec(range);if(!match){res.status(416).setHeader('Content-Range',`bytes */${size}`);return res.end()}
  let start,end;if(match[1]===''&&match[2]!==''){const suffix=Math.max(0,Number(match[2])||0);start=Math.max(0,size-suffix);end=size-1}else{start=Math.max(0,Number(match[1])||0);end=match[2]!==''?Math.min(size-1,Number(match[2])||0):size-1}
  if(start>=size||end<start){res.status(416).setHeader('Content-Range',`bytes */${size}`);return res.end()}
  const chunk=data.subarray(start,end+1);res.status(206);res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);res.setHeader('Content-Length',String(chunk.length));res.end(chunk);
});
app.delete('/api/media/:id',auth,async(req,res)=>{
  const m=(await q('select * from media where id=$1',[req.params.id])).rows[0];if(!m)return res.status(404).json({error:'Không tìm thấy'});
  if(req.user.role!=='SUPER_ADMIN'&&m.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  await q('delete from media where id=$1',[m.id]);res.json({ok:true});
});

let queue=Promise.resolve();
const enqueue=fn=>(queue=queue.then(fn).catch(e=>console.error('queue',e)));
async function mediaExists(id,kind=null){if(!id)return false;const r=kind?await q('select 1 from media where id=$1 and kind=$2',[id,kind]):await q('select 1 from media where id=$1',[id]);return r.rowCount>0}

async function sendToRender(pid,musicId,plan){
  const worker=await githubRenderState();
  if(!worker.ready){
    await updateProject(pid,{plan,music_id:musicId,status:'waiting_render',progress:68,message:'Visual + nhạc đã sẵn sàng — kết nối GitHub Render Worker',error:null});
    return{queued:false,reason:'worker_not_connected'};
  }
  await updateProject(pid,{plan,music_id:musicId,status:'rendering',progress:68,message:'GitHub Actions đang khởi tạo render 1080×1920',error:null});
  try{await dispatchGithubRender(pid);return{queued:true}}
  catch(e){await updateProject(pid,{status:'waiting_render',progress:68,message:'Không gửi được render cloud — bấm Render 1080p để thử lại',error:String(e.message||e)});return{queued:false,reason:String(e.message||e)}}
}

async function processProject(pid){
  try{
    let p=(await q('select * from projects where id=$1',[pid])).rows[0];if(!p)return;
    const recent=(await q('select title,idea,status,created_at from projects where id<>$1 order by created_at desc limit 12',[pid])).rows;
    const music=(await q("select id,name,meta from media where kind='music' order by created_at desc limit 100")).rows;
    let plan=p.plan&&Array.isArray(p.plan.scenes)&&p.plan.scenes.length?p.plan:null;
    if(!plan){
      await updateProject(pid,{status:'planning',progress:8,message:'Cloudflare AI đang lập kế hoạch',error:null});
      const planned=await planWithFallback(p,recent,music);plan=planned.plan;plan.provider=planned.provider;plan.scenes=normalizeSceneDurations(plan.scenes,p.duration);
      await updateProject(pid,{title:plan.title||p.title,plan,status:'visuals',progress:20,message:`${planned.provider.toUpperCase()} đã lập kế hoạch · đang chuẩn bị visual`});
    }else{
      plan.scenes=normalizeSceneDurations(plan.scenes,p.duration);
      await updateProject(pid,{plan,status:'visuals',progress:20,message:'Đang tiếp tục visual còn thiếu',error:null});
    }

    for(let i=0;i<plan.scenes.length;i++){
      const s=plan.scenes[i];
      if(s.imageId&&await mediaExists(s.imageId,'image'))continue;
      const img=await saveGeneratedImage(p.owner_id,pid,i,s.imagePrompt);s.imageId=img.id;s.imageProvider=img.provider;
      await updateProject(pid,{plan,progress:20+Math.round((i+1)/plan.scenes.length*40),message:`Visual ${i+1}/${plan.scenes.length} · ${img.provider}`});
    }

    p=(await q('select * from projects where id=$1',[pid])).rows[0];
    let musicId=p.music_id&&await mediaExists(p.music_id,'music')?p.music_id:null;
    if(!musicId&&p.music_mode==='auto'){
      const ids=new Set(music.map(x=>x.id));musicId=plan.musicId&&ids.has(plan.musicId)?plan.musicId:(music[0]?.id||null);
    }
    if(!musicId){await updateProject(pid,{plan,status:'waiting_music',progress:62,message:'Visual đã xong — chọn nhạc để render 1080p',error:null});return}
    await sendToRender(pid,musicId,plan);
  }catch(e){console.error(e);await updateProject(pid,{status:'error',progress:0,message:'Có lỗi khi chuẩn bị project',error:String(e.message||e)}).catch(()=>{})}
}

app.post('/api/projects',auth,async(req,res)=>{
  const pid=newid(),rawIdea=String(req.body.idea||'').slice(0,2900),style=req.body.visual_style==='illustration'?'illustration':'realistic';
  const idea=`${rawIdea}${rawIdea?'\n':''}[NGS_VISUAL_STYLE:${style}]`,duration=[15,20,30,45,60].includes(Number(req.body.duration))?Number(req.body.duration):20,mode=req.body.music_mode==='manual'?'manual':'auto';
  await q('insert into projects(id,owner_id,title,idea,duration,music_mode,status,progress,message,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,0,$8,now(),now())',[pid,req.user.id,'Video mới',idea,duration,mode,'queued','Đã xếp hàng']);
  enqueue(()=>processProject(pid));res.status(202).json({project:{id:pid,status:'queued'}});
});
app.get('/api/projects',auth,async(req,res)=>{
  const r=req.user.role==='SUPER_ADMIN'?await q('select * from projects order by created_at desc limit 100'):await q('select * from projects where owner_id=$1 order by created_at desc limit 100',[req.user.id]);
  res.json({projects:r.rows.map(publicProject)});
});
app.get('/api/projects/:id',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'Không tìm thấy project'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});res.json({project:publicProject(p)});
});
app.post('/api/projects/:id/music',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'Không tìm thấy project'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  const m=(await q("select id from media where id=$1 and kind='music'",[req.body.musicId])).rows[0];if(!m)return res.status(400).json({error:'Nhạc không hợp lệ'});
  await sendToRender(p.id,m.id,p.plan);res.json({ok:true});
});
app.post('/api/projects/:id/render',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'Không tìm thấy project'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  if(!p.plan?.scenes?.length)return res.status(409).json({error:'Project chưa có visual'});if(!p.music_id)return res.status(409).json({error:'Project chưa có nhạc'});
  const result=await sendToRender(p.id,p.music_id,p.plan);if(!result.queued)return res.status(409).json({error:result.reason==='worker_not_connected'?'Chưa kết nối GitHub Render Worker':result.reason});res.json({ok:true});
});
app.post('/api/projects/:id/retry',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'Không tìm thấy project'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  await updateProject(p.id,{error:null,message:'Đang thử lại'});
  const readyAssets=!!(p.plan?.scenes?.length&&p.plan.scenes.every(s=>s.imageId)&&p.music_id);
  if(readyAssets){await sendToRender(p.id,p.music_id,p.plan)}else enqueue(()=>processProject(p.id));res.json({ok:true});
});

await initDb();
await q("update projects set status='waiting_render',progress=68,message='Render cũ đã dừng — bấm Render 1080p',updated_at=now() where status='rendering' and output_media_id is null and updated_at < now()-interval '10 minutes'").catch(()=>{});
app.listen(PORT,'0.0.0.0',()=>console.log(`NGS V8 cloud-render :${PORT}`));
