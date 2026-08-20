(()=>{
  const btn=document.querySelector('#createBtn');
  const styleEl=document.querySelector('#visualStyle');
  if(!btn||!styleEl)return;

  btn.onclick=async()=>{
    btn.disabled=true;
    btn.textContent='ĐANG KHỞI TẠO...';
    try{
      const rawIdea=document.querySelector('#idea')?.value||'';
      const style=styleEl.value==='illustration'?'illustration':'realistic';
      const idea=style==='illustration'?`${rawIdea.trim()}${rawIdea.trim()?'\n\n':''}[NGS_VISUAL_STYLE:illustration]`:rawIdea;
      const r=await fetch('/api/projects',{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          idea,
          duration:Number(document.querySelector('#duration')?.value||20),
          music_mode:document.querySelector('#musicMode')?.value||'auto'
        })
      });
      const ct=r.headers.get('content-type')||'';
      const data=ct.includes('json')?await r.json():await r.text();
      if(!r.ok)throw new Error(data?.error||String(data)||`HTTP ${r.status}`);
      const id=data.project.id;
      if(typeof renderLive==='function')renderLive({id,status:'queued',progress:0,message:`Đã xếp hàng · ${style==='realistic'?'ảnh thực tế người thật':'minh họa'}`});
      if(typeof startPoll==='function')startPoll(id);
      if(typeof showView==='function')showView('create');
    }catch(e){alert(e.message||e)}
    finally{btn.disabled=false;btn.textContent='✦ TẠO VIDEO'}
  };
})();
