from pathlib import Path
import sys

project = Path(sys.argv[1] if len(sys.argv) > 1 else '/mnt/data/FileDesktop-Android-v1.2')
p = project / 'app/src/main/java/com/filedesktop/app/MainActivity.java'
s = p.read_text(encoding='utf-8')

def swap(old, new):
    global s
    if s.count(old) != 1:
        raise RuntimeError(f'Expected 1 occurrence, found {s.count(old)}: {old[:100]!r}')
    s = s.replace(old, new, 1)

swap('import android.content.pm.PackageManager;', '''import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.Icon;
import java.security.MessageDigest;''')

swap('    private static final int SORT_NEW=0, SORT_AZ=1, SORT_ZA=2;', '''    private static final int SORT_NEW=0, SORT_AZ=1, SORT_ZA=2;
    private static final String ACTION_OPEN_PINNED_FOLDER="com.filedesktop.app.OPEN_PINNED_FOLDER";
    private static final String EXTRA_PINNED_FOLDER="filedesktop.pinned_folder";
    private String pendingPinnedFolder=null;''')

swap('''        loadShortcuts(); showDesktop();
        if(!canAccess()) ui.postDelayed(this::askPermission,350);
    }
    @Override public void onResume(){super.onResume();if(root!=null && desktop)ui.postDelayed(()->{if(desktop && !isFinishing())showDesktop();},100);}''', '''        loadShortcuts();
        routeLaunchIntent(getIntent());
        if(!canAccess() && pendingPinnedFolder==null) ui.postDelayed(this::askPermission,350);
    }
    @Override public void onResume(){
        super.onResume();
        if(pendingPinnedFolder!=null && canAccess()){
            String folder=pendingPinnedFolder;
            pendingPinnedFolder=null;
            openPinnedFolder(folder);
        }else if(root!=null && desktop)ui.postDelayed(()->{
            if(desktop && pendingPinnedFolder==null && !isFinishing())showDesktop();
        },100);
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        setIntent(intent);
        routeLaunchIntent(intent);
    }
    private void routeLaunchIntent(Intent intent){
        if(intent!=null && ACTION_OPEN_PINNED_FOLDER.equals(intent.getAction())){
            String target=intent.getStringExtra(EXTRA_PINNED_FOLDER);
            if(target==null || target.trim().isEmpty()){
                showDesktop();toast("Shortcut không có đường dẫn hợp lệ");return;
            }
            if(!canAccess()){
                pendingPinnedFolder=target;
                showDesktop();
                ui.postDelayed(this::askPermission,300);
            }else{
                pendingPinnedFolder=null;
                openPinnedFolder(target);
            }
        }else{
            pendingPinnedFolder=null;
            showDesktop();
        }
    }
    private void openPinnedFolder(String path){
        File target=new File(path);
        if(target.isDirectory() && target.canRead()){
            openFolder(target);
        }else{
            showDesktop();
            new AlertDialog.Builder(this).setTitle("Không mở được thư mục")
                .setMessage("Không tìm thấy thư mục hoặc thiếu quyền truy cập:\\n"+path)
                .setPositiveButton("Đóng",null).show();
        }
    }''')

marker='    private void showDesktop(){'
pin_methods='''    private String pinnedId(String path){
        try{
            byte[] bytes=MessageDigest.getInstance("SHA-256").digest(path.getBytes(StandardCharsets.UTF_8));
            StringBuilder h=new StringBuilder("folder-");
            for(int i=0;i<12;i++)h.append(String.format(Locale.US,"%02x",bytes[i]&255));
            return h.toString();
        }catch(Exception e){return "folder-"+Integer.toHexString(path.hashCode());}
    }
    private Icon folderPinnedIcon(){
        Bitmap bmp=Bitmap.createBitmap(144,144,Bitmap.Config.ARGB_8888);
        Canvas c=new Canvas(bmp);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.rgb(18,31,49));
        c.drawRoundRect(4,4,140,140,28,28,paint);
        paint.setColor(Color.rgb(247,196,93));
        c.drawRoundRect(24,47,119,112,13,13,paint);
        Path tab=new Path();tab.moveTo(28,46);tab.lineTo(28,34);tab.quadTo(28,27,35,27);
        tab.lineTo(68,27);tab.lineTo(82,48);tab.close();c.drawPath(tab,paint);
        paint.setColor(Color.rgb(255,216,129));
        c.drawRoundRect(24,55,119,112,13,13,paint);
        return Icon.createWithBitmap(bmp);
    }
    private void pinFolder(File folder,String customLabel){
        if(!mustAccess())return;
        if(!folder.isDirectory() || !folder.canRead()){
            toast("Không mở được thư mục này");return;
        }
        if(Build.VERSION.SDK_INT<26){toast("Cần Android 8 trở lên để ghim shortcut");return;}
        ShortcutManager manager=getSystemService(ShortcutManager.class);
        if(manager==null || !manager.isRequestPinShortcutSupported()){
            new AlertDialog.Builder(this).setTitle("Không hỗ trợ ghim shortcut")
                .setMessage("Trình khởi chạy màn hình chính của điện thoại chưa hỗ trợ tính năng này. Hãy thử launcher khác hoặc dùng Desktop trong app.")
                .setPositiveButton("Đóng",null).show();
            return;
        }
        String label=(customLabel==null || customLabel.trim().isEmpty())?titleFor(folder):customLabel.trim();
        if(label.length()>32)label=label.substring(0,32);
        String path=folder.getAbsolutePath();
        Intent launch=new Intent(this,MainActivity.class);
        launch.setAction(ACTION_OPEN_PINNED_FOLDER);
        launch.setData(Uri.parse("filedesktop://folder/"+Uri.encode(pinnedId(path))));
        launch.putExtra(EXTRA_PINNED_FOLDER,path);
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        ShortcutInfo shortcut=new ShortcutInfo.Builder(this,pinnedId(path))
            .setShortLabel(label)
            .setLongLabel(titleFor(folder))
            .setIcon(folderPinnedIcon())
            .setIntent(launch)
            .build();
        try{
            boolean requested=manager.requestPinShortcut(shortcut,null);
            if(requested)toast("Đã gửi yêu cầu ghim. Hãy xác nhận trên màn hình điện thoại.");
            else toast("Launcher không nhận yêu cầu ghim shortcut");
        }catch(Exception e){
            new AlertDialog.Builder(this).setTitle("Chưa ghim được shortcut")
                .setMessage(e.getMessage()).setPositiveButton("Đóng",null).show();
        }
    }
'''
swap(marker,pin_methods+marker)

swap('''popup.getMenu().add("Mở thư mục");popup.setOnMenuItemClickListener(item->{String v=item.getTitle().toString();if(v.startsWith("Đổi"))input("Đổi tên shortcut",shortcut.label,value->{shortcut.label=value;saveShortcuts();showDesktop();});else if(v.startsWith("Xóa"))removeShortcut(shortcut);else openShortcut(shortcut);return true;});popup.show();''','''popup.getMenu().add("Mở thư mục");popup.getMenu().add("Ghim ra màn hình điện thoại");popup.setOnMenuItemClickListener(item->{String v=item.getTitle().toString();if(v.startsWith("Đổi"))input("Đổi tên shortcut",shortcut.label,value->{shortcut.label=value;saveShortcuts();showDesktop();});else if(v.startsWith("Xóa"))removeShortcut(shortcut);else if(v.startsWith("Ghim"))pinFolder(new File(shortcut.path),shortcut.label);else openShortcut(shortcut);return true;});popup.show();''')

swap('''.setPositiveButton("Đưa ra Desktop",(di,which)->{addShortcut(selectedFolder[0]);showDesktop();})
          .setNegativeButton("Hủy",null).create();''','''.setPositiveButton("Đưa ra Desktop",(di,which)->{addShortcut(selectedFolder[0]);showDesktop();})
          .setNeutralButton("Ghim màn hình điện thoại",(di,which)->pinFolder(selectedFolder[0],titleFor(selectedFolder[0])))
          .setNegativeButton("Hủy",null).create();''')

swap('''        if(file.isDirectory())m.getMenu().add("📌 Đưa ra Desktop");''','''        if(file.isDirectory()){
            m.getMenu().add("📌 Đưa ra Desktop");
            m.getMenu().add("Ghim ra màn hình điện thoại");
        }''')

swap('''            if(s.contains("Desktop")){addShortcut(file);return true;}
            if(s.equals("Sao chép")''','''            if(s.contains("Desktop")){addShortcut(file);return true;}
            if(s.startsWith("Ghim")){pinFolder(file,file.getName());return true;}
            if(s.equals("Sao chép")''')

swap('''m.getMenu().add("Đưa thư mục này ra Desktop");''','''m.getMenu().add("Đưa thư mục này ra Desktop");m.getMenu().add("Ghim thư mục này ra màn hình điện thoại");''')

swap('''else if(t.startsWith("Đưa")){addShortcut(currentDir);showBrowser();}else if(t.startsWith("Ghi"))''','''else if(t.startsWith("Đưa")){addShortcut(currentDir);showBrowser();}else if(t.startsWith("Ghim")){pinFolder(currentDir,titleFor(currentDir));}else if(t.startsWith("Ghi"))''')

p.write_text(s,encoding='utf-8')

manifest=project/'app/src/main/AndroidManifest.xml'
xml=manifest.read_text(encoding='utf-8')
assert 'android:label="File Desktop 1.1"' in xml
xml=xml.replace('android:label="File Desktop 1.1"','android:label="File Desktop 1.2"')
xml=xml.replace('android:exported="true" android:screenOrientation','android:exported="true" android:launchMode="singleTop" android:screenOrientation')
xml=xml.replace('com.filedesktop.app.dark.files','com.filedesktop.app.pinned.files')
manifest.write_text(xml,encoding='utf-8')

config=project/'app/build.gradle'
build=config.read_text(encoding='utf-8')
assert "applicationId 'com.filedesktop.app.dark'" in build
build=build.replace("applicationId 'com.filedesktop.app.dark'","applicationId 'com.filedesktop.app.pinned'")
build=build.replace('versionCode 2','versionCode 3').replace("versionName '1.1'","versionName '1.2'")
config.write_text(build,encoding='utf-8')
print('Applied File Desktop v1.2 pinned home-screen shortcut patch')