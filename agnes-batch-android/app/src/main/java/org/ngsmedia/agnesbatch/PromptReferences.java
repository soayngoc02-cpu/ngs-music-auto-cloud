package org.ngsmedia.agnesbatch;

import java.util.*;
import java.util.regex.Matcher;

/** Builds one legal Agnes mode; keyframes and reference media must not be mixed. */
public final class PromptReferences {
    public static final class Identity {
        public final String tag,name,url;
        public Identity(String tag,String name,String url){this.tag=tag.toUpperCase(Locale.ROOT);this.name=name;this.url=url;}
    }
    public static final class Result {
        public final String prompt,firstFrame;public final List<String> images;
        Result(String prompt,String firstFrame,List<String> images){this.prompt=prompt;this.firstFrame=firstFrame;this.images=Collections.unmodifiableList(images);}
    }
    public static Result compose(String original,String sceneImage,List<Identity> identities){
        List<String> tags=PromptParser.tags(original),references=new ArrayList<>();StringBuilder instructions=new StringBuilder();String prompt=original;
        if(!sceneImage.isEmpty()&&!tags.isEmpty()){references.add(sceneImage);instructions.append("Use <Picture 1> as the scene composition reference. ");}
        for(String tag:tags){
            Identity identity=null;for(Identity candidate:identities)if(candidate.tag.equals(tag))identity=candidate;
            if(identity==null||identity.url.isEmpty())throw new IllegalArgumentException("Thiếu sheet @"+tag+".");
            references.add(identity.url);String placeholder="<Picture "+references.size()+">";
            prompt=prompt.replaceAll("(?i)(?<![\\p{L}\\p{N}_])@"+tag+"(?![\\p{L}\\p{N}_])",Matcher.quoteReplacement(identity.name+" ("+placeholder+")"));
            instructions.append("Use ").append(placeholder).append(" as the identity reference for ").append(identity.name).append(". Preserve the same face, age, hairstyle and wardrobe. One distinct person per identity; no duplicated people. ");
        }
        if(references.size()>5)throw new IllegalArgumentException("Cảnh này cần quá 5 ảnh tham chiếu. Giảm nhân vật hoặc bỏ ảnh cảnh.");
        return new Result(instructions+prompt,tags.isEmpty()?sceneImage:"",references);
    }
}
