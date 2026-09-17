package org.ngsmedia.agnesbatch;

import android.content.*;
import android.security.keystore.*;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** All API keys are encrypted with a non-exportable Android Keystore AES key. */
public final class KeyVault {
    public static final class Entry {
        public final String id,name,key;public final boolean enabled;
        Entry(String id,String name,String key,boolean enabled){this.id=id;this.name=name;this.key=key;this.enabled=enabled;}
        public String masked(){return key.length()<12?"••••••••":"••••••••"+key.substring(key.length()-4);}
    }
    private final SharedPreferences prefs;
    public KeyVault(Context context){prefs=context.getSharedPreferences("key_vault",Context.MODE_PRIVATE);}
    private SecretKey cipherKey()throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        String alias="agnes_batch_keys_v1";
        if(!store.containsAlias(alias)){
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }return (SecretKey)store.getKey(alias,null);
    }
    private List<Object> read(){
        String encoded=prefs.getString("encrypted","");if(encoded.isEmpty())return new ArrayList<>();
        try{
            String[] parts=encoded.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,cipherKey(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
            String plain=new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
            return new ArrayList<>(Json.list(Json.parse(plain)));
        }catch(Exception e){throw new IllegalStateException("Không mở được kho API key. Hãy xóa kho key trong màn hình API rồi nhập lại.");}
    }
    private void write(List<Object> entries){
        try{
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,cipherKey());
            byte[] bytes=cipher.doFinal(Json.stringify(entries).getBytes(StandardCharsets.UTF_8));
            if(!prefs.edit().putString("encrypted",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(bytes,Base64.NO_WRAP)).commit())throw new IllegalStateException();
        }catch(Exception e){throw new IllegalStateException("Không lưu được kho API key đã mã hóa.");}
    }
    public synchronized List<Entry> entries(){
        List<Entry> out=new ArrayList<>();for(Object o:read()){
            Map<String,Object> m=Json.map(o);out.add(new Entry(Json.str(m,"id",""),Json.str(m,"name","Key"),Json.str(m,"key",""),Json.bool(m,"enabled",true)));
        }return out;
    }
    public synchronized int add(List<String> keys){
        List<Object> list=read();Set<String> existing=new HashSet<>();for(Object o:list)existing.add(Json.str(Json.map(o),"key",""));int count=0;
        for(String key:keys)if(existing.add(key)){list.add(Json.obj("id",UUID.randomUUID().toString(),"name","Key "+(list.size()+1),"key",key,"enabled",true));count++;}
        write(list);return count;
    }
    public synchronized String key(String id){for(Entry e:entries())if(e.id.equals(id))return e.key;throw new IllegalStateException("API key của job này đã bị xóa. Hãy thêm lại key và gán cho cảnh lỗi.");}
    public synchronized void edit(String id,String name,String value,boolean enabled){
        List<Object> list=read();for(Object o:list){Map<String,Object> m=Json.map(o);if(Json.str(m,"id","").equals(id)){m.put("name",name);m.put("key",value);m.put("enabled",enabled);}}
        write(list);
    }
    public synchronized void delete(String id){List<Object> list=read();list.removeIf(o->Json.str(Json.map(o),"id","").equals(id));write(list);}
    public synchronized void clear(){prefs.edit().remove("encrypted").commit();}
    public synchronized String redact(String value){
        try{for(Entry e:entries())value=value.replace(e.key,"[ẩn key]");}catch(Exception ignored){}return value;
    }
}
