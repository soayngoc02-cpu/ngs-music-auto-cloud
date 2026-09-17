package org.ngsmedia.agnesbatch;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class BatchService extends Service {
    public static final String RUN="RUN",MERGE="MERGE",PAUSE="PAUSE";
    public static volatile boolean busy;
    private static volatile BatchService busyOwner;
    private volatile boolean canceled;
    private final ExecutorService coordinator=Executors.newSingleThreadExecutor();
    private ExecutorService workers;
    private AppStore store;private KeyVault vault;private MediaManager media;private PowerManager.WakeLock wake;
    private final AtomicInteger keyCursor=new AtomicInteger();
    private final Map<String,Long> cooldowns=new ConcurrentHashMap<>();
    @Override public void onCreate(){super.onCreate();store=AppStore.get(this);vault=new KeyVault(this);media=new MediaManager(this);getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("batch","Tạo video Agnes",NotificationManager.IMPORTANCE_LOW));}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();if(PAUSE.equals(action)){if(busy)pause();else stopSelf();return START_NOT_STICKY;}
        if(busy)return START_NOT_STICKY;
        AppStore.Batch batch=store.batch();if(batch==null){stopSelf();return START_NOT_STICKY;}
        busy=true;canceled=false;
        busyOwner=this;
        try{
            store.updateBatch(batch.id,b->b.started=true);
            int type=ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            if(Build.VERSION.SDK_INT>=35&&MERGE.equals(action))type=ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING;
            startForeground(1,notification("Đang chuẩn bị…"),type);
            wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"AgnesBatch:Queue");wake.acquire(6*60*60*1000L);
        }catch(RuntimeException e){if(busyOwner==this){busy=false;busyOwner=null;}try{store.updateBatch(batch.id,b->b.message="Không chạy được nền: "+e.getMessage());}catch(RuntimeException ignored){}android.widget.Toast.makeText(this,"Không khởi động được. Kiểm tra bộ nhớ và quyền chạy nền.",android.widget.Toast.LENGTH_LONG).show();stopSelf();return START_NOT_STICKY;}
        coordinator.submit(()->{
            try{if(MERGE.equals(action))merge(batch.id);else runBatch(batch.id);}
            catch(Exception e){store.updateBatch(batch.id,b->b.message=safeError(e));}
            finally{if(workers!=null)workers.shutdownNow();if(busyOwner==this){busy=false;busyOwner=null;}if(wake!=null&&wake.isHeld())wake.release();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();broadcast();}
        });return START_NOT_STICKY;
    }
    private Notification notification(String text){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pause=PendingIntent.getService(this,1,new Intent(this,BatchService.class).setAction(PAUSE),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,"batch").setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("Agnes Batch").setContentText(text).setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Tạm dừng",pause).build()).build();
    }
    private void notifyProgress(String text){getSystemService(NotificationManager.class).notify(1,notification(text));}
    private void broadcast(){sendBroadcast(new Intent(AppStore.CHANGED).setPackage(getPackageName()));}
    private void pause(){canceled=true;broadcast();}
    @Override public void onTimeout(int startId,int fgsType){
        canceled=true;if(workers!=null)workers.shutdownNow();AppStore.Batch b=store.batch();if(b!=null)store.updateBatch(b.id,x->x.message="Android tạm dừng chạy nền sau thời gian dài. Mở app và bấm Tiếp tục để kiểm tra các job đã gửi.");stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
    }
    @Override public void onDestroy(){canceled=true;if(workers!=null)workers.shutdownNow();coordinator.shutdownNow();if(busyOwner==this){busy=false;busyOwner=null;}if(wake!=null&&wake.isHeld())wake.release();super.onDestroy();}
    private String safeError(Exception e){return vault.redact(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}
    private boolean stopped(){return canceled||Thread.currentThread().isInterrupted();}
    private void delay(long ms)throws InterruptedException{
        long end=System.currentTimeMillis()+ms;while(!stopped()&&System.currentTimeMillis()<end)Thread.sleep(Math.min(500,Math.max(1,end-System.currentTimeMillis())));
        if(stopped())throw new InterruptedException();
    }
    private KeyVault.Entry chooseKey()throws Exception{
        while(!stopped()){
            List<KeyVault.Entry> enabled=new ArrayList<>();for(KeyVault.Entry e:vault.entries())if(e.enabled)enabled.add(e);
            if(enabled.isEmpty())throw new IOException("Chưa có API key đang bật. Hãy nhập key ở màn hình API.");
            int start=Math.floorMod(keyCursor.getAndIncrement(),enabled.size());long wait=Long.MAX_VALUE,now=System.currentTimeMillis();
            for(int i=0;i<enabled.size();i++){KeyVault.Entry e=enabled.get((start+i)%enabled.size());long until=cooldowns.getOrDefault(e.id,0L);if(until<=now)return e;wait=Math.min(wait,until-now);}
            delay(Math.min(wait,2000));
        }throw new InterruptedException();
    }
    private void runBatch(String batchId)throws Exception{
        AppStore.Batch batch=store.batch();store.updateBatch(batchId,b->b.message="Đang chạy hàng đợi…");
        workers=Executors.newFixedThreadPool(Math.max(1,Math.min(3,batch.settings.concurrency)));List<Future<?>> futures=new ArrayList<>();
        for(AppStore.Scene s:batch.scenes)if(!s.status.equals("DONE")&&!s.status.equals("ERROR")&&!s.status.equals("UNCERTAIN"))futures.add(workers.submit(()->process(batchId,s.index)));
        for(Future<?> f:futures)try{f.get();}catch(ExecutionException e){store.updateBatch(batchId,b->b.message="Hàng đợi bị gián đoạn: "+safeError(new Exception(e.getCause())));}
        if(stopped())return;batch=store.batch();notifyProgress("Đã lưu "+batch.done()+"/"+batch.scenes.size()+" cảnh");
        if(QueueRules.mayMerge(batch.scenes.size(),batch.done())&&batch.settings.autoMerge)merge(batchId);
        else store.updateBatch(batchId,b->b.message=b.done()==b.scenes.size()?"Tất cả cảnh đã lưu. Bấm Ghép video để xuất.":"Đã xử lý hàng đợi. Kiểm tra cảnh lỗi rồi bấm Chạy lại.");
    }
    private void process(String id,int index){
        if(stopped())return;
        try{
            AppStore.Batch batch=store.batch();AppStore.Scene scene=batch.scene(index);AgnesClient client=new AgnesClient(batch.settings.base);
            if(scene.videoId.isEmpty()){
                if(scene.status.equals("SUBMITTING")){store.updateScene(id,index,s->{s.status="UNCERTAIN";s.error="Yêu cầu trước chưa rõ kết quả. Kiểm tra Agnes trước khi tạo lại.";});return;}
                KeyVault.Entry entry=chooseKey();String sceneImage=scene.imageUrl;
                if(sceneImage.isEmpty()&&!scene.imageFile.isEmpty()){
                    store.updateScene(id,index,s->{s.status="UPLOADING";s.error="";});
                    AppStore.Settings upload=store.settings();sceneImage=AgnesClient.uploadImage(upload.cloud,upload.preset,new File(scene.imageFile),this::stopped);String uploaded=sceneImage;
                    store.updateScene(id,index,s->{s.imageUrl=uploaded;s.status="PENDING";});
                }
                List<PromptReferences.Identity> identities=new ArrayList<>();for(AppStore.Character c:batch.characters)identities.add(new PromptReferences.Identity(c.tag,c.name,c.url));
                PromptReferences.Result composed=PromptReferences.compose(scene.prompt,sceneImage,identities);
                Map<String,Object> body=AgnesClient.videoBody(batch.settings.model,composed.prompt,scene.seconds,batch.settings.ratio,batch.settings.size,composed.images,composed.firstFrame,batch.settings.avoidSpeech);
                if(stopped())return;
                store.updateScene(id,index,s->{s.status="SUBMITTING";s.keyId=entry.id;s.error="";});
                Map<String,Object> result;
                try{result=client.createVideo(entry.key,body);}
                catch(AgnesClient.ApiException e){
                    if(e.code==429){cooldowns.put(entry.id,System.currentTimeMillis()+QueueRules.backoff(2,e.retryAfterSeconds));store.updateScene(id,index,s->{s.status="ERROR";s.error="API giới hạn tốc độ. Đợi rồi bấm Chạy lại. "+safeError(e);});}
                    else if(e.code>=500){store.updateScene(id,index,s->{s.status="UNCERTAIN";s.error="Server lỗi sau khi gửi; chưa rõ job đã tạo chưa. Kiểm tra Agnes trước khi tạo lại.";});}
                    else store.updateScene(id,index,s->{s.status="ERROR";s.error=safeError(e);});return;
                }catch(IOException e){store.updateScene(id,index,s->{s.status="UNCERTAIN";s.error="Mất kết nối khi gửi. Kiểm tra job trên Agnes trước khi xác nhận tạo lại.";});return;}
                String videoId=AgnesClient.videoId(result);if(videoId.isEmpty()){store.updateScene(id,index,s->{s.status="UNCERTAIN";s.error="API nhận request nhưng không trả ID. Kiểm tra Agnes trước khi tạo lại.";});return;}
                store.updateScene(id,index,s->{s.videoId=videoId;s.status="RUNNING";s.progress=(int)Json.num(result,"progress",0);});
                scene=store.batch().scene(index);
            }
            String key=vault.key(scene.keyId);long start=System.currentTimeMillis();int failure=0;String url=scene.remoteUrl;
            while(url.isEmpty()&&!stopped()){
                if(System.currentTimeMillis()-start>45*60*1000L)throw new IOException("Job quá 45 phút. ID vẫn được giữ; bấm Chạy lại để kiểm tra tiếp.");
                Map<String,Object> result;
                try{result=client.poll(key,scene.videoId,batch.settings.model);failure=0;}
                catch(AgnesClient.ApiException e){if(e.code==429||e.code>=500){long backoff=QueueRules.backoff(failure++,e.retryAfterSeconds);if(e.code==429)cooldowns.put(scene.keyId,System.currentTimeMillis()+backoff);delay(backoff);continue;}throw e;}
                catch(IOException e){if(++failure>6)throw e;delay(QueueRules.backoff(failure,0));continue;}
                String status=Json.str(result,"status","");int progress=(int)Json.num(result,"progress",0);
                store.updateScene(id,index,s->{s.progress=progress;s.status="RUNNING";});
                if(status.equals("failed")){String message=Json.str(Json.map(result.get("error")),"message","Agnes tạo video thất bại.");store.updateScene(id,index,s->{s.status="ERROR";s.remoteFailed=true;s.error=vault.redact(message);});return;}
                if(status.equals("completed")){url=AgnesClient.videoUrl(result);if(url.isEmpty())throw new IOException("Job đã xong nhưng chưa trả URL. Bấm Chạy lại để kiểm tra tiếp.");String resultUrl=url;store.updateScene(id,index,s->{s.remoteUrl=resultUrl;s.status="DOWNLOADING";});break;}
                delay(4000);
            }
            if(stopped())return;
            File dir=store.batchDirectory(id),temp=new File(dir,String.format(Locale.ROOT,"%03d.download",index)),processed=new File(dir,String.format(Locale.ROOT,"%03d.part.mp4",index)),clip=new File(dir,String.format(Locale.ROOT,"%03d.mp4",index));
            store.updateScene(id,index,s->s.status="DOWNLOADING");AgnesClient.download(url,temp,this::stopped);MediaManager.duration(temp);
            if(batch.settings.mute)MediaManager.stripAudio(temp,processed,this::stopped);
            else if(!temp.renameTo(processed))throw new IOException("Không đổi tên được video vừa tải.");
            if(stopped())return;if(clip.exists()&&!clip.delete())throw new IOException("Không ghi đè được cảnh.");if(!processed.renameTo(clip))throw new IOException("Không hoàn tất được file cảnh.");temp.delete();
            long actual=MediaManager.duration(clip);String warning=Math.abs(actual-scene.seconds*1000L)>150?"Agnes trả "+String.format(Locale.ROOT,"%.2f",actual/1000.0)+"s, yêu cầu "+scene.seconds+"s.":"";
            String publicUri="";try{publicUri=media.publish(clip,"Agnes_"+id+"_"+String.format(Locale.ROOT,"%03d",index)+".mp4");}catch(IOException e){warning+=(warning.isEmpty()?"":" ")+e.getMessage();}
            String saved=publicUri,warn=warning;store.updateScene(id,index,s->{s.clipFile=clip.getAbsolutePath();s.publicUri=saved;s.warning=warn;s.status="DONE";s.progress=100;s.error="";});
            AppStore.Batch current=store.batch();notifyProgress("Đã lưu "+current.done()+"/"+current.scenes.size()+" cảnh");
        }catch(InterruptedException|InterruptedIOException e){Thread.currentThread().interrupt();}
        catch(Exception e){if(!stopped())store.updateScene(id,index,s->{if(s.status.equals("SUBMITTING")&&s.videoId.isEmpty())s.status="UNCERTAIN";else s.status="ERROR";s.error=safeError(e);});}
    }
    private void merge(String id)throws Exception{
        AppStore.Batch batch=store.batch();if(!QueueRules.mayMerge(batch.scenes.size(),batch.done()))throw new IOException("Cần tạo xong tất cả cảnh mới ghép được.");
        if(Build.VERSION.SDK_INT>=35)startForeground(1,notification("Đang ghép video…"),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        File temp=new File(store.batchDirectory(id),"merged.part.mp4"),merged=new File(store.batchDirectory(id),"merged.mp4");store.updateBatch(id,b->{b.mergeStatus="MERGING";b.mergeProgress=0;b.mergeError="";});
        try{
            media.merge(batch,temp,this::stopped,p->store.updateBatch(id,b->b.mergeProgress=p));
            if(stopped())throw new InterruptedIOException("Đã tạm dừng.");if(merged.exists()&&!merged.delete())throw new IOException("Không đổi được bản ghép cũ.");if(!temp.renameTo(merged))throw new IOException("Không lưu được bản ghép.");
            String uri="",warning="";try{uri=media.publish(merged,"Agnes_"+id+"_FULL.mp4");}catch(IOException e){warning=e.getMessage();}
            String published=uri,message=warning.isEmpty()?"Video tổng đã lưu vào Movies/AgnesBatch.":warning;
            store.updateBatch(id,b->{b.mergedFile=merged.getAbsolutePath();b.mergedUri=published;b.mergeStatus="DONE";b.mergeProgress=100;b.message=message;});
        }catch(Exception e){store.updateBatch(id,b->{b.mergeStatus="ERROR";b.mergeError=safeError(e);});throw e;}
    }
}
