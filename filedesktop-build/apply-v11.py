from pathlib import Path
new=Path('filedesktop-src')
p=new/'app/src/main/java/com/filedesktop/app/MainActivity.java'
s=p.read_text()

def replace(old, now):
  global s
  if old not in s:raise RuntimeError('NOT FOUND '+old[:120])
  s=s.replace(old,now)

replace('private final int NAVY=Color.rgb(17,32,54), BLUE=Color.rgb(20,48,81), GOLD=Color.rgb(247,196,93), PALE=Color.rgb(235,241,249);\n    private final int TXT=Color.rgb(24,39,60), SUB=Color.rgb(110,126,146);',
'''private final int NAVY=Color.rgb(13,18,27), BLUE=Color.rgb(102,162,238), GOLD=Color.rgb(247,196,93), PALE=Color.rgb(12,16,24);
    private final int TXT=Color.rgb(238,243,252), SUB=Color.rgb(159,175,195);
    private final int CARD=Color.rgb(26,34,47), ACTIVE=Color.rgb(32,61,86), TOOL=Color.rgb(32,43,60);''')
replace('if(root!=null && desktop)ui.postDelayed(this::showDesktop,100);','if(root!=null && desktop)ui.postDelayed(()->{if(desktop && !isFinishing())showDesktop();},100);')
replace('new int[]{Color.rgb(15,31,55),Color.rgb(22,58,96),Color.rgb(12,35,65)}','new int[]{Color.rgb(10,14,22),Color.rgb(19,29,43),Color.rgb(10,17,27)}')
replace('b.setBackground(shape(Color.rgb(46,104,170),11))','b.setBackground(shape(Color.rgb(47,94,163),11))')
replace('v.setBackgroundColor(Color.rgb(225,232,242))','v.setBackgroundColor(TOOL)')
replace('TextView folder=text("📁",35,GOLD,false);folder.setGravity(Gravity.CENTER);slot.addView(folder,lp(-1,51));',
        'TextView folder=text("📁",35,GOLD,false);folder.setGravity(Gravity.CENTER);slot.addView(folder,lp(-1,51));')
replace('slot.setOnClickListener(v->{if(mustAccess()){File path=new File(shortcut.path);if(path.isDirectory())openFolder(path);else new AlertDialog.Builder(this).setMessage("Thư mục gốc không còn tồn tại. Bạn có thể xóa shortcut này.").setPositiveButton("Xóa shortcut",(a,b)->removeShortcut(shortcut)).setNegativeButton("Hủy",null).show();}});',
'''// Both icon and label receive gestures because each has a long-press handler.
                // Without click handlers on these child views, their long-clickable state
                // consumes touch UP and prevents the parent tile's click from firing.
                View.OnClickListener open = v -> openShortcut(shortcut);
                slot.setOnClickListener(open);
                folder.setOnClickListener(open);
                label.setOnClickListener(open);''')
replace('slot.setOnTouchListener((v,event)->{if(event.getAction()==MotionEvent.ACTION_DOWN && event.getX()>v.getWidth()-dp(20) && event.getY()<dp(32)){shortcutMenu(v,shortcut);return true;}return false;});',
        '// No edge gesture intercept: one tap anywhere on the shortcut always opens it.')
replace('}else{\n                slot.setOnClickListener(v->{if(mustAccess())chooseFolder();});\n            }', '}else{\n                // Empty desktop cells remain empty. Use + or a long press on the background to add shortcuts.\n            }')
replace('private void shortcutMenu(View anchor,Shortcut shortcut)',
'''private void openShortcut(Shortcut shortcut){
        if(!mustAccess())return;
        File folder=new File(shortcut.path);
        if(folder.isDirectory() && folder.canRead())openFolder(folder);
        else new AlertDialog.Builder(this).setTitle("Không mở được shortcut")
          .setMessage("Không thể mở thư mục này:\\n"+shortcut.path+"\\n\\nThư mục có thể đã đổi tên, bị di chuyển hoặc thiếu quyền truy cập.")
          .setNegativeButton("Đóng",null)
          .setNeutralButton("Xóa shortcut",(a,b)->removeShortcut(shortcut)).show();
    }
    private void shortcutMenu(View anchor,Shortcut shortcut)''')
replace('else openFolder(new File(shortcut.path));return true;', 'else openShortcut(shortcut);return true;')
replace('searchBox.setBackground(shape(Color.WHITE,12));searchBox.setPadding',
        'searchBox.setBackground(shape(TOOL,12));searchBox.setTextColor(TXT);searchBox.setHintTextColor(SUB);searchBox.setPadding')
replace('actions.setBackgroundColor(Color.WHITE)', 'actions.setBackgroundColor(NAVY)')
replace('pasteBar.setBackgroundColor(Color.WHITE)', 'pasteBar.setBackgroundColor(NAVY)')
replace('TextView t=text(name,13,BLUE,true);t.setGravity(Gravity.CENTER);t.setBackground(shape(Color.WHITE,9))',
        'TextView t=text(name,13,TXT,true);t.setGravity(Gravity.CENTER);t.setBackground(shape(TOOL,9))')
replace('selected.contains(file.getAbsolutePath())?Color.rgb(207,228,249):Color.WHITE,12',
        'selected.contains(file.getAbsolutePath())?ACTIVE:CARD,12')
replace('file.isDirectory()?GOLD:BLUE,false', 'file.isDirectory()?GOLD:SUB,false')
replace('selected.contains(file.getAbsolutePath())?"☑":"☐",24,BLUE,false',
        'selected.contains(file.getAbsolutePath())?"☑":"☐",24,BLUE,false')
# Status/nav bar black. Popup dialogs from Android dark theme.
p.write_text(s)

style=new/'app/src/main/res/values/styles.xml'
st=style.read_text().replace('android:style/Theme.Material.Light.NoActionBar','android:style/Theme.Material.NoActionBar')
st=st.replace('#101C31','#0D121B').replace('#3775DA','#669DF0')
style.write_text(st)

gradle=new/'app/build.gradle'
g=gradle.read_text().replace("applicationId 'com.filedesktop.app'", "applicationId 'com.filedesktop.app.dark'").replace('versionCode 1','versionCode 2').replace("versionName '1.0'","versionName '1.1'")
gradle.write_text(g)
manifest=new/'app/src/main/AndroidManifest.xml'
m=manifest.read_text().replace('android:label="File Desktop"','android:label="File Desktop 1.1"').replace('android:authorities="com.filedesktop.app.files"','android:authorities="com.filedesktop.app.dark.files"')
manifest.write_text(m)
provider=new/'app/src/main/java/com/filedesktop/app/LocalFileProvider.java'
provider.write_text(provider.read_text().replace('com.filedesktop.app.files','com.filedesktop.app.dark.files'))
readme=new/'README.md'
readme.write_text(readme.read_text().replace('Android 1.0','Android 1.1').replace('File Desktop —','File Desktop (dark) —')+'\n## Bản 1.1 — sửa thao tác shortcut và giao diện tối\n- Nhấn một lần vào biểu tượng **hoặc tên** shortcut để mở thẳng thư mục; giữ biểu tượng để kéo; giữ tên để đổi tên/xóa.\n- Gỡ xử lý chạm ở mép ô từng có thể nuốt sự kiện click.\n- Giao diện tối trên Desktop, danh sách, ô tìm kiếm, hộp thoại và thanh công cụ.\n- Dùng applicationId riêng để cài song song bản 1.0 (APK debug cũ và mới có chữ ký khác; cần thêm lại shortcut vào bản này).\n')
print('Done',p, len(s))