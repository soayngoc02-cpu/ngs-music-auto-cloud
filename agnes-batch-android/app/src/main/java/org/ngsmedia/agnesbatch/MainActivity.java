package org.ngsmedia.agnesbatch;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Native Android UI. File reading, uploads and image generation run off the UI thread. */
public final class MainActivity extends Activity {
    private static final int PROMPTS=100,KEYS=101,FRAME=102;
    private static final int BG=Color.rgb(16,20,30),CARD=Color.rgb(28,35,49),ACCENT=Color.rgb(139,255,202),WHITE=Color.rgb(236,240,247),MUTED=Color.rgb(163,174,195);
    private AppStore store;private KeyVault vault;
    private LinearLayout root,body,queue,outputs;private TextView summary,subtitle;private ProgressBar progress;
    private final ExecutorService io=Executors.newSingleThreadExecutor();private final Handler handler=new Handler(Looper.getMainLooper());
    private int tab,pendingImageIndex;private String pendingImageBatch="",fingerprint="";private volatile boolean localBusy;
    private final BroadcastReceiver receiver=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){refreshQueue();}};
    private final Runnable tick=new Runnable(){@Override public void run(){refreshQueue();handler.postDelayed(this,2000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        try{store=AppStore.get(this);vault=new KeyVault(this);}catch(Exception e){new AlertDialog.Builder(this).setTitle("Không mở được dữ liệu").setMessage(e.getMessage()).setPositiveButton("Đóng",(d,w)->finish()).show();return;}
        if(state!=null){tab=state.getInt("tab");pendingImageIndex=state.getInt("frame");pendingImageBatch=state.getString("frameBatch","");}
        showScreen(tab);
    }
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putInt("tab",tab);state.putInt("frame",pendingImageIndex);state.putString("frameBatch",pendingImageBatch);}
    @Override protected void onResume(){super.onResume();if(store==null)return;if(Build.VERSION.SDK_INT>=33)registerReceiver(receiver,new IntentFilter(AppStore.CHANGED),Context.RECEIVER_NOT_EXPORTED);else registerReceiver(receiver,new IntentFilter(AppStore.CHANGED));handler.post(tick);}
    @Override protected void onPause(){super.onPause();if(store!=null){unregisterReceiver(receiver);handler.removeCallbacks(tick);}}
    @Override protected void onDestroy(){io.shutdown();super.onDestroy();}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private GradientDrawable background(int color){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(16));return d;}
    private TextView text(LinearLayout parent,String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setLineSpacing(dp(3),1);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(10);parent.addView(t,p);return t;}
    private void title(LinearLayout parent,String value){TextView t=text(parent,value,21,WHITE);t.setTypeface(null,Typeface.BOLD);}
    private LinearLayout card(LinearLayout parent){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(16),dp(16),dp(16),dp(12));c.setBackground(background(CARD));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(14);parent.addView(c,p);return c;}
    private Button button(LinearLayout parent,String label,boolean primary,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(14);b.setTextColor(primary?BG:WHITE);b.setBackground(background(primary?ACCENT:Color.rgb(43,53,72)));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(48));p.bottomMargin=dp(8);parent.addView(b,p);b.setOnClickListener(v->{try{action.run();}catch(Exception e){alert(e.getMessage());}});return b;}
    private EditText input(LinearLayout parent,String hint,int lines,boolean secret){
        EditText e=new EditText(this);e.setHint(hint);e.setTextColor(WHITE);e.setHintTextColor(MUTED);e.setTextSize(14);e.setMinLines(lines);e.setMaxLines(Math.max(lines,4));e.setGravity(Gravity.TOP);e.setPadding(dp(10),dp(10),dp(10),dp(10));e.setBackground(background(Color.rgb(19,25,37)));e.setSaveEnabled(false);
        e.setInputType(secret?InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD:InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        if(secret){e.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);e.setSingleLine(true);}
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(12);parent.addView(e,p);return e;
    }
    private void choice(LinearLayout parent,String label,String[] values,String current,Consumer<String> changed){
        text(parent,label,13,MUTED);Spinner spinner=new Spinner(this);ArrayAdapter<String> adapter=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,values){
            @Override public View getView(int position,View convert,android.view.ViewGroup group){TextView t=(TextView)super.getView(position,convert,group);t.setTextColor(WHITE);t.setTextSize(15);t.setPadding(dp(8),dp(8),dp(8),dp(8));return t;}
        };adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);spinner.setAdapter(adapter);int initial=Math.max(0,Arrays.asList(values).indexOf(current));spinner.setSelection(initial);parent.addView(spinner,new LinearLayout.LayoutParams(-1,dp(44)));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){int last=initial;@Override public void onItemSelected(AdapterView<?> p,View v,int position,long id){if(position!=last){last=position;changed.accept(values[position]);}}@Override public void onNothingSelected(AdapterView<?> p){}});
    }
    private void checkbox(LinearLayout parent,String label,boolean current,Consumer<Boolean> changed){CheckBox box=new CheckBox(this);box.setText(label);box.setTextColor(WHITE);box.setTextSize(14);box.setChecked(current);parent.addView(box);box.setOnCheckedChangeListener((b,value)->changed.accept(value));}
    private void setting(Consumer<AppStore.Settings> change){AppStore.Settings s=store.settings();change.accept(s);store.setSettings(s);}
    private void showScreen(int selected){
        tab=selected;queue=null;outputs=null;fingerprint="";
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(0,insets.getSystemWindowInsetTop(),0,insets.getSystemWindowInsetBottom());return insets;});
        LinearLayout header=new LinearLayout(this);header.setOrientation(LinearLayout.VERTICAL);header.setPadding(dp(20),dp(16),dp(20),dp(4));root.addView(header);title(header,"Agnes Batch");subtitle=text(header,"TXT → video từng cảnh → video tổng",12,MUTED);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(18),dp(12),dp(18),dp(16));scroll.addView(body);
        LinearLayout nav=new LinearLayout(this);nav.setPadding(dp(6),dp(6),dp(6),dp(6));nav.setBackgroundColor(CARD);root.addView(nav);
        String[] tabs={"Video","Nhân vật","API key","Cài đặt"};for(int i=0;i<tabs.length;i++){final int target=i;Button b=new Button(this);b.setText(tabs[i]);b.setAllCaps(false);b.setTextSize(11);b.setTextColor(i==tab?BG:MUTED);b.setBackground(background(i==tab?ACCENT:CARD));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(46),1);p.setMargins(dp(3),0,dp(3),0);nav.addView(b,p);b.setOnClickListener(v->showScreen(target));}
        setContentView(root);
        if(tab==0)videoScreen();else if(tab==1)characterScreen();else if(tab==2)keyScreen();else settingsScreen();
    }
    private void videoScreen(){
        LinearLayout importCard=card(body);title(importCard,"Tạo một lượt video");text(importCard,"Tối đa 50 prompt. Mỗi prompt 1–2 dòng, cách nhau một dòng trắng.",13,MUTED);
        AppStore.Settings s=store.settings();
        choice(importCard,"Tỷ lệ khung hình",new String[]{"9:16","16:9","1:1","4:3","3:4","21:9"},s.ratio,v->setting(x->x.ratio=v));
        choice(importCard,"Số giây mặc định khi prompt không ghi thời lượng",new String[]{"4","5","6","7","8","9","10","11","12"},Integer.toString(s.seconds),v->setting(x->x.seconds=Integer.parseInt(v)));
        text(importCard,"Chọn trước khi chạy lần đầu. Prompt có số giây giữ thời lượng riêng.",11,MUTED);
        button(importCard,"＋ Nhập file prompt TXT",true,()->{if(!ensureIdle())return;pick(PROMPTS,"*/*");});
        button(importCard,"Lịch sử lượt chạy",false,this::history);
        LinearLayout active=card(body);summary=text(active,"Chưa có lượt chạy",18,WHITE);progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);active.addView(progress,new LinearLayout.LayoutParams(-1,dp(12)));
        button(active,"▶ Chạy / tiếp tục",true,()->start(BatchService.RUN));
        button(active,"Ⅱ Tạm dừng",false,()->{if(BatchService.busy){startService(new Intent(this,BatchService.class).setAction(BatchService.PAUSE));toast("Đang tạm dừng. Các job đã gửi vẫn được Agnes xử lý.");}});
        button(active,"↻ Chạy lại các cảnh lỗi",false,this::retryAll);
        button(active,"Ghép video theo thứ tự",false,()->start(BatchService.MERGE));
        outputs=new LinearLayout(this);outputs.setOrientation(LinearLayout.VERTICAL);body.addView(outputs);
        queue=new LinearLayout(this);queue.setOrientation(LinearLayout.VERTICAL);body.addView(queue);refreshQueue();
    }
    private String stateLabel(String status){switch(status){case "PENDING":return "Chờ chạy";case "UPLOADING":return "Đang đưa ảnh lên";case "SUBMITTING":return "Đang gửi";case "RUNNING":return "Đang tạo";case "MERGING":return "Đang ghép";case "DOWNLOADING":return "Đang lưu";case "DONE":return "Đã lưu";case "ERROR":return "Lỗi";case "UNCERTAIN":return "Cần kiểm tra job";default:return status;}}
    private void refreshQueue(){
        if(store==null||tab!=0||queue==null)return;AppStore.Batch b=store.batch();
        if(b==null){summary.setText("Chưa có lượt chạy");progress.setProgress(0);return;}
        summary.setText(b.name+"\n"+b.done()+" / "+b.scenes.size()+" cảnh đã lưu"+(BatchService.busy?" · đang chạy":""));progress.setProgress(b.scenes.isEmpty()?0:b.done()*100/b.scenes.size());
        String hash=Json.stringify(b.json())+BatchService.busy;if(hash.equals(fingerprint))return;fingerprint=hash;queue.removeAllViews();outputs.removeAllViews();
        LinearLayout status=card(outputs);text(status,b.message.isEmpty()?"Sẵn sàng chạy.":b.message,13,MUTED);text(status,"Lượt này: "+b.settings.ratio+" · "+b.settings.size+" · "+b.settings.concurrency+" cảnh đồng thời",11,MUTED);
        if(!b.mergeStatus.isEmpty())text(status,"Ghép: "+stateLabel(b.mergeStatus)+(b.mergeStatus.equals("MERGING")?" "+b.mergeProgress+"%":""),13,ACCENT);
        if(!b.mergeError.isEmpty())text(status,b.mergeError,12,Color.rgb(255,166,159));
        if(!b.mergedFile.isEmpty()){button(status,"Mở video tổng",true,()->open(new File(b.mergedFile)));button(status,"Chia sẻ video tổng",false,()->share(new File(b.mergedFile)));}
        for(AppStore.Scene scene:b.scenes){
            LinearLayout c=card(queue);int color=scene.status.equals("DONE")?ACCENT:scene.status.equals("ERROR")||scene.status.equals("UNCERTAIN")?Color.rgb(255,166,159):WHITE;
            text(c,String.format(Locale.ROOT,"%03d",scene.index)+" · "+scene.seconds+"s · "+stateLabel(scene.status)+(scene.status.equals("RUNNING")?" "+scene.progress+"%":""),15,color);
            text(c,scene.prompt,12,MUTED).setMaxLines(4);
            if(!scene.imageUrl.isEmpty()||!scene.imageFile.isEmpty())text(c,"Có ảnh đầu vào",11,ACCENT);
            if(!scene.warning.isEmpty())text(c,scene.warning,11,Color.rgb(255,211,140));
            if(!scene.error.isEmpty())text(c,scene.error,12,Color.rgb(255,166,159));
            if(scene.status.equals("PENDING")&&scene.videoId.isEmpty()){button(c,"Gắn / đổi ảnh cảnh",false,()->attachDialog(scene.index));}
            if(scene.status.equals("ERROR")||scene.status.equals("UNCERTAIN")){button(c,"↻ Chạy lại cảnh "+scene.index,false,()->retryScene(scene.index));if(!scene.videoId.isEmpty()){button(c,"Gán API key cho job",false,()->assignKey(scene.index));}}
            if(scene.status.equals("UNCERTAIN")){button(c,"Gắn ID job đã tìm thấy trên Agnes",false,()->recoverId(scene.index));}
            if(scene.status.equals("DONE")){button(c,"Xem cảnh "+scene.index,false,()->open(new File(scene.clipFile)));}
            if(!scene.videoId.isEmpty())button(c,"Sao chép ID job",false,()->{getSystemService(android.content.ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Agnes job",scene.videoId));toast("Đã sao chép ID job.");});
        }
    }
    private boolean ensureIdle(){if(BatchService.busy||localBusy){alert("Đợi tác vụ hiện tại hoàn tất hoặc bấm Tạm dừng trước.");return false;}return true;}
    private void start(String action){
        if(!ensureIdle())return;AppStore.Batch b=store.batch();if(b==null){alert("Nhập file TXT trước khi chạy.");return;}
        boolean enabled=false;for(KeyVault.Entry e:vault.entries())if(e.enabled)enabled=true;
        if(action.equals(BatchService.RUN)&&!enabled){alert("Nhập và bật ít nhất một API key.");return;}
        if(action.equals(BatchService.MERGE)&&b.done()!=b.scenes.size()){alert("Cần hoàn tất tất cả cảnh trước khi ghép.");return;}
        if(action.equals(BatchService.RUN)&&b.done()==b.scenes.size()&&b.mergeStatus.equals("DONE")){toast("Lượt này đã hoàn tất. Video tổng ở ngay bên dưới.");return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},400);
        startForegroundService(new Intent(this,BatchService.class).setAction(action));
    }
    private void retryAll(){
        if(!ensureIdle())return;AppStore.Batch b=store.batch();if(b==null)return;int retried=0,uncertain=0;
        for(AppStore.Scene s:b.scenes){if(s.status.equals("ERROR")){store.retry(s.index,false);retried++;}else if(s.status.equals("UNCERTAIN"))uncertain++;}
        if(retried>0)start(BatchService.RUN);else alert(uncertain>0?"Có cảnh chưa rõ job đã tạo chưa. Mở từng cảnh để kiểm tra hoặc xác nhận tạo lại.":"Không có cảnh lỗi cần chạy lại.");
    }
    private void retryScene(int index){
        if(!ensureIdle())return;AppStore.Scene s=store.batch().scene(index);
        if(s.status.equals("UNCERTAIN"))new AlertDialog.Builder(this).setTitle("Tạo lại cảnh này?").setMessage("Yêu cầu trước có thể đã tạo job trên Agnes. Hãy kiểm tra trước; gửi lại có thể tạo thêm video và phát sinh phí.").setNegativeButton("Quay lại",null).setPositiveButton("Đã kiểm tra, tạo lại",(d,w)->{store.retry(index,true);start(BatchService.RUN);}).show();
        else{store.retry(index,false);start(BatchService.RUN);}
    }
    private void assignKey(int index){
        if(!ensureIdle())return;List<KeyVault.Entry> entries=vault.entries();if(entries.isEmpty()){alert("Nhập API key trước.");return;}String[] labels=new String[entries.size()];for(int i=0;i<labels.length;i++)labels[i]=entries.get(i).name+" "+entries.get(i).masked();String id=store.batch().id;
        new AlertDialog.Builder(this).setTitle("Chọn đúng key đã tạo job").setItems(labels,(d,w)->{store.updateScene(id,index,s->s.keyId=entries.get(w).id);toast("Đã gán key. Bấm Chạy lại để kiểm tra job.");}).show();
    }
    private void recoverId(int index){
        if(!ensureIdle())return;LinearLayout content=dialogContent();EditText id=input(content,"video_id tìm thấy trên Agnes",1,false);String batchId=store.batch().id;
        new AlertDialog.Builder(this).setTitle("Khôi phục job đã tạo").setView(content).setNegativeButton("Hủy",null).setPositiveButton("Lưu ID",(d,w)->{String value=id.getText().toString().trim();if(value.isEmpty()){alert("ID đang trống.");return;}store.updateScene(batchId,index,s->{s.videoId=value;s.status="ERROR";s.remoteFailed=false;s.error="Đã khôi phục ID; chọn đúng API key rồi bấm Chạy lại.";});}).show();
    }
    private void history(){
        if(!ensureIdle())return;List<AppStore.Batch> list=store.history();if(list.isEmpty()){alert("Chưa có lịch sử lượt chạy.");return;}String[] labels=new String[list.size()];for(int i=0;i<labels.length;i++){AppStore.Batch b=list.get(i);labels[i]=b.name+" · "+b.done()+"/"+b.scenes.size()+" · "+new java.text.SimpleDateFormat("dd/MM HH:mm",Locale.getDefault()).format(new Date(Long.parseLong(b.id.split("_")[0])));}
        new AlertDialog.Builder(this).setTitle("Lịch sử lượt chạy").setItems(labels,(d,w)->{store.openBatch(list.get(w).id);showScreen(0);}).show();
    }
    private void attachDialog(int index){
        if(!ensureIdle())return;LinearLayout content=dialogContent();text(content,"Dùng URL HTTPS hoặc chọn ảnh trên máy. Ảnh trên máy cần Cloudinary trong Cài đặt.",13,MUTED);EditText url=input(content,"https://.../frame.jpg",1,false);AppStore.Scene s=store.batch().scene(index);url.setText(s.imageUrl);
        new AlertDialog.Builder(this).setTitle("Ảnh cho cảnh "+index).setView(content).setNegativeButton("Hủy",null).setNeutralButton("Chọn ảnh trên máy",(d,w)->{pendingImageIndex=index;pendingImageBatch=store.batch().id;pick(FRAME,"image/*");}).setPositiveButton("Lưu URL / bỏ ảnh",(d,w)->{try{String value=url.getText().toString().trim();if(!value.isEmpty())requireHttps(value);store.attachImage(index,value,"");}catch(Exception e){alert(e.getMessage());}}).show();
    }
    private LinearLayout dialogContent(){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(20),dp(12),dp(20),dp(8));return c;}
    private void characterScreen(){
        LinearLayout c=card(body);title(c,"Character sheet");text(c,"Tạo nhân vật rồi dùng @A, @B... trong prompt. App gửi ảnh sheet cho từng cảnh có đúng ký hiệu đó.",13,MUTED);
        EditText tag=input(c,"Ký hiệu, ví dụ A hoặc TUAN",1,false),name=input(c,"Tên nhân vật, ví dụ Tuấn",1,false),description=input(c,"Tuổi, gương mặt, tóc, vóc dáng, quần áo...",3,false),url=input(c,"URL sheet có sẵn (không bắt buộc)",1,false);
        button(c,"Tạo sheet bằng Agnes / lưu sheet có sẵn",true,()->{
            if(!ensureIdle())return;AppStore.Character character=new AppStore.Character();character.tag=tag.getText().toString().trim().replaceFirst("^@","").toUpperCase(Locale.ROOT);character.name=name.getText().toString().trim();character.description=description.getText().toString().trim();character.url=url.getText().toString().trim();
            if(!character.tag.matches("[A-Z][A-Z0-9_]{0,23}")||character.name.isEmpty()||character.description.isEmpty()){alert("Cần ký hiệu hợp lệ, tên và mô tả nhân vật.");return;}
            if(!character.url.isEmpty())requireHttps(character.url);
            String key="";if(character.url.isEmpty()){for(KeyVault.Entry e:vault.entries())if(e.enabled){key=e.key;break;}if(key.isEmpty()){alert("Nhập API key trước khi tạo sheet.");return;}}
            String apiKey=key,base=store.settings().base;localBusy=true;toast("Đang chuẩn bị character sheet…");
            io.submit(()->{try{
                if(character.url.isEmpty())character.url=AgnesClient.sheetUrl(new AgnesClient(base).createSheet(apiKey,character.name+". "+character.description));
                File image=new File(store.characterDirectory(),character.tag+".png"),temp=new File(store.characterDirectory(),character.tag+".download");AgnesClient.download(character.url,temp,()->false);
                android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeFile(temp.getAbsolutePath(),options);if(options.outWidth<1)throw new IOException("URL không trả về ảnh đọc được.");
                if(image.exists()&&!image.delete())throw new IOException("Không thay được ảnh sheet.");if(!temp.renameTo(image))throw new IOException("Không lưu được ảnh sheet.");character.localFile=image.getAbsolutePath();store.putCharacter(character);runOnUiThread(()->{toast("Đã lưu @"+character.tag);if(tab==1)showScreen(1);});
            }catch(Exception e){errorFromWorker(e);}finally{localBusy=false;}});
        });
        for(AppStore.Character character:store.characters()){
            LinearLayout saved=card(body);title(saved,"@"+character.tag+" · "+character.name);text(saved,character.description,13,MUTED);
            if(!character.localFile.isEmpty())button(saved,"Xem sheet",false,()->open(new File(character.localFile)));
            button(saved,"Chép URL sheet",false,()->{getSystemService(android.content.ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Character sheet",character.url));toast("Đã chép URL sheet.");});
            button(saved,"Chỉnh mô tả / tạo lại",false,()->{if(!ensureIdle())return;tag.setText(character.tag);name.setText(character.name);description.setText(character.description);url.setText("");toast("Đã đưa vào ô nhập phía trên. Bấm Tạo sheet để tạo lại.");});
            button(saved,"Xóa nhân vật",false,()->{if(!ensureIdle())return;new AlertDialog.Builder(this).setTitle("Xóa @"+character.tag+"?").setMessage("Các lượt chạy đã nhập vẫn giữ sheet tham chiếu của riêng lượt đó.").setNegativeButton("Hủy",null).setPositiveButton("Xóa",(d,w)->{store.deleteCharacter(character.tag);showScreen(1);}).show();});
        }
    }
    private void keyScreen(){
        LinearLayout c=card(body);title(c,"API key");text(c,"Nhập từng key hoặc TXT: một key trên mỗi dòng. Key trùng sẽ được bỏ qua. Key được mã hóa trên điện thoại.",13,MUTED);EditText key=input(c,"Dán một API key",1,true);
        button(c,"Thêm key",true,()->{if(!ensureIdle())return;int n=vault.add(PromptParser.importKeys(key.getText().toString()));key.setText("");toast("Đã thêm "+n+" key.");showScreen(2);});
        button(c,"Nhập nhiều key từ TXT",false,()->{if(ensureIdle())pick(KEYS,"*/*");});
        try{for(KeyVault.Entry entry:vault.entries()){
            LinearLayout saved=card(body);text(saved,entry.name+" · "+entry.masked()+" · "+(entry.enabled?"Đang bật":"Đang tắt"),16,WHITE);
            button(saved,entry.enabled?"Tắt key":"Bật key",false,()->{if(ensureIdle()){vault.edit(entry.id,entry.name,entry.key,!entry.enabled);showScreen(2);}});
            button(saved,"Đổi tên / thay key",false,()->editKey(entry));
            button(saved,"Xóa key",false,()->{if(!ensureIdle())return;new AlertDialog.Builder(this).setTitle("Xóa "+entry.name+"?").setMessage("Job đã tạo cần đúng key này để kiểm tra tiếp. Bạn có thể thay key mới vào mục sửa để giữ liên kết.").setNegativeButton("Hủy",null).setPositiveButton("Xóa",(d,w)->{vault.delete(entry.id);showScreen(2);}).show();});
        }}catch(Exception e){text(c,e.getMessage(),13,Color.rgb(255,166,159));}
        button(c,"Xóa toàn bộ kho key",false,()->{if(!ensureIdle())return;new AlertDialog.Builder(this).setTitle("Xóa toàn bộ key?").setMessage("Bạn cần nhập lại key để tiếp tục kiểm tra những job đã gửi.").setNegativeButton("Hủy",null).setPositiveButton("Xóa kho key",(d,w)->{vault.clear();showScreen(2);}).show();});
    }
    private void editKey(KeyVault.Entry entry){
        if(!ensureIdle())return;LinearLayout c=dialogContent();EditText name=input(c,"Tên key",1,false),key=input(c,"Key mới; để trống để giữ key cũ",1,true);name.setText(entry.name);
        new AlertDialog.Builder(this).setTitle("Chỉnh API key").setView(c).setNegativeButton("Hủy",null).setPositiveButton("Lưu",(d,w)->{try{String value=key.getText().toString().trim();if(value.isEmpty())value=entry.key;else value=PromptParser.importKeys(value).get(0);vault.edit(entry.id,name.getText().toString().trim(),value,entry.enabled);showScreen(2);}catch(Exception e){alert(e.getMessage());}}).show();
    }
    private void settingsScreen(){
        AppStore.Settings s=store.settings();LinearLayout c=card(body);title(c,"Cấu hình lượt mới");
        choice(c,"Model",new String[]{"agnes-video-2.5-flash","agnes-video-2.5"},s.model,v->{setting(x->{x.model=v;if(v.endsWith("flash"))x.size="720P";});showScreen(3);});
        choice(c,"Độ phân giải",s.model.endsWith("flash")?new String[]{"720P"}:new String[]{"720P","1080P","2K"},s.size,v->setting(x->x.size=v));
        choice(c,"Số cảnh chạy đồng thời",new String[]{"1","2","3"},Integer.toString(s.concurrency),v->setting(x->x.concurrency=Integer.parseInt(v)));
        checkbox(c,"Tự ghép khi tất cả cảnh hoàn tất",s.autoMerge,v->setting(x->x.autoMerge=v));
        checkbox(c,"Lưu cảnh và bản ghép không có âm thanh",s.mute,v->setting(x->x.mute=v));
        checkbox(c,"Thêm yêu cầu không thoại / không lip-sync",s.avoidSpeech,v->setting(x->x.avoidSpeech=v));
        text(c,"Cấu hình video được giữ sau khi lượt chạy bắt đầu; thay đổi tiếp theo dành cho lượt mới. Thời lượng Agnes 2.5: 4–12 giây/cảnh. Nếu Agnes trả khác số giây, app hiển thị cảnh báo ở cảnh đó.",12,MUTED);
        LinearLayout upload=card(body);title(upload,"Ảnh từ điện thoại");text(upload,"Agnes cần URL ảnh công khai. Điền tài khoản Cloudinary của bạn và một unsigned upload preset để app tự đưa ảnh lên. Không cần mục này nếu dùng URL ảnh sẵn hoặc sheet Agnes.",13,MUTED);EditText cloud=input(upload,"Cloudinary cloud name",1,false),preset=input(upload,"Unsigned upload preset",1,false);cloud.setText(s.cloud);preset.setText(s.preset);
        button(upload,"Lưu cấu hình ảnh",false,()->setting(x->{x.cloud=cloud.getText().toString().trim();x.preset=preset.getText().toString().trim();}));
        LinearLayout advanced=card(body);title(advanced,"Cổng API");EditText base=input(advanced,"https://apihub.agnes-ai.com",1,false);base.setText(s.base);
        button(advanced,"Lưu cổng API",false,()->{String value=base.getText().toString().trim();requireHttps(value);new AgnesClient(value);setting(x->x.base=value);toast("Đã lưu cổng API.");});
        LinearLayout help=card(body);title(help,"Cách dùng nhanh");text(help,"1. Thêm API key.\n2. Tạo sheet @A, @B nếu cần.\n3. Nhập TXT, gắn ảnh cho từng cảnh nếu cần.\n4. Bấm Chạy.\n5. Cảnh lỗi: bấm Chạy lại.\n6. Xem video tổng hoặc mở Movies/AgnesBatch.",14,WHITE);text(help,"Ví dụ TXT:\n\n001 | 4s | @A bước tới bên cửa.\nMáy quay đứng yên.\n\nChiếc xuồng trôi trên con kinh.",13,MUTED);text(help,"Tạm dừng app chỉ dừng việc kiểm tra/tải về, không hủy job ở Agnes. Mở lại và bấm Tiếp tục để nhận kết quả. Nếu Android hoặc hãng điện thoại dừng app, tiến độ đã lưu vẫn dùng được.",12,MUTED);
        button(help,"Mở tài liệu Agnes",false,()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash"))));
    }
    private void pick(int code,String type){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType(type).addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(intent,code);}
    private String filename(Uri uri){String name="prompts.txt";try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}return name;}
    private byte[] readText(Uri uri)throws IOException{try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException("Không mở được TXT.");byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))>=0){if(out.size()+n>2*1024*1024)throw new IOException("TXT tối đa 2 MB.");out.write(bytes,0,n);}return out.toByteArray();}}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;
        if(!ensureIdle())return;Uri uri=data.getData();String name=filename(uri);if(request!=FRAME&&!name.toLowerCase(Locale.ROOT).endsWith(".txt")){alert("Chọn file có đuôi .txt.");return;}
        int frameIndex=pendingImageIndex;String frameBatch=pendingImageBatch;localBusy=true;
        io.submit(()->{try{
            if(request==PROMPTS){List<PromptParser.Prompt> prompts=PromptParser.parse(PromptParser.decode(readText(uri)),store.settings().seconds);store.createBatch(name,prompts);runOnUiThread(()->{showScreen(0);toast("Đã nhập "+prompts.size()+" cảnh.");});}
            else if(request==KEYS){int n=vault.add(PromptParser.importKeys(PromptParser.decode(readText(uri))));runOnUiThread(()->{showScreen(2);toast("Đã thêm "+n+" key.");});}
            else if(request==FRAME){AppStore.Batch batch=store.batch();if(batch==null||!batch.id.equals(frameBatch))throw new IOException("Lượt chạy đã đổi. Hãy chọn ảnh lại.");File output=new File(store.batchDirectory(batch.id),String.format(Locale.ROOT,"%03d.frame.jpg",frameIndex));ImageFiles.copyFrame(this,uri,output);store.attachImage(frameIndex,"",output.getAbsolutePath());runOnUiThread(()->{refreshQueue();toast("Đã gắn ảnh cho cảnh "+frameIndex);});}
        }catch(Exception e){errorFromWorker(e);}finally{localBusy=false;}});
    }
    private void open(File file){if(!file.isFile()){alert("File không còn trên điện thoại.");return;}Uri uri=OutputProvider.uri(this,file);String mime=file.getName().endsWith(".mp4")?"video/mp4":"image/*";Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Agnes output",uri));try{startActivity(intent);}catch(ActivityNotFoundException e){share(file);}}
    private void share(File file){Uri uri=OutputProvider.uri(this,file);Intent intent=new Intent(Intent.ACTION_SEND).setType(file.getName().endsWith(".mp4")?"video/mp4":"image/*").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Agnes output",uri));startActivity(Intent.createChooser(intent,"Chia sẻ"));}
    private void requireHttps(String url){try{java.net.URI u=java.net.URI.create(url);if(!"https".equals(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null)throw new IllegalArgumentException();}catch(Exception e){throw new IllegalArgumentException("Nhập URL HTTPS hợp lệ.");}}
    private void errorFromWorker(Exception e){String message=vault.redact(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());runOnUiThread(()->alert(message));}
    private void alert(String text){if(!isFinishing()&&!isDestroyed())new AlertDialog.Builder(this).setTitle("Agnes Batch").setMessage(text==null?"Có lỗi xảy ra.":text).setPositiveButton("Đã hiểu",null).show();}
    private void toast(String value){Toast.makeText(this,value,Toast.LENGTH_SHORT).show();}
}
