package org.ngsmedia.agnesbatch;

public final class QueueRules {
    private QueueRules(){}
    public static long backoff(int failure,long retryAfterSeconds){
        return Math.min(120000,Math.max(2000L << Math.min(Math.max(failure,0),5),retryAfterSeconds*1000));
    }
    public static boolean resumeExisting(String videoId,boolean remoteFailed){return videoId!=null&&!videoId.isEmpty()&&!remoteFailed;}
    public static boolean uncertainSubmission(String state,String videoId){return "SUBMITTING".equals(state)&&(videoId==null||videoId.isEmpty());}
    public static boolean mayMerge(int expected,int done){return expected>0&&expected==done;}
}
