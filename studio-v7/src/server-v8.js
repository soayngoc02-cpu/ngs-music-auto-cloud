import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import {fileURLToPath} from 'url';
import {pool,q,initDb,getSetting,setSetting,newid,audit} from './db.js';
import {auth,requireRole,registerAuthRoutes} from './auth.js';
import {planWithFallback,saveGeneratedImage,testPremiumProvider} from './providers.js';
import {normalizeSceneDurations} from './render.js';
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

async function updateProject(id,patch){
  const ks=Object.keys(patch),vals=[],sets=[];
  for(const k of ks){vals.push(patch[k]);sets.push(`${k}=$${vals.length}`)}
  if(!sets.length)return;
  vals.push(id);await q(`update projects set ${sets.join(',')},updated_at=now() where id=$${vals.length}`,vals);
}
function cleanIdea(v){return String(v||'').replace(/\s*\[NGS_VISUAL_STYLE:(realistic|illustration)\]\s*$/i,'').trim()}
function mediaMime(m){
  const raw=String(m.mime||'').toLowerCase();if(raw&&raw!=='application/octet-stream'&&raw!=='binary/octet-stream')return raw;
  const ext=path.extname(String(m.name||'')).toLowerCase();
  return ({'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.webm':'video/webm','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[ext]||'application/octet-stream');
}

app.get('/',(_req,res)=>res.sendFile(path.join(ROOT,'public','index-v8.html')));

app.get('/api/health',async(_req,res)=>{
  let db=false,renderWorker={ready:false};
  try{if(pool){await q('select 1');db=true;renderWorker=await githubRenderState()}}catch{}
  const providers={cloudflare:false,cloudflareText:false,gemini:false,openai:false,premium:false,renderWorker:!!renderWorker.ready};
  if(db){try{
    providers.cloudflare=!!((await getSetting('cf_account_id'))&&(await getSetting('cf_api_token')));providers.cloudflareText=providers.cloudflare;
    providers.gemini=!!(await getSetting('gemini_api_key');
  }catch{}
  }
  res.json({ok:true,version:'8.0.0-cloud-render',db,providers,renderWorker});
});
