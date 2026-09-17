package org.ngsmedia.agnesbatch;

import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import androidx.media3.common.*;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.IntConsumer;

@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class MediaManager {
    private final Context context;
    private final Handler main=new Handler(Looper.getMainLooper());
    public MediaManager(Context c){context=c.getApplicationContext();}
    public static long duration(File file)throws IOException{
        MediaMetadataRetriever r=new MediaMetadataRetriever();
        try{
            r.setDataSource(file.getAbsolutePath());String text=r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long duration=text==null?0:Long.parseLong(text);if(duration<=0)throw new IOException("File tải về không phải video hợp lệ.");return duration;
        }catch(RuntimeException e){throw new IOException("Không đọc được video tải về.",e);}finally{r.release();}
    }
    public static void stripAudio(File input,File output,AgnesClient.Cancel cancel)throws IOException{
        MediaExtractor extractor=new MediaExtractor();MediaMuxer muxer=null;boolean started=false;
        try{
            extractor.setDataSource(input.getAbsolutePath());int track=-1;
            for(int i=0;i<extractor.getTrackCount();i++)if(extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME).startsWith("video/")){track=i;break;}
            if(track<0)throw new IOException("Video không có track hình.");
            MediaFormat format=extractor.getTrackFormat(track);extractor.selectTrack(track);muxer=new MediaMuxer(output.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            if(format.containsKey(MediaFormat.KEY_ROTATION))muxer.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION));
            int outputTrack=muxer.addTrack(format);muxer.start();started=true;int capacity=format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)?format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE):2*1024*1024;
            ByteBuffer buffer=ByteBuffer.allocateDirect(Math.max(capacity,2*1024*1024));MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
            while(extractor.getSampleTime()>=0){
                if(cancel.stopped()||Thread.currentThread().isInterrupted())throw new InterruptedIOException("Đã tạm dừng.");
                long needed=extractor.getSampleSize();if(needed>32L*1024*1024)throw new IOException("Video sample quá lớn.");if(needed>buffer.capacity())buffer=ByteBuffer.allocateDirect((int)needed);
                buffer.clear();int n=extractor.readSampleData(buffer,0);if(n<0)break;
                info.set(0,n,extractor.getSampleTime(),extractor.getSampleFlags()&MediaExtractor.SAMPLE_FLAG_SYNC);
                muxer.writeSampleData(outputTrack,buffer,info);extractor.advance();
            }
            muxer.stop();started=false;
        }catch(RuntimeException e){throw new IOException("Không tắt được tiếng video.",e);}finally{
            extractor.release();if(muxer!=null){try{if(started)muxer.stop();}catch(Exception ignored){}muxer.release();}
        }
        duration(output);
    }
    public String publish(File file,String displayName)throws IOException{
        ContentResolver resolver=context.getContentResolver();ContentValues values=new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME,displayName);values.put(MediaStore.Video.Media.MIME_TYPE,"video/mp4");values.put(MediaStore.Video.Media.RELATIVE_PATH,Environment.DIRECTORY_MOVIES+"/AgnesBatch");values.put(MediaStore.Video.Media.IS_PENDING,1);
        Uri uri=resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new IOException("Không tạo được video trong thư viện.");
        try{
            try(InputStream in=new FileInputStream(file);OutputStream out=resolver.openOutputStream(uri,"w")){if(out==null)throw new IOException("Không ghi được video.");byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))>=0)out.write(bytes,0,n);}
            values.clear();values.put(MediaStore.Video.Media.IS_PENDING,0);resolver.update(uri,values,null,null);return uri.toString();
        }catch(Exception e){resolver.delete(uri,null,null);throw new IOException("Không lưu được video vào Movies/AgnesBatch. Bản trong app vẫn còn.",e);}
    }
    public void merge(AppStore.Batch batch,File output,AgnesClient.Cancel cancel,IntConsumer progress)throws IOException{
        if(!QueueRules.mayMerge(batch.scenes.size(),batch.done()))throw new IOException("Cần hoàn tất tất cả cảnh trước khi ghép.");
        List<VideoOrder.Item> inputs=new ArrayList<>();for(AppStore.Scene s:batch.scenes)inputs.add(new VideoOrder.Item(s.index,s.status,s.clipFile));
        List<VideoOrder.Item> ordered=VideoOrder.timeline(batch.scenes.size(),inputs);
        List<EditedMediaItem> items=new ArrayList<>();
        for(VideoOrder.Item s:ordered){File f=new File(s.path);if(!f.isFile())throw new IOException("Thiếu video cảnh "+s.index+".");duration(f);
            items.add(new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(f))).setRemoveAudio(batch.settings.mute).setFrameRate(24).build());}
        int[] wh=dimensions(batch.settings.ratio,batch.settings.size);
        EditedMediaItemSequence sequence=new EditedMediaItemSequence.Builder(items).build();
        Effects effects=new Effects(Collections.emptyList(),Collections.singletonList(Presentation.createForWidthAndHeight(wh[0],wh[1],Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP)));
        Composition composition=new Composition.Builder(sequence).setEffects(effects).experimentalSetForceAudioTrack(!batch.settings.mute).build();
        CountDownLatch finished=new CountDownLatch(1);AtomicReference<IOException> error=new AtomicReference<>();AtomicReference<Transformer> active=new AtomicReference<>();AtomicBoolean stopped=new AtomicBoolean();
        if(output.exists()&&!output.delete())throw new IOException("Không xóa được file ghép tạm.");
        main.post(()->{
            if(stopped.get()){finished.countDown();return;}
            try{
                Transformer transformer=new Transformer.Builder(context).setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .addListener(new Transformer.Listener(){
                        @Override public void onCompleted(Composition c,ExportResult r){finished.countDown();}
                        @Override public void onError(Composition c,ExportResult r,ExportException e){error.compareAndSet(null,new IOException("Ghép video lỗi: "+e.getMessage(),e));finished.countDown();}
                    }).build();
                active.set(transformer);transformer.start(composition,output.getAbsolutePath());
                main.post(new Runnable(){@Override public void run(){if(finished.getCount()==0||stopped.get())return;ProgressHolder holder=new ProgressHolder();if(transformer.getProgress(holder)==Transformer.PROGRESS_STATE_AVAILABLE)progress.accept(holder.progress);main.postDelayed(this,1000);}});
            }catch(RuntimeException e){error.set(new IOException("Không khởi động được bộ ghép video.",e));finished.countDown();}
        });
        long start=System.currentTimeMillis();
        try{
            while(!finished.await(500,TimeUnit.MILLISECONDS))if(cancel.stopped()||System.currentTimeMillis()-start>30*60*1000L){stopped.set(true);main.post(()->{Transformer t=active.get();if(t!=null)t.cancel();});throw new InterruptedIOException("Ghép bị dừng hoặc quá 30 phút. Các cảnh đã lưu vẫn còn.");}
        }catch(InterruptedException e){stopped.set(true);main.post(()->{Transformer t=active.get();if(t!=null)t.cancel();});Thread.currentThread().interrupt();throw new InterruptedIOException("Đã tạm dừng ghép.");}
        if(error.get()!=null)throw error.get();duration(output);progress.accept(100);
    }
    private static int[] dimensions(String ratio,String size){
        int multiplier=size.equals("1080P")?3: size.equals("2K")?4:2;
        switch(ratio){
            case "16:9":return new int[]{640*multiplier,360*multiplier};case "1:1":return new int[]{360*multiplier,360*multiplier};
            case "4:3":return new int[]{480*multiplier,360*multiplier};case "3:4":return new int[]{360*multiplier,480*multiplier};
            case "21:9":return new int[]{840*multiplier,360*multiplier};default:return new int[]{360*multiplier,640*multiplier};
        }
    }
}
