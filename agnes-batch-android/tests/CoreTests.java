package org.ngsmedia.agnesbatch;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class CoreTests {
    private static int passed;
    static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);passed++;}
    static void rejects(Runnable action,String message){try{action.run();throw new AssertionError(message);}catch(IllegalArgumentException expected){passed++;}}
    static void respond(HttpExchange e,int status,Map<String,Object> body)throws IOException{byte[] data=Json.stringify(body).getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(status,data.length);try(OutputStream out=e.getResponseBody()){out.write(data);}}
    public static void main(String[] args)throws Exception{
        List<PromptParser.Prompt> prompts=PromptParser.parse("\uFEFF001 | 4s | @A steps forward.\r\nKeep the camera vertical.\r\n\r\n5 giây: @B looks at the river.\r\n\r\nA quiet wooden boat.",8);
        check(prompts.size()==3,"blank line scenes");check(prompts.get(0).seconds==4,"indexed seconds");check(prompts.get(1).seconds==5,"Vietnamese seconds");check(prompts.get(2).seconds==8&&!prompts.get(2).explicitSeconds,"default seconds");check(prompts.get(0).text.equals("@A steps forward. Keep the camera vertical."),"two-line merge");
        check(PromptParser.parse("[12s] A quiet room.",5).get(0).seconds==12,"bracket seconds");check(PromptParser.parse("6 | A room.",5).get(0).seconds==6,"bare duration");check(PromptParser.parse("004 | A room.",5).get(0).seconds==5,"index is not seconds");check(PromptParser.parse("1956: A wooden house.",5).get(0).seconds==5,"year is not duration");
        check(PromptParser.parse("7 A quiet room.",5).get(0).seconds==7,"plain leading seconds");check(PromptParser.parse("8|A quiet room.",5).get(0).seconds==8,"duration delimiter without spaces");
        rejects(()->PromptParser.parse("3s | A room.",5),"lower API limit");rejects(()->PromptParser.parse("13s | A room.",5),"upper API limit");rejects(()->PromptParser.parse("4.5s | A room.",5),"fractional API duration");rejects(()->PromptParser.parse("a\nb\nc",5),"over two lines");rejects(()->PromptParser.parse("  ",5),"empty file");rejects(()->PromptParser.parse("4s | ",5),"empty scene");
        String fifty=String.join("\n\n",Collections.nCopies(50,"4s | A room."));check(PromptParser.parse(fifty,5).size()==50,"batch of 50");rejects(()->PromptParser.parse(fifty+"\n\nA room.",5),"batch limit");
        check(PromptParser.tags("@A @a @B @Aabc @A. email@example.com").equals(Arrays.asList("A","B","AABC")),"exact character tags");
        byte[] utf16="Một chiếc ghe".getBytes(StandardCharsets.UTF_16);check(PromptParser.decode(utf16).equals("Một chiếc ghe"),"UTF16 BOM");check(PromptParser.importKeys("Bearer secret-key-123\r\n\r\n# ignored\r\nsecret-key-123\r\nother-key-456").size()==2,"key deduplication");rejects(()->PromptParser.importKeys("name: key sample"),"invalid key format");
        Map<String,Object> payload=Json.obj("vietnamese","Mắt người Việt\n\\\"","data",Arrays.asList(1,true,null,Json.obj("n",2.5)));
        check(Json.stringify(Json.parse(Json.stringify(payload))).equals(Json.stringify(payload)),"JSON round trip");rejects(()->Json.parse("{\"a\":1,}"),"JSON trailing comma");rejects(()->Json.parse("01"),"leading zero");rejects(()->Json.parse("[1] ignored"),"JSON trailing data");
        check(QueueRules.resumeExisting("video-id",false),"resume job");check(!QueueRules.resumeExisting("video-id",true),"failed jobs can recreate");check(QueueRules.uncertainSubmission("SUBMITTING",""),"recover lost submission");check(!QueueRules.mayMerge(5,4)&&QueueRules.mayMerge(5,5),"do not skip failed scenes");check(QueueRules.backoff(3,40)>=40000,"respect Retry-After");
        List<PromptReferences.Identity> identities=Arrays.asList(new PromptReferences.Identity("A","Tuấn","https://x.test/a.png"),new PromptReferences.Identity("B","Thầy Hai","https://x.test/b.png"),new PromptReferences.Identity("AABC","Người khác","https://x.test/other.png"));
        PromptReferences.Result composed=PromptReferences.compose("@a meets @B. @Aabc watches.","https://x.test/frame.jpg",identities);
        check(composed.images.equals(Arrays.asList("https://x.test/frame.jpg","https://x.test/a.png","https://x.test/b.png","https://x.test/other.png")),"scene and identity image order");check(composed.firstFrame.isEmpty()&&composed.prompt.contains("Tuấn (<Picture 2>)")&&composed.prompt.contains("Người khác (<Picture 4>)"),"exact case-insensitive identity substitution");
        check(PromptReferences.compose("An empty room.","https://x.test/frame.jpg",identities).firstFrame.endsWith("frame.jpg"),"image-only uses keyframe");rejects(()->PromptReferences.compose("@MISSING enters.","",identities),"reject missing character");
        List<VideoOrder.Item> reversed=new ArrayList<>();for(int i=50;i>=1;i--)reversed.add(new VideoOrder.Item(i,"DONE",i+".mp4"));List<VideoOrder.Item> timeline=VideoOrder.timeline(50,reversed);
        check(timeline.get(0).path.equals("1.mp4")&&timeline.get(1).path.equals("2.mp4")&&timeline.get(9).path.equals("10.mp4")&&timeline.get(49).path.equals("50.mp4"),"50 clips sorted numerically after reverse completion");
        rejects(()->VideoOrder.timeline(2,Arrays.asList(new VideoOrder.Item(1,"DONE","1.mp4"),new VideoOrder.Item(2,"ERROR",""))),"failed scenes block merge");rejects(()->VideoOrder.timeline(2,Arrays.asList(new VideoOrder.Item(1,"DONE","1.mp4"),new VideoOrder.Item(1,"DONE","other.mp4"))),"duplicate index blocks merge");rejects(()->VideoOrder.timeline(3,Arrays.asList(new VideoOrder.Item(1,"DONE","1.mp4"),new VideoOrder.Item(3,"DONE","3.mp4"))),"missing scene blocks merge");
        Map<String,Object> text=AgnesClient.videoBody("agnes-video-2.5-flash","A scene.",4,"9:16","720P",Collections.emptyList(),"",true);
        check(text.get("seconds").equals("4")&&text.get("mode").equals("text"),"documented duration and mode");check(!text.containsKey("num_frames")&&!text.containsKey("width")&&!text.containsKey("negative_prompt"),"no unsupported fields");
        Map<String,Object> image=AgnesClient.videoBody("agnes-video-2.5-flash","A scene.",7,"1:1","720P",Collections.emptyList(),"https://media.example/frame.png",false);check(image.get("mode").equals("keyframe")&&image.containsKey("first_frame"),"I2V keyframe");
        Map<String,Object> ref=AgnesClient.videoBody("agnes-video-2.5","Use <Picture 1>.",9,"16:9","1080P",Arrays.asList("https://media.example/sheet.png"),"",false);check(ref.get("mode").equals("reference")&&ref.containsKey("images"),"actual character reference");
        rejects(()->AgnesClient.videoBody("agnes-video-2.5-flash","A scene.",5,"9:16","1080P",Collections.emptyList(),"",false),"Flash resolution limit");rejects(()->AgnesClient.videoBody("agnes-video-2.5-flash","A scene.",5,"9:16","720P",Collections.nCopies(6,"https://x.test/i.png"),"",false),"reference limit");rejects(()->AgnesClient.videoBody("agnes-video-2.5-flash","A scene.",5,"9:16","720P",Arrays.asList("https://x.test/i.png"),"https://x.test/f.png",false),"exclusive modes");rejects(()->new AgnesClient("http://example.com"),"HTTPS required");
        String secret="TEST-KEY-NOT-REAL";AtomicInteger creates=new AtomicInteger(),polls=new AtomicInteger();List<Integer> order=new ArrayList<>();
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);int port=server.getAddress().getPort();String base="http://127.0.0.1:"+port;
        server.createContext("/v1/videos",e->{
            try{check(e.getRequestHeaders().getFirst("Authorization").equals("Bearer "+secret),"bearer on Agnes endpoint");Map<String,Object> b=Json.map(Json.parse(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)));check(b.get("seconds").equals("4"),"wire duration");creates.incrementAndGet();respond(e,200,Json.obj("video_id","opaque/id+1","task_id","task-id","status","queued"));}
            catch(Throwable t){respond(e,500,Json.obj("error",t.toString()));}
        });
        server.createContext("/agnesapi",e->{
            check(e.getRequestURI().getRawQuery().contains("video_id=opaque%2Fid%2B1")&&e.getRequestURI().getRawQuery().contains("model_name=agnes-video-2.5-flash"),"encoded opaque ID and model");int count=polls.incrementAndGet();respond(e,200,count==1?Json.obj("status","in_progress","progress",50):Json.obj("status","completed","metadata",Json.obj("url",base+"/media/002.mp4")));
        });
        server.createContext("/media/002.mp4",e->{check(e.getRequestHeaders().getFirst("Authorization")==null,"no API key to media host");byte[] data="fixture-media-data".getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,data.length);try(OutputStream out=e.getResponseBody()){out.write(data);}order.add(2);});
        server.createContext("/v1/images/generations",e->{Map<String,Object> b=Json.map(Json.parse(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)));check(b.get("model").equals("agnes-image-2.5-flash")&&b.get("ratio").equals("1:1"),"sheet request fields");respond(e,200,Json.obj("data",Arrays.asList(Json.obj("url","https://media.example/sheet.png"))));});
        server.createContext("/error/v1/videos",e->{e.getResponseHeaders().set("Retry-After","30");respond(e,429,Json.obj("error","Echo "+secret));});
        server.start();File temp=Files.createTempFile("agnes-test-",".mp4").toFile();
        try{
            AgnesClient client=new AgnesClient(base+"/v1");Map<String,Object> created=client.createVideo(secret,text);String id=AgnesClient.videoId(created);check(id.equals("opaque/id+1"),"prefer video_id");check(client.poll(secret,id,"agnes-video-2.5-flash").get("status").equals("in_progress"),"poll in-progress");String url=AgnesClient.videoUrl(client.poll(secret,id,"agnes-video-2.5-flash"));AgnesClient.download(url,temp,()->false);check(Files.readString(temp.toPath()).equals("fixture-media-data"),"complete media download");check(creates.get()==1&&polls.get()==2,"resume polling never resubmits");check(AgnesClient.sheetUrl(client.createSheet(secret,"Nam 35 tuổi, áo bà ba nâu.")).endsWith("sheet.png"),"generated sheet URL");
            try{new AgnesClient(base+"/error").createVideo(secret,text);throw new AssertionError("rate limit not reported");}catch(AgnesClient.ApiException e){check(e.code==429&&e.retryAfterSeconds==30&&!e.getMessage().contains(secret),"rate limit and secret redaction");}
        }finally{server.stop(0);temp.delete();}
        System.out.println("PASS: "+passed+" assertions (parser, duration, keys, JSON, queue recovery and mocked Agnes HTTP protocol).");
    }
}
