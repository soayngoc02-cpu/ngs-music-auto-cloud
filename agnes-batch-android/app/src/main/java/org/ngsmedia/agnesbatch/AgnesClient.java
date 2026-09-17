package org.ngsmedia.agnesbatch;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Agnes 2.5/2.5 Flash JSON API; never sends bearer keys to media hosts. */
public final class AgnesClient {
    public interface Cancel {boolean stopped();}
    public static final class ApiException extends IOException {
        private static final long serialVersionUID=1L;
        public final int code;public final long retryAfterSeconds;
        ApiException(int code,String text,long retry){super("HTTP "+code+": "+text);this.code=code;retryAfterSeconds=retry;}
    }
    public final String base;
    public AgnesClient(String base){
        String normalized=base.trim().replaceAll("/+$","");
        if(normalized.endsWith("/v1"))normalized=normalized.substring(0,normalized.length()-3);
        validateUrl(normalized);this.base=normalized;
    }
    private static void validateUrl(String value){
        try{URI u=URI.create(value);boolean local="localhost".equals(u.getHost())||"127.0.0.1".equals(u.getHost());
            if(u.getHost()==null||u.getUserInfo()!=null||u.getFragment()!=null||!("https".equals(u.getScheme())||local&&"http".equals(u.getScheme())))throw new IllegalArgumentException();
        }catch(IllegalArgumentException e){throw new IllegalArgumentException("URL phải là HTTPS hợp lệ.");}
    }
    public static Map<String,Object> videoBody(String model,String prompt,int seconds,String aspect,String size,List<String> images,String firstFrame,boolean avoidSpeech){
        PromptParser.validateSeconds(seconds,0);
        if(!Arrays.asList("agnes-video-2.5-flash","agnes-video-2.5").contains(model))throw new IllegalArgumentException("Model video không hỗ trợ.");
        if(!Arrays.asList("9:16","16:9","1:1","4:3","3:4","21:9").contains(aspect))throw new IllegalArgumentException("Tỷ lệ không hỗ trợ.");
        if(model.endsWith("flash")&&!size.equals("720P"))throw new IllegalArgumentException("Agnes Flash chỉ hỗ trợ 720P.");
        if(!Arrays.asList("720P","1080P","2K").contains(size))throw new IllegalArgumentException("Độ phân giải không hỗ trợ.");
        if(images.size()>5)throw new IllegalArgumentException("Tối đa 5 ảnh tham chiếu cho mỗi cảnh.");
        if(!images.isEmpty()&&!firstFrame.isEmpty())throw new IllegalArgumentException("Không trộn keyframe và reference trong cùng request.");
        String p=prompt+(avoidSpeech?" Silent visual scene. No dialogue, no speech, no singing, no lip-sync, no talking mouths, no text overlays, no subtitles, no logos.":"");
        Map<String,Object> body=Json.obj("model",model,"prompt",p,"seconds",Integer.toString(seconds),"size",size,"aspect_ratio",aspect,"n",1);
        if(!images.isEmpty()){body.put("mode","reference");body.put("images",new ArrayList<>(images));}
        else if(!firstFrame.isEmpty()){body.put("mode","keyframe");body.put("first_frame",firstFrame);}
        else body.put("mode","text");
        return body;
    }
    public Map<String,Object> createVideo(String key,Map<String,Object> body)throws IOException{return request("POST","/v1/videos",key,body,120000);}
    public Map<String,Object> poll(String key,String videoId,String model)throws IOException{
        return request("GET","/agnesapi?video_id="+URLEncoder.encode(videoId,StandardCharsets.UTF_8.name())+"&model_name="+URLEncoder.encode(model,StandardCharsets.UTF_8.name()),key,null,45000);
    }
    public Map<String,Object> createSheet(String key,String descriptor)throws IOException{
        String prompt="Character reference sheet of ONE unique Vietnamese person, strictly Southern Vietnamese facial features and skin tone. "+descriptor+". Consistent identity, age, face, hairstyle and clothing across front portrait, three-quarter portrait, side profile and full-body standing views. Neutral light background, bright clear lighting, realistic anatomy, no extra limbs, no duplicate different people, no written text, no letters, no watermark.";
        return request("POST","/v1/images/generations",key,Json.obj("model","agnes-image-2.5-flash","prompt",prompt,"size","1K","ratio","1:1","extra_body",Json.obj("response_format","url")),300000);
    }
    private Map<String,Object> request(String method,String path,String key,Map<String,Object> body,int timeout)throws IOException{
        HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();
        c.setConnectTimeout(30000);c.setReadTimeout(timeout);c.setInstanceFollowRedirects(false);
        c.setRequestMethod(method);c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Accept","application/json");
        try{
            if(body!=null){byte[] bytes=Json.stringify(body).getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
            int code=c.getResponseCode();InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
            String response=in==null?"":readString(in,2*1024*1024);
            if(code<200||code>=300){
                String message=response.replace(key,"[ẩn key]");if(message.length()>900)message=message.substring(0,900);
                long retry=0;try{retry=Long.parseLong(c.getHeaderField("Retry-After"));}catch(Exception ignored){}
                throw new ApiException(code,message,retry);
            }
            try{Object parsed=Json.parse(response);if(!(parsed instanceof Map))throw new IllegalArgumentException();return Json.map(parsed);}
            catch(IllegalArgumentException e){throw new IOException("Agnes trả JSON không hợp lệ.");}
        }finally{c.disconnect();}
    }
    public static String videoId(Map<String,Object> result){
        String id=Json.str(result,"video_id","");if(!id.isEmpty())return id;
        return Json.str(result,"task_id",Json.str(result,"id",""));
    }
    public static String videoUrl(Map<String,Object> result){return Json.str(Json.map(result.get("metadata")),"url","");}
    public static String sheetUrl(Map<String,Object> result)throws IOException{
        List<Object> data=Json.list(result.get("data"));String url=data.isEmpty()?"":Json.str(Json.map(data.get(0)),"url","");
        if(url.isEmpty())throw new IOException("Agnes chưa trả URL ảnh character sheet.");return url;
    }
    public static void download(String url,File destination,Cancel cancel)throws IOException{
        validateUrl(url);String current=url;
        for(int redirects=0;redirects<=5;redirects++){
            HttpURLConnection c=(HttpURLConnection)new URL(current).openConnection();c.setConnectTimeout(30000);c.setReadTimeout(45000);c.setInstanceFollowRedirects(false);
            try{
                int code=c.getResponseCode();
                if(code>=300&&code<400){String location=c.getHeaderField("Location");if(location==null)throw new IOException("Media redirect thiếu URL.");current=new URL(new URL(current),location).toString();validateUrl(current);continue;}
                if(code!=200)throw new IOException("Tải media HTTP "+code);
                long expected=c.getContentLengthLong(),count=0;if(expected>2L*1024*1024*1024)throw new IOException("Media vượt 2 GB.");
                try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(destination)){
                    byte[] buffer=new byte[65536];int n;
                    while((n=in.read(buffer))>=0){if(cancel.stopped()||Thread.currentThread().isInterrupted())throw new InterruptedIOException("Đã tạm dừng.");out.write(buffer,0,n);count+=n;if(count>2L*1024*1024*1024)throw new IOException("Media vượt 2 GB.");}
                }
                if(count==0||expected>=0&&count!=expected)throw new IOException("Media tải chưa đủ dữ liệu.");return;
            }finally{c.disconnect();}
        }throw new IOException("Media redirect quá nhiều lần.");
    }
    private static String readString(InputStream stream,int max)throws IOException{
        try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[8192];int n;while((n=in.read(b))>=0){if(out.size()+n>max)throw new IOException("API response quá lớn.");out.write(b,0,n);}return out.toString("UTF-8");
        }
    }
    public static String uploadImage(String cloud,String preset,File file,Cancel cancel)throws IOException{
        if(!cloud.matches("[A-Za-z0-9_-]{1,100}")||preset.trim().isEmpty())throw new IOException("Cần Cloudinary cloud name và unsigned upload preset để đưa ảnh từ điện thoại lên.");
        if(file.length()>20L*1024*1024)throw new IOException("Ảnh quá 20 MB.");
        String boundary="AgnesBatch"+UUID.randomUUID();
        HttpURLConnection c=(HttpURLConnection)new URL("https://api.cloudinary.com/v1_1/"+cloud+"/image/upload").openConnection();
        c.setConnectTimeout(30000);c.setReadTimeout(90000);c.setRequestMethod("POST");c.setInstanceFollowRedirects(false);c.setDoOutput(true);c.setChunkedStreamingMode(65536);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
        try{
            try(OutputStream out=c.getOutputStream()){
                out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"upload_preset\"\r\n\r\n"+preset+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"frame.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))>=0){if(cancel.stopped())throw new InterruptedIOException("Đã dừng.");out.write(b,0,n);}}
                out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
            }
            int code=c.getResponseCode();InputStream responseStream=code>=200&&code<300?c.getInputStream():c.getErrorStream();String response=responseStream==null?"":readString(responseStream,1024*1024);
            if(code<200||code>=300)throw new IOException("Cloudinary HTTP "+code+": "+response.substring(0,Math.min(response.length(),400)));
            String url=Json.str(Json.map(Json.parse(response)),"secure_url","");validateUrl(url);return url;
        }finally{c.disconnect();}
    }
}
