import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {spawn} from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import {q,newid} from './db.js';

export function normalizeSceneDurations(scenes,total){
  const src=scenes?.length?scenes:[{duration:total,text:'',motion:'slow_push',effect:'none'}];
  const raw=src.map(s=>Math.max(2,Number(s.duration)||3));
  const sum=raw.reduce((a,b)=>a+b,0);
  let used=0;
  return src.map((s,i)=>{
    const d=i===src.length-1?Math.max(2,total-used):Math.max(2,Math.round(raw[i]/sum*total));
    used+=d;
    return{...s,duration:d};
  });
}

function run(cmd,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});
    let err='';
    p.stderr.on('data',d=>err+=d);
    p.on('error',reject);
    p.on('close',c=>c===0?resolve():reject(new Error(`${path.basename(cmd)} exit ${c}: ${err.slice(-2200)}`)));
  });
}

const ff=()=>process.env.FFMPEG_PATH||ffmpegPath||'ffmpeg';
const escFilterPath=p=>p.replaceAll('\\','/').replaceAll(':','\\:').replaceAll("'","\\'");

function assTime(seconds){
  const total=Math.max(0,Number(seconds)||0);
  const h=Math.floor(total/3600);
  const m=Math.floor((total%3600)/60);
  const s=Math.floor(total%60);
  const cs=Math.floor((total-Math.floor(total))*100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function assText(value){
  return String(value||'')
    .replace(/\\/g,'\\\\')
    .replace(/[{}]/g,'')
    .replace(/\r?\n/g,'\\N')
    .trim();
}

async function writeSceneAss(file,text,duration){
  const clean=assText(text);
  const dialogue=clean
    ? `Dialogue: 0,0:00:00.00,${assTime(duration)},Main,,0,0,0,,{\\fad(180,220)}${clean}`
    : '';
  const ass=`[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,DejaVu Sans,54,&H00FFFFFF,&H00FFFFFF,&H70000000,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,2,95,95,395,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogue}
`;
  await fs.writeFile(file,ass,'utf8');
}

export async function renderProject(project,plan,musicId,onProgress=async()=>{}){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),`ngs-${project.id.slice(0,8)}-`));
  try{
    const scenes=normalizeSceneDurations(plan.scenes,project.duration),segs=[];
    for(let i=0;i<scenes.length;i++){
      const s=scenes[i];
      const m=(await q('select * from media where id=$1',[s.imageId])).rows[0];
      if(!m)throw new Error(`Thiếu ảnh scene ${i+1}`);

      const img=path.join(tmp,`s${i}.jpg`);
      const out=path.join(tmp,`v${i}.mp4`);
      const ass=path.join(tmp,`s${i}.ass`);
      await fs.writeFile(img,m.data);
      await writeSceneAss(ass,s.text,s.duration);

      const dur=Number(s.duration);
      const frames=Math.max(1,Math.round(dur*30));
      const zoom=s.motion==='pull_out'
        ? `z='if(eq(on,1),1.08,max(zoom-0.0007,1.0))'`
        : `z='min(zoom+0.0007,1.08)'`;
      const textFilter=String(s.text||'').trim()?`,ass=filename='${escFilterPath(ass)}'`:'';
      const filter=`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28[bg];[0:v]scale=980:1680:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=${zoom}:d=${frames}:s=1080x1920:fps=30${textFilter},fade=t=in:st=0:d=.18,fade=t=out:st=${Math.max(0,dur-.2)}:d=.2,format=yuv420p[v]`;

      await run(ff(),['-y','-loop','1','-t',String(dur),'-i',img,'-filter_complex',filter,'-map','[v]','-an','-r','30','-c:v','libx264','-preset','veryfast','-crf','21','-movflags','+faststart',out]);
      segs.push(out);
      await onProgress(70+Math.round((i+1)/scenes.length*15),`Đang dựng scene ${i+1}/${scenes.length}`);
    }

    const list=path.join(tmp,'concat.txt');
    await fs.writeFile(list,segs.map(x=>`file '${x.replaceAll("'","'\\''")}'`).join('\n'));
    const silent=path.join(tmp,'silent.mp4');
    await run(ff(),['-y','-f','concat','-safe','0','-i',list,'-c','copy',silent]);
    const final=path.join(tmp,'final.mp4');

    if(musicId){
      const m=(await q('select * from media where id=$1',[musicId])).rows[0];
      if(m){
        const mp=path.join(tmp,'music.bin');
        await fs.writeFile(mp,m.data);
        const fo=Math.max(0,project.duration-1.2);
        await run(ff(),['-y','-i',silent,'-stream_loop','-1','-i',mp,'-t',String(project.duration),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af',`loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=.5,afade=t=out:st=${fo}:d=1.2`,'-movflags','+faststart',final]);
      }else await fs.copyFile(silent,final);
    }else await fs.copyFile(silent,final);

    const data=await fs.readFile(final),outId=newid();
    await q('insert into media(id,owner_id,kind,name,mime,data,meta,shared,created_at) values($1,$2,$3,$4,$5,$6,$7,true,now())',[outId,project.owner_id,'video',`${plan.title||project.id}.mp4`,'video/mp4',data,{generatedBy:'ffmpeg',projectId:project.id,textRenderer:'libass'}]);
    return outId;
  }finally{
    await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{});
  }
}
