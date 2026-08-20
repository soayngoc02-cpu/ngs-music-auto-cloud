import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import {fileURLToPath} from 'url';
import {pool,q,initDb,getSetting,setSetting,newid,audit} from './db.js';
import {auth,requireRole,registerAuthRoutes} from './auth.js';
import {registerCopilotOAuthRoutes} from './copilot-oauth.js';
import {planWithFallback,saveGeneratedImage,testCopilotAccess,testPremiumProvider} from './providers.js';
import {normalizeSceneDurations,renderProject} from './render.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'..');
const PORT=Number(process.env.PORT||3000);
const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:35*1024*1024}});

app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.use(express.static(path.join(ROOT,'public')));
registerAuthRoutes(app);
registerCopilotOAuthRoutes(app);

async function updateProject(id,patch){
  const ks=Object.keys(patch),vals=[],sets=[];
  for(const k of ks){vals.push(patch[k]);sets.push(`${k}=$${vals.length}`)}
  if(!sets.length)return;
  vals.push(id);
  await q(`update projects set ${sets.join(',')},updated_at=now() where id=$${vals.length}`,vals);
}

app.get('/api/health',async(_req,res)=>{
  let db=false;
  try{if(pool){await q('select 1');db=true}}catch{}
  const providers={copilot:false,copilotConnected:false,copilotStatus:'unknown',cloudflare:false,cloudflareText:false,gemini:false,openai:false,premium:false};
  if(db){
    try{
      providers.copilotConnected=!!(await getSetting('copilot_token'));
      providers.copilotStatus=(await getSetting('copilot_status'))||'unknown';
      providers.copilot=providers.copilotConnected&&providers.copilotStatus==='ok';
      providers.cloudflare=!!((await getSetting('cf_account_id'))&&(await getSetting('cf_api_token')));
      providers.cloudflareText=providers.cloudflare;
      providers.gemini=!!(await getSetting('gemini_api_key'));
      providers.openai=!!(await getSetting('openai_api_key'));
      providers.premium=String(await getSetting('premium_fallback'))==='true';
    }catch{}
  }
  res.json({ok:true,version:'7.3.0-online',db,providers});
});

app.get('/api/ready',async(_req,res)=>{
  let db=false;
  try{if(pool){await q('select 1');db=true}}catch{}
  res.status(db?200:503).json({ok:db,db});
});

app.get('/api/settings',auth,requireRole('SUPER_ADMIN'),async(_req,res)=>{
  const keys=['copilot_token','copilot_login','github_app_client_id','copilot_model','copilot_status','copilot_last_error','cf_account_id','cf_api_token','image_daily_limit','premium_fallback','gemini_api_key','gemini_text_model','gemini_image_model','openai_api_key','openai_text_model','openai_image_model'];
  const v={};
  for(const k of keys)v[k]=await getSetting(k).catch(()=> '');
  res.json({settings:{
    copilot_connected:!!v.copilot_token,
    copilot_login:v.copilot_login||'',
    github_app_ready:!!v.github_app_client_id,
    copilot_model:v.copilot_model||'gpt-5.4',
    copilot_status:v.copilot_status||'unknown',
    copilot_last_error:v.copilot_last_error||'',
    cf_account_id:!!v.cf_account_id,
    cf_api_token:!!v.cf_api_token,
    image_daily_limit:v.image_daily_limit||'20',
    premium_fallback:v.premium_fallback||'false',
    gemini_api_key:!!v.gemini_api_key,
    gemini_text_model:v.gemini_text_model||'gemini-3.7-flash',
    gemini_image_model:v.gemini_image_model||'gemini-3.1-flash-image',
    openai_api_key:!!v.openai_api_key,
    openai_text_model:v.openai_text_model||'gpt-5.6-luna',
    openai_image_model:v.openai_image_model||'gpt-image-1-mini'
  }});
});

app.post('/api/settings',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
  const b=req.body||{};
  if(b.copilot_model)await setSetting('copilot_model',b.copilot_model,false);
  if(b.cf_account_id)await setSetting('cf_account_id',b.cf_account_id,true);
  if(b.cf_api_token)await setSetting('cf_api_token',b.cf_api_token,true);
  if(b.gemini_api_key)await setSetting('gemini_api_key',b.gemini_api_key,true);
  if(b.gemini_text_model)await setSetting('gemini_text_model',b.gemini_text_model,false);
  if(b.gemini_image_model)await setSetting('gemini_image_model',b.gemini_image_model,false);
  if(b.openai_api_key)await setSetting('openai_api_key',b.openai_api_key,true);
  if(b.openai_text_model)await setSetting('openai_text_model',b.openai_text_model,false);
  if(b.openai_image_model)await setSetting('openai_image_model',b.openai_image_model,false);
  if(b.image_daily_limit!==undefined)await setSetting('image_daily_limit',String(Math.max(1,Math.min(100,Number(b.image_daily_limit)||20))),false);
  if(b.premium_fallback!==undefined)await setSetting('premium_fallback',String(!!b.premium_fallback),false);
  await audit(req.user.id,'settings_update','providers',{keys:Object.keys(b).filter(k=>!k.includes('key')&&!k.includes('token'))});
  res.json({ok:true});
});

app.post('/api/providers/test/:provider',auth,requireRole('SUPER_ADMIN'),async(req,res)=>{
  try{
    const p=String(req.params.provider);
    const result=p==='copilot'?await testCopilotAccess():await testPremiumProvider(p);
    res.json(result);
  }catch(e){res.status(400).json({error:String(e.message||e)})}
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
  const r=k?await q('select id,owner_id,kind,name,mime,meta,shared,created_at,octet_length(data) size from media where kind=$1 order by created_at desc',[k]):await q('select id,owner_id,kind,name,mime,meta,shared,created_at,octet_length(data) size from media order by created_at desc');
  res.json({media:r.rows});
});

function mediaMime(m){
  const raw=String(m.mime||'').toLowerCase();
  if(raw&&raw!=='application/octet-stream'&&raw!=='binary/octet-stream')return raw;
  const ext=path.extname(String(m.name||'')).toLowerCase();
  return ({'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.webm':'video/webm','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[ext]||'application/octet-stream');
}

app.get('/api/media/:id',auth,async(req,res)=>{
  const r=await q('select * from media where id=$1',[req.params.id]);
  if(!r.rowCount)return res.status(404).end();
  const m=r.rows[0],data=Buffer.isBuffer(m.data)?m.data:Buffer.from(m.data),size=data.length,mime=mediaMime(m);
  res.setHeader('Content-Type',mime);
  res.setHeader('Accept-Ranges','bytes');
  res.setHeader('Cache-Control','private,max-age=3600');
  res.setHeader('X-Content-Type-Options','nosniff');
  const range=String(req.headers.range||'');
  if(!range){
    res.setHeader('Content-Length',String(size));
    return res.end(data);
  }
  const match=/^bytes=(\d*)-(\d*)/.exec(range);
  if(!match){res.status(416).setHeader('Content-Range',`bytes */${size}`);return res.end()}
  let start,end;
  if(match[1]===''&&match[2]!==''){
    const suffix=Math.max(0,Number(match[2])||0);
    start=Math.max(0,size-suffix);end=size-1;
  }else{
    start=Math.max(0,Number(match[1])||0);
    end=match[2]!==''?Math.min(size-1,Number(match[2])||0):size-1;
  }
  if(start>=size||end<start){res.status(416).setHeader('Content-Range',`bytes */${size}`);return res.end()}
  const chunk=data.subarray(start,end+1);
  res.status(206);
  res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length',String(chunk.length));
  return res.end(chunk);
});

app.delete('/api/media/:id',auth,async(req,res)=>{
  const m=(await q('select * from media where id=$1',[req.params.id])).rows[0];
  if(!m)return res.status(404).json({error:'Không tìm thấy'});
  if(req.user.role!=='SUPER_ADMIN'&&m.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  await q('delete from media where id=$1',[m.id]);
  res.json({ok:true});
});

let queue=Promise.resolve();
const enqueue=fn=>(queue=queue.then(fn).catch(e=>console.error('queue',e)));

async function processProject(pid){
  try{
    const p=(await q('select * from projects where id=$1',[pid])).rows[0];
    if(!p)return;
    await updateProject(pid,{status:'planning',progress:8,message:'AI đang lập kế hoạch',error:null});
    const recent=(await q('select title,idea,status,created_at from projects where id<>$1 order by created_at desc limit 12',[pid])).rows;
    const music=(await q("select id,name,meta from media where kind='music' order by created_at desc limit 100")).rows;
    const planned=await planWithFallback(p,recent,music),plan=planned.plan;
    plan.provider=planned.provider;
    plan.scenes=normalizeSceneDurations(plan.scenes,p.duration);
    await updateProject(pid,{title:plan.title||p.title,plan,status:'visuals',progress:20,message:`${planned.provider.toUpperCase()} đã lập kế hoạch · đang tạo ${plan.scenes.length} ảnh`});
    for(let i=0;i<plan.scenes.length;i++){
      const img=await saveGeneratedImage(p.owner_id,pid,i,plan.scenes[i].imagePrompt);
      plan.scenes[i].imageId=img.id;
      plan.scenes[i].imageProvider=img.provider;
      await updateProject(pid,{plan,progress:20+Math.round((i+1)/plan.scenes.length*40),message:`Đã tạo ảnh ${i+1}/${plan.scenes.length} · ${img.provider}`});
    }
    let musicId=null;
    if(p.music_mode==='auto'){
      const ids=new Set(music.map(x=>x.id));
      musicId=plan.musicId&&ids.has(plan.musicId)?plan.musicId:(music[0]?.id||null);
    }
    if(!musicId){
      await updateProject(pid,{plan,status:'waiting_music',progress:62,message:'Visual đã xong — đang chờ chọn nhạc'});
      return;
    }
    await updateProject(pid,{plan,music_id:musicId,status:'rendering',progress:68,message:'FFmpeg đang dựng video'});
    const out=await renderProject(p,plan,musicId,(progress,message)=>updateProject(pid,{progress,message}));
    await updateProject(pid,{output_media_id:out,status:'done',progress:100,message:'Video hoàn thành'});
  }catch(e){
    console.error(e);
    await updateProject(pid,{status:'error',progress:0,message:'Có lỗi',error:String(e.message||e)}).catch(()=>{});
  }
}

app.post('/api/projects',auth,async(req,res)=>{
  const pid=newid(),idea=String(req.body.idea||'').slice(0,3000),duration=[15,20,30,45,60].includes(Number(req.body.duration))?Number(req.body.duration):20,mode=req.body.music_mode==='manual'?'manual':'auto';
  await q('insert into projects(id,owner_id,title,idea,duration,music_mode,status,progress,message,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,0,$8,now(),now())',[pid,req.user.id,'Video mới',idea,duration,mode,'queued','Đã xếp hàng']);
  enqueue(()=>processProject(pid));
  res.status(202).json({project:{id:pid,status:'queued'}});
});

app.get('/api/projects',auth,async(req,res)=>{
  const r=req.user.role==='SUPER_ADMIN'?await q('select * from projects order by created_at desc limit 100'):await q('select * from projects where owner_id=$1 order by created_at desc limit 100',[req.user.id]);
  res.json({projects:r.rows});
});

app.get('/api/projects/:id',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];
  if(!p)return res.status(404).json({error:'Không tìm thấy project'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  res.json({project:p});
});

app.post('/api/projects/:id/music',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];
  if(!p)return res.status(404).json({error:'Không tìm thấy project'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  const m=(await q("select * from media where id=$1 and kind='music'",[req.body.musicId])).rows[0];
  if(!m)return res.status(400).json({error:'Nhạc không hợp lệ'});
  await updateProject(p.id,{music_id:m.id,status:'rendering',progress:68,message:'Đã chọn nhạc — đang render'});
  enqueue(async()=>{
    try{
      const latest=(await q('select * from projects where id=$1',[p.id])).rows[0];
      const out=await renderProject(latest,latest.plan,m.id,(progress,message)=>updateProject(p.id,{progress,message}));
      await updateProject(p.id,{output_media_id:out,status:'done',progress:100,message:'Video hoàn thành'});
    }catch(e){await updateProject(p.id,{status:'error',error:e.message,message:'Render lỗi'})}
  });
  res.json({ok:true});
});

app.post('/api/projects/:id/retry',auth,async(req,res)=>{
  const p=(await q('select * from projects where id=$1',[req.params.id])).rows[0];
  if(!p)return res.status(404).json({error:'Không tìm thấy'});
  if(req.user.role!=='SUPER_ADMIN'&&p.owner_id!==req.user.id)return res.status(403).json({error:'Không đủ quyền'});
  await updateProject(p.id,{status:'queued',progress:0,error:null,message:'Đã xếp hàng lại'});
  enqueue(()=>processProject(p.id));
  res.json({ok:true});
});

app.use((_req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));

initDb().then(()=>app.listen(PORT,()=>console.log(`NGS V7 :${PORT}`))).catch(e=>{
  console.error(e);
  app.listen(PORT,()=>console.log(`NGS V7 no-db :${PORT}`));
});
