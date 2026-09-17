package org.ngsmedia.agnesbatch;

import java.nio.*;
import java.nio.charset.*;
import java.util.*;
import java.util.regex.*;

public final class PromptParser {
    public static final int MAX_SCENES=50;
    private static final Pattern INDEX_DURATION=Pattern.compile("^\\d{1,4}\\s*\\|\\s*(?=\\[?\\d+(?:[.,]\\d+)?\\s*(?:s\\b|sec|seconds|giây))",Pattern.CASE_INSENSITIVE|Pattern.UNICODE_CASE);
    private static final Pattern DURATION=Pattern.compile("^\\[?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:seconds?|secs?|s\\b|giây)\\s*\\]?\\s*(?:[|:–—-]\\s*)?",Pattern.CASE_INSENSITIVE|Pattern.UNICODE_CASE);
    private static final Pattern BARE_DURATION=Pattern.compile("^(\\d{1,2}(?:[.,]\\d+)?)(?:\\s*[|:]\\s*|\\s+)");
    private static final Pattern INDEX=Pattern.compile("^\\d{3,4}\\s*\\|\\s*");
    public static final Pattern TAG=Pattern.compile("(?<![\\p{L}\\p{N}_])@([A-Za-z][A-Za-z0-9_]{0,23})(?![\\p{L}\\p{N}_])");
    public static final class Prompt {
        public final int index;public final String text;public final double seconds;public final boolean explicitSeconds;
        Prompt(int index,String text,double seconds,boolean explicit){this.index=index;this.text=text;this.seconds=seconds;this.explicitSeconds=explicit;}
    }
    public static String decode(byte[] data){
        Charset charset=StandardCharsets.UTF_8;int offset=0;
        if(data.length>=3&&data[0]==(byte)0xef&&data[1]==(byte)0xbb&&data[2]==(byte)0xbf)offset=3;
        else if(data.length>=2&&data[0]==(byte)0xff&&data[1]==(byte)0xfe){charset=StandardCharsets.UTF_16LE;offset=2;}
        else if(data.length>=2&&data[0]==(byte)0xfe&&data[1]==(byte)0xff){charset=StandardCharsets.UTF_16BE;offset=2;}
        try{return charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data,offset,data.length-offset)).toString();}
        catch(CharacterCodingException e){throw new IllegalArgumentException("TXT không đọc được. Hãy lưu bằng UTF-8 hoặc UTF-16 có BOM.");}
    }
    public static List<Prompt> parse(String input,double defaultSeconds){
        validateSeconds(defaultSeconds,0);
        if(input==null||input.trim().isEmpty())throw new IllegalArgumentException("File prompt đang trống.");
        String normalized=input.replace("\uFEFF","").replace("\r\n","\n").replace('\r','\n').trim();
        List<Prompt> out=new ArrayList<>();
        for(String block:normalized.split("\\n[\\t ]*\\n(?:[\\t ]*\\n)*")){
            if(block.trim().isEmpty())continue;
            String[] lines=block.trim().split("\\n");int n=out.size()+1;
            if(lines.length>2)throw new IllegalArgumentException("Prompt "+n+" có "+lines.length+" dòng. Mỗi prompt cần 1–2 dòng; cách nhau một dòng trắng.");
            String text=String.join(" ",lines).trim();
            Matcher indexed=INDEX_DURATION.matcher(text);if(indexed.find())text=text.substring(indexed.end());
            Matcher duration=DURATION.matcher(text);boolean explicit=duration.find();double seconds=defaultSeconds;
            if(explicit){seconds=Double.parseDouble(duration.group(1).replace(',','.'));text=text.substring(duration.end()).trim();}
            else{
                Matcher index=INDEX.matcher(text);
                if(index.find())text=text.substring(index.end()).trim();
                else{Matcher bare=BARE_DURATION.matcher(text);if(bare.find()){explicit=true;seconds=Double.parseDouble(bare.group(1).replace(',','.'));text=text.substring(bare.end()).trim();}}
            }
            validateSeconds(seconds,n);
            if(text.isEmpty())throw new IllegalArgumentException("Prompt "+n+" thiếu nội dung.");
            if(text.length()>12000)throw new IllegalArgumentException("Prompt "+n+" quá dài (tối đa 12.000 ký tự).");
            out.add(new Prompt(n,text,seconds,explicit));
            if(out.size()>MAX_SCENES)throw new IllegalArgumentException("Một lượt tối đa 50 prompt. Hãy chia TXT thành nhiều lượt.");
        }
        return out;
    }
    public static void validateSeconds(double seconds,int index){
        if(!Double.isFinite(seconds)||seconds<4||seconds>12||seconds!=Math.rint(seconds))
            throw new IllegalArgumentException((index>0?"Prompt "+index+": ":"")+"Agnes 2.5 cần số giây nguyên từ 4 đến 12.");
    }
    public static List<String> tags(String prompt){
        Set<String> tags=new LinkedHashSet<>();Matcher m=TAG.matcher(prompt);while(m.find())tags.add(m.group(1).toUpperCase(Locale.ROOT));return new ArrayList<>(tags);
    }
    public static List<String> importKeys(String input){
        Set<String> keys=new LinkedHashSet<>();
        for(String line:input.replace("\uFEFF","").split("\\r?\\n")){
            String key=line.trim();if(key.isEmpty()||key.startsWith("#"))continue;
            key=key.replaceFirst("(?i)^Bearer\\s+","");
            if(key.length()<8||key.length()>4096||key.matches(".*\\s+.*"))throw new IllegalArgumentException("Mỗi dòng TXT cần đúng một API key, không kèm tên hoặc dấu phẩy.");
            keys.add(key);
        }
        if(keys.isEmpty())throw new IllegalArgumentException("Không tìm thấy API key.");return new ArrayList<>(keys);
    }
}
