package org.ngsmedia.agnesbatch;

import android.content.*;
import android.os.Environment;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Consumer;

public final class AppStore {
    public static final String CHANGED="org.ngsmedia.agnesbatch.CHANGED";
    private static AppStore instance;
    public static synchronized AppStore get(Context c){if(instance==null)instance=new AppStore(c.getApplicationContext());return instance;}
    public static final class Settings {
        public String base="https://apihub.agnes-ai.com",model="agnes-video-2.5-flash",ratio="9:16",size="720P",cloud="",preset="";
        public int seconds=5,concurrency=2;public boolean mute=true,avoidSpeech=true,autoMerge=true;
        Map<String,Object> json(){return Json.obj("base",base,"model",model,"ratio",ratio,"size",size,"seconds",seconds,"concurrency",concurrency,"mute",mute,"avoidSpeech",avoidSpeech,"autoMerge",autoMerge,"cloud",cloud,"preset",preset);}
        static Settings from(Object o){Map<String,Object> m=Json.map(o);Settings s=new Settings();s.base=Json.str(m,"base",s.base);s.model=Json.str(m,"model",s.model);s.ratio=Json.str(m,"ratio",s.ratio);s.size=Json.str(m,"size",s.size);s.seconds=(int)Json.num(m,"seconds",5);s.concurrency=(int)Json.num(m,"concurrency",2);s.mute=Json.bool(m,"mute",true);s.avoidSpeech=Json.bool(m,"avoidSpeech",true);s.autoMerge=Json.bool(m,"autoMerge",true);s.cloud=Json.str(m,"cloud","");s.preset=Json.str(m,"preset","");return s;}
    }
    public static final class Character {
        public String tag="",name="",description="",url="",localFile="";
        Map<String,Object> json(){return Json.obj("tag",tag,"name",name,"description",description,"url",url,"localFile",localFile);}
        static Character from(Object o){Map<String,Object> m=Json.map(o);Character c=new Character();c.tag=Json.str(m,"tag","");c.name=Json.str(m,"name","");c.description=Json.str(m,"description","");c.url=Json.str(m,"url","");c.localFile=Json.str(m,"localFile","");return c;}
    }
    public static final class Scene {
        public int index,seconds,progress;public boolean explicit,remoteFailed;
        public String prompt="",status="PENDING",error="",warning="",videoId="",keyId="",remoteUrl="",imageUrl="",imageFile="",clipFile="",publicUri="";
        Map<String,Object> json(){return Json.obj("index",index,"seconds",seconds,"progress",progress,"explicit",explicit,"prompt",prompt,"status",status,"error",error,"warning",warning,"videoId",videoId,"keyId",keyId,"remoteUrl",remoteUrl,"remoteFailed",remoteFailed,"imageUrl",imageUrl,"imageFile",imageFile,"clipFile",clipFile,"publicUri",publicUri);}
        static Scene from(Object o){Map<String,Object> m=Json.map(o);Scene s=new Scene();s.index=(int)Json.num(m,"index",0);s.seconds=(int)Json.num(m,"seconds",5);s.progress=(int)Json.num(m,"progress",0);s.explicit=Json.bool(m,"explicit",false);s.remoteFailed=Json.bool(m,"remoteFailed",false);s.prompt=Json.str(m,"prompt","");s.status=Json.str(m,"status","PENDING");s.error=Json.str(m,"error","");s.warning=Json.str(m,"warning","");s.videoId=Json.str(m,"videoId","");s.keyId=Json.str(m,"keyId","");s.remoteUrl=Json.str(m,"remoteUrl","");s.imageUrl=Json.str(m,"imageUrl","");s.imageFile=Json.str(m,"imageFile","");s.clipFile=Json.str(m,"clipFile","");s.publicUri=Json.str(m,"publicUri","");return s;}
    }
    public static final class Batch {
        public String id="",name="",mergedFile="",mergedUri="",mergeStatus="",mergeError="",message="";
        public int mergeProgress;public boolean started;public Settings settings=new Settings();public List<Scene> scenes=new ArrayList<>();public List<Character> characters=new ArrayList<>();
        public int done(){int n=0;for(Scene s:scenes)if(s.status.equals("DONE"))n++;return n;}
        Map<String,Object> json(){List<Object> ss=new ArrayList<>(),cc=new ArrayList<>();for(Scene s:scenes)ss.add(s.json());for(Character c:characters)cc.add(c.json());return Json.obj("id",id,"name",name,"settings",settings.json(),"scenes",ss,"characters",cc,"started",started,"mergedFile",mergedFile,"mergedUri",mergedUri,"mergeStatus",mergeStatus,"mergeProgress",mergeProgress,"mergeError",mergeError,"message",message);}
        static Batch from(Object o){Map<String,Object> m=Json.map(o);Batch b=new Batch();b.id=Json.str(m,"id","");b.name=Json.str(m,"name","");b.started=Json.bool(m,"started",false);b.settings=Settings.from(m.get("settings"));for(Object s:Json.list(m.get("scenes")))b.scenes.add(Scene.from(s));for(Object c:Json.list(m.get("characters")))b.characters.add(Character.from(c));b.mergedFile=Json.str(m,"mergedFile","");b.mergedUri=Json.str(m,"mergedUri","");b.mergeStatus=Json.str(m,"mergeStatus","");b.mergeError=Json.str(m,"mergeError","");b.mergeProgress=(int)Json.num(m,"mergeProgress",0);b.message=Json.str(m,"message","");return b;}
        public Scene scene(int index){for(Scene s:scenes)if(s.index==index)return s;throw new IllegalArgumentException("Không có cảnh "+index);}
    }
    private final Context context;private final AtomicFile file;private Settings settings=new Settings();private List<Character> characters=new ArrayList<>();private Batch batch;
    private AppStore(Context c){
        context=c;file=new AtomicFile(new File(c.getFilesDir(),"state.json"));
        if(file.getBaseFile().exists())try{
            Map<String,Object> m=Json.map(Json.parse(new String(file.readFully(),StandardCharsets.UTF_8)));settings=Settings.from(m.get("settings"));for(Object o:Json.list(m.get("characters")))characters.add(Character.from(o));if(m.get("batch")!=null)batch=Batch.from(m.get("batch"));
            if(batch!=null){for(Scene s:batch.scenes)if(QueueRules.uncertainSubmission(s.status,s.videoId)){s.status="UNCERTAIN";s.error="App dừng trong lúc gửi yêu cầu. Kiểm tra job trên Agnes trước khi xác nhận tạo lại.";}if(batch.mergeStatus.equals("MERGING")){batch.mergeStatus="ERROR";batch.mergeError="Lần ghép trước bị gián đoạn. Có thể bấm ghép lại.";}}
        }catch(Exception e){throw new IllegalStateException("Không đọc được tiến độ đã lưu. Hãy giữ dữ liệu ứng dụng và liên hệ hỗ trợ.",e);}
    }
    private synchronized void save(){
        List<Object> cc=new ArrayList<>();for(Character c:characters)cc.add(c.json());
        byte[] bytes=Json.stringify(Json.obj("settings",settings.json(),"characters",cc,"batch",batch==null?null:batch.json())).getBytes(StandardCharsets.UTF_8);
        FileOutputStream out=null;try{
            if(batch!=null){AtomicFile archive=new AtomicFile(new File(batchDirectory(batch.id),"batch.json"));FileOutputStream archived=null;try{archived=archive.startWrite();archived.write(Json.stringify(batch.json()).getBytes(StandardCharsets.UTF_8));archive.finishWrite(archived);}catch(IOException e){if(archived!=null)archive.failWrite(archived);throw e;}}
            out=file.startWrite();out.write(bytes);file.finishWrite(out);
        }catch(IOException e){if(out!=null)file.failWrite(out);throw new IllegalStateException("Không lưu được tiến độ. Kiểm tra bộ nhớ điện thoại.",e);}
        context.sendBroadcast(new Intent(CHANGED).setPackage(context.getPackageName()));
    }
    public synchronized Settings settings(){return Settings.from(settings.json());}
    public synchronized void setSettings(Settings value){
        settings=Settings.from(value.json());
        if(batch!=null){boolean untouched=true;for(Scene s:batch.scenes)if(!s.status.equals("PENDING")||!s.videoId.isEmpty())untouched=false;
            if(untouched&&!batch.started){batch.settings=Settings.from(settings.json());for(Scene s:batch.scenes)if(!s.explicit)s.seconds=settings.seconds;}}
        save();
    }
    public synchronized Batch batch(){return batch==null?null:Batch.from(batch.json());}
    public synchronized List<Character> characters(){List<Character> cc=new ArrayList<>();for(Character c:characters)cc.add(Character.from(c.json()));return cc;}
    public synchronized void putCharacter(Character c){characters.removeIf(x->x.tag.equals(c.tag));characters.add(Character.from(c.json()));save();}
    public synchronized void deleteCharacter(String tag){characters.removeIf(c->c.tag.equals(tag));save();}
    public synchronized Batch createBatch(String name,List<PromptParser.Prompt> prompts){
        Batch b=new Batch();b.id=System.currentTimeMillis()+"_"+UUID.randomUUID().toString().substring(0,6);b.name=name;b.settings=settings();
        Set<String> needed=new LinkedHashSet<>();for(PromptParser.Prompt p:prompts)needed.addAll(PromptParser.tags(p.text));
        for(String tag:needed){Character found=null;for(Character c:characters)if(c.tag.equals(tag))found=c;if(found==null||found.url.isEmpty())throw new IllegalArgumentException("Nhân vật @"+tag+" chưa có ảnh tham chiếu. Tạo sheet trước khi nhập TXT.");b.characters.add(Character.from(found.json()));}
        for(PromptParser.Prompt p:prompts){if(PromptParser.tags(p.text).size()>5)throw new IllegalArgumentException("Cảnh "+p.index+" có quá 5 nhân vật tham chiếu.");Scene s=new Scene();s.index=p.index;s.seconds=(int)p.seconds;s.prompt=p.text;s.explicit=p.explicitSeconds;b.scenes.add(s);}
        batch=b;batchDirectory(b.id);save();return batch();
    }
    public synchronized void updateScene(String id,int index,Consumer<Scene> change){if(batch==null||!batch.id.equals(id))return;change.accept(batch.scene(index));save();}
    public synchronized void updateBatch(String id,Consumer<Batch> change){if(batch==null||!batch.id.equals(id))return;change.accept(batch);save();}
    public synchronized void retry(int index,boolean confirmUncertain){
        if(batch==null)return;Scene s=batch.scene(index);
        if(s.status.equals("DONE"))throw new IllegalArgumentException("Cảnh này đã hoàn tất.");
        if(s.status.equals("UNCERTAIN")&&!confirmUncertain)throw new IllegalArgumentException("Cần xác nhận tạo lại yêu cầu chưa rõ kết quả.");
        if(s.status.equals("UNCERTAIN")||s.remoteFailed){s.videoId="";s.remoteUrl="";s.keyId="";s.remoteFailed=false;}
        s.status=s.videoId.isEmpty()?"PENDING":"RUNNING";s.error="";s.progress=0;
        batch.mergedFile="";batch.mergedUri="";batch.mergeStatus="";save();
    }
    public synchronized void attachImage(int index,String url,String path){
        Scene s=batch.scene(index);if(!s.status.equals("PENDING")||!s.videoId.isEmpty())throw new IllegalArgumentException("Chỉ gắn ảnh trước khi gửi cảnh.");
        if(PromptParser.tags(s.prompt).size()>=5&&(!url.isEmpty()||!path.isEmpty()))throw new IllegalArgumentException("Cảnh này đã dùng 5 sheet; không còn chỗ cho ảnh cảnh.");
        s.imageUrl=url;s.imageFile=path;save();
    }
    public synchronized List<Batch> history(){
        List<Batch> list=new ArrayList<>();File root=context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);File[] dirs=root==null?null:root.listFiles();
        if(dirs!=null)for(File dir:dirs){File saved=new File(dir,"batch.json");if(!saved.isFile())continue;try{list.add(Batch.from(Json.parse(new String(new AtomicFile(saved).readFully(),StandardCharsets.UTF_8))));}catch(Exception ignored){}}
        list.sort((a,b)->b.id.compareTo(a.id));return list;
    }
    public synchronized void openBatch(String id){
        if(!id.matches("[0-9]+_[a-f0-9]{6}"))throw new IllegalArgumentException("Lượt chạy không hợp lệ.");
        try{batch=Batch.from(Json.parse(new String(new AtomicFile(new File(batchDirectory(id),"batch.json")).readFully(),StandardCharsets.UTF_8)));for(Scene s:batch.scenes)if(QueueRules.uncertainSubmission(s.status,s.videoId)){s.status="UNCERTAIN";s.error="Yêu cầu trước chưa rõ kết quả; kiểm tra Agnes trước khi tạo lại.";}save();}catch(IOException e){throw new IllegalArgumentException("Không mở được lượt chạy đã lưu.",e);}
    }
    public File batchDirectory(String id){File root=context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);if(root==null)throw new IllegalStateException("Không mở được bộ nhớ video.");File dir=new File(root,id);if(!dir.exists()&&!dir.mkdirs())throw new IllegalStateException("Không tạo được thư mục video.");return dir;}
    public File characterDirectory(){File dir=new File(context.getFilesDir(),"characters");if(!dir.exists()&&!dir.mkdirs())throw new IllegalStateException("Không tạo được thư mục nhân vật.");return dir;}
}
