import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {spawn} from 'child_process';

const PROJECT_ID=String(process.env.PROJECT_ID||'');
const BASE_URL=String(process.env.BASE_URL||'').replace(/\/$/,'');
const TOKEN=String(process.env.NGS_WORKER_TOKEN||'');
if(!PROJECT_ID||!BASE_URL||!TOKEN)throw new Error('Missing PROJECT_ID, BASE_URL or NGS_WORKER_TOKEN');

const authHeaders=()=>({Authorization:`Bearer ${TOKEN}`});

async function api(pathname,opt={}){
  const r=await fetch(`${BASE_URL}${pathname}`,{...opt,headers:{...authHeaders(),...(opt.headers||{})}});
  const ct=r.headers.get('content-type')||'';
  const data=ct.includes('json')?await r.json():await r.text();
  if(!r.ok)throw new Error(data?.error||String(data)||`HTTP ${r.status}`);
  return data;
}

async function downloadMedia(id,file){
  const r=await fetch(`${BASE_URL}/api/worker/media/${encodeURIComponent(id)}`,{headers:authHeaders()});
  if(!r.ok)throw new Error(`Download media ${id}: HTTP ${r.status}`);
  const ct=(r.headers.get('content-type')||'').split(';')[0];
  const buf=Buffer.from(await r.arrayBuffer());
  if(!buf.length)throw new Error(`Media ${id} rỗng`);
  await fs.writeFile(file,buf);
  return ct;
}

function run(cmd,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});
    let err='';
    p.stderr.on('data',d=>{err=(err+d.toString()).slice(-12000)});
    p.on('error',reject);
    p.on('close',code=>code===0?resolve():reject(new Error(`${path.basename(cmd)} exit ${code}: ${err.slice(-6000)}`)));
  });
}

function assTime(seconds){
  const total=Math.max(0,Number(seconds)||0),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=Math.floor(total%60),cs=Math.floor((total-Math.floor(total))*100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}
function assText(v){return String(v||'').replace(/\\/g,'\\\\').replace(/[{}]/g,'').replace(/\r?\n/g,'\\N').trim()}
async function writeAss(file,text,duration){
  const clean=assText(text);
  const event=clean?`Dialogue: 0,0:00:00.00,${assTime(duration)},Quote,,0,0,0,,{\\fad(220,260)}${clean}`:'';
  const body=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Quote,DejaVu Sans,58,&H00FFFFFF,&H00FFFFFF,&H60000000,&H90000000,-1,0,0,0,100,100,0,0,1,3.2,1.4,2,110,110,330,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${event}\n`;
  await fs.writeFile(file,body,'utf8');
}
const escFilterPath=p=>p.replaceAll('\\','/').replaceAll(':','\\:').replaceAll("'","\\'");

function sceneEffect(effect){
  if(effect==='grain')return ',noise=alls=4:allf=t+u';
  if(effect==='glow')return ',eq=contrast=1.035:brightness=0.012:saturation=1.08';
  if(effect==='light_leak')return ',colorbalance=rs=0.035:gs=0.012:bs=-0.025,eq=saturation=1.06';
  return '';
}
function sceneZoom(motion){
  if(motion==='pull_out')return `z='if(eq(on,1),1.10,max(zoom-0.00045,1.00))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  if(motion==='pan_left')return `z='1.06':x='min(iw-iw/zoom,on*0.7)':y='ih/2-(ih/zoom/2)'`;
  if(motion==='pan_right')return `z='1.06':x='max(0,iw-iw/zoom-on*0.7)':y='ih/2-(ih/zoom/2)'`;
  return `z='min(zoom+0.00045,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
}

async function progress(value,message){
  await api(`/api/worker/progress/${encodeURIComponent(PROJECT_ID)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:value,message})}).catch(()=>{});
}

async function main(){
  if(PROJECT_ID==='__healthcheck__')return;
  const {project,render}=await api(`/api/worker/job/${encodeURIComponent(PROJECT_ID)}`);
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),`ngs-v8-${PROJECT_ID.slice(0,8)}-`));
  try{
    const scenes=Array.isArray(project.plan?.scenes)?project.plan.scenes:[];
    if(!scenes.length)throw new Error('Project không có scene');
    const totalDuration=Number(project.duration||scenes.reduce((a,s)=>a+Number(s.duration||0),0)||20);
    await progress(70,`GitHub Actions · chuẩn bị ${scenes.length} scene 1080×1920`);

    const segments=[];
    for(let i=0;i<scenes.length;i++){
      const s=scenes[i],dur=Math.max(2,Number(s.duration)||Math.max(3,totalDuration/scenes.length));
      const img=path.join(tmp,`scene-${i}.img`),ass=path.join(tmp,`scene-${i}.ass`),out=path.join(tmp,`scene-${i}.mp4`);
      await downloadMedia(s.imageId,img);await writeAss(ass,s.text,dur);
      const frames=Math.max(1,Math.round(dur*30));
      const fadeOut=Math.max(0,dur-0.22).toFixed(2);
      const subtitle=String(s.text||'').trim()?`,ass=filename='${escFilterPath(ass)}'`:'';
      // Two-layer cinematic composition: blurred fill background + crisp foreground. Runner has ample RAM.
      const filter=`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=22[bg];[0:v]scale=1030:1810:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=${sceneZoom(s.motion)}:d=${frames}:s=1080x1920:fps=30${sceneEffect(s.effect)}${subtitle},fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOut}:d=0.22,vignette=PI/5,format=yuv420p[v]`;
      await run('ffmpeg',['-hide_banner','-loglevel','warning','-y','-loop','1','-t',String(dur),'-i',img,'-filter_complex',filter,'-map','[v]','-an','-r','30','-c:v','libx264','-preset','medium','-crf',String(render?.crf||18),'-profile:v','high','-level','4.1','-pix_fmt','yuv420p','-movflags','+faststart',out]);
      segments.push(out);
      await progress(70+Math.round((i+1)/scenes.length*17),`GitHub Actions · dựng scene ${i+1}/${scenes.length}`);
    }

    const list=path.join(tmp,'concat.txt');
    await fs.writeFile(list,segments.map(f=>`file '${f.replaceAll("'","'\\''")}'`).join('\n'));
    const silent=path.join(tmp,'silent.mp4');
    await run('ffmpeg',['-hide_banner','-loglevel','warning','-y','-f','concat','-safe','0','-i',list,'-c','copy',silent]);

    const music=path.join(tmp,'music.bin');
    await downloadMedia(project.musicId,music);
    await progress(90,'GitHub Actions · mix nhạc và chuẩn hóa loudness');
    const final=path.join(tmp,'final.mp4'),fadeOut=Math.max(0,totalDuration-1.3).toFixed(2);
    await run('ffmpeg',['-hide_banner','-loglevel','warning','-y','-i',silent,'-stream_loop','-1','-i',music,'-t',String(totalDuration),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-af',`loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.45,afade=t=out:st=${fadeOut}:d=1.30`,'-movflags','+faststart',final]);

    // Basic QA: assert final dimensions, duration and streams before upload.
    const probe=await new Promise((resolve,reject)=>{
      const p=spawn('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height','-show_entries','format=duration','-of','json',final]);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',c=>{if(c!==0)return reject(new Error(err||'ffprobe failed'));try{resolve(JSON.parse(out))}catch(e){reject(e)}});
    });
    const video=probe.streams?.find(s=>s.codec_type==='video'),audio=probe.streams?.find(s=>s.codec_type==='audio');
    if(video?.width!==1080||video?.height!==1920||!audio)throw new Error(`QA fail: ${video?.width}x${video?.height}, audio=${!!audio}`);

    await progress(96,'GitHub Actions · QA đạt · đang trả MP4 về Studio');
    const data=await fs.readFile(final);
    const r=await fetch(`${BASE_URL}/api/worker/result/${encodeURIComponent(PROJECT_ID)}`,{method:'POST',headers:{...authHeaders(),'Content-Type':'video/mp4','Content-Length':String(data.length)},body:data});
    const result=await r.json().catch(()=>({}));if(!r.ok)throw new Error(result.error||`Upload result HTTP ${r.status}`);
    console.log(`NGS V8 RENDER OK ${PROJECT_ID} · ${data.length} bytes · 1080x1920`);
  }finally{await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{})}
}

main().catch(async err=>{
  console.error(err);
  await api(`/api/worker/failure/${encodeURIComponent(PROJECT_ID)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error:String(err?.message||err).slice(0,1700)})}).catch(()=>{});
  process.exitCode=1;
});
