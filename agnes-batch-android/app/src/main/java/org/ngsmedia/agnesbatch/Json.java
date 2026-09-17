package org.ngsmedia.agnesbatch;

import java.util.*;

/** Small strict JSON codec, shared by Android and the desktop protocol tests. */
public final class Json {
    private Json() {}
    public static Map<String,Object> obj(Object... pairs) {
        Map<String,Object> m = new LinkedHashMap<>();
        for (int i=0;i<pairs.length;i+=2) m.put((String)pairs[i],pairs[i+1]);
        return m;
    }
    @SuppressWarnings("unchecked") public static Map<String,Object> map(Object o) {
        return o instanceof Map ? (Map<String,Object>)o : Collections.emptyMap();
    }
    @SuppressWarnings("unchecked") public static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>)o : Collections.emptyList();
    }
    public static String str(Map<String,Object> m,String k,String d) {
        Object v=m.get(k); return v instanceof String ? (String)v : d;
    }
    public static double num(Map<String,Object> m,String k,double d) {
        Object v=m.get(k); return v instanceof Number ? ((Number)v).doubleValue() : d;
    }
    public static boolean bool(Map<String,Object> m,String k,boolean d) {
        Object v=m.get(k); return v instanceof Boolean ? (Boolean)v : d;
    }
    public static String stringify(Object value) {
        StringBuilder b=new StringBuilder(); write(value,b); return b.toString();
    }
    private static void write(Object v,StringBuilder b) {
        if(v==null){b.append("null");return;}
        if(v instanceof String){quote((String)v,b);return;}
        if(v instanceof Boolean){b.append(v);return;}
        if(v instanceof Number){
            if(!Double.isFinite(((Number)v).doubleValue()))throw new IllegalArgumentException("Non-finite JSON number");
            b.append(v);return;
        }
        if(v instanceof Map){
            b.append('{');boolean first=true;
            for(Map.Entry<?,?> e:((Map<?,?>)v).entrySet()){
                if(!first)b.append(',');first=false;quote((String)e.getKey(),b);b.append(':');write(e.getValue(),b);
            }b.append('}');return;
        }
        if(v instanceof Iterable){
            b.append('[');boolean first=true;
            for(Object o:(Iterable<?>)v){if(!first)b.append(',');first=false;write(o,b);}b.append(']');return;
        }
        throw new IllegalArgumentException("Unsupported JSON type");
    }
    private static void quote(String s,StringBuilder b){
        b.append('"');for(int i=0;i<s.length();i++){
            char c=s.charAt(i);
            switch(c){
                case '"':b.append("\\\"");break;case '\\':b.append("\\\\");break;
                case '\n':b.append("\\n");break;case '\r':b.append("\\r");break;case '\t':b.append("\\t");break;
                default:if(c<32)b.append(String.format(Locale.ROOT,"\\u%04x",(int)c));else b.append(c);
            }
        }b.append('"');
    }
    public static Object parse(String source){
        Reader r=new Reader(source);Object v=r.value(0);r.ws();
        if(r.p!=source.length())throw r.fail();return v;
    }
    private static final class Reader {
        final String s;int p; Reader(String s){this.s=s;}
        void ws(){while(p<s.length()&&" \t\r\n".indexOf(s.charAt(p))>=0)p++;}
        IllegalArgumentException fail(){return new IllegalArgumentException("Invalid JSON at "+p);}
        Object value(int depth){
            if(depth>64)throw fail();ws();if(p>=s.length())throw fail();char c=s.charAt(p);
            if(c=='"')return string();
            if(c=='{'){
                p++;Map<String,Object> m=new LinkedHashMap<>();ws();if(take('}'))return m;
                do{ws();if(p>=s.length()||s.charAt(p)!='"')throw fail();String k=string();ws();if(!take(':'))throw fail();m.put(k,value(depth+1));ws();if(take('}'))return m;}while(take(','));throw fail();
            }
            if(c=='['){
                p++;List<Object> a=new ArrayList<>();ws();if(take(']'))return a;
                do{a.add(value(depth+1));ws();if(take(']'))return a;}while(take(','));throw fail();
            }
            for(String literal:new String[]{"true","false","null"})if(s.startsWith(literal,p)){p+=literal.length();return literal.equals("null")?null:literal.equals("true");}
            int start=p;if(take('-')&&p==s.length())throw fail();
            if(take('0')){if(p<s.length()&&Character.isDigit(s.charAt(p)))throw fail();}
            else{int digits=p;while(p<s.length()&&s.charAt(p)>='0'&&s.charAt(p)<='9')p++;if(p==digits)throw fail();}
            boolean decimal=false;
            if(take('.')){decimal=true;int digits=p;while(p<s.length()&&Character.isDigit(s.charAt(p)))p++;if(p==digits)throw fail();}
            if(p<s.length()&&(s.charAt(p)=='e'||s.charAt(p)=='E')){decimal=true;p++;if(p<s.length()&&(s.charAt(p)=='+'||s.charAt(p)=='-'))p++;int digits=p;while(p<s.length()&&Character.isDigit(s.charAt(p)))p++;if(p==digits)throw fail();}
            try{if(decimal){double d=Double.parseDouble(s.substring(start,p));if(!Double.isFinite(d))throw fail();return d;}return Long.parseLong(s.substring(start,p));}catch(NumberFormatException e){throw fail();}
        }
        boolean take(char c){if(p<s.length()&&s.charAt(p)==c){p++;return true;}return false;}
        String string(){
            p++;StringBuilder b=new StringBuilder();while(p<s.length()){
                char c=s.charAt(p++);if(c=='"')return b.toString();if(c<32)throw fail();
                if(c!='\\'){b.append(c);continue;}if(p>=s.length())throw fail();c=s.charAt(p++);
                switch(c){
                    case '"':case '\\':case '/':b.append(c);break;case 'b':b.append('\b');break;case 'f':b.append('\f');break;case 'n':b.append('\n');break;case 'r':b.append('\r');break;case 't':b.append('\t');break;
                    case 'u':if(p+4>s.length())throw fail();try{b.append((char)Integer.parseInt(s.substring(p,p+4),16));}catch(NumberFormatException e){throw fail();}p+=4;break;
                    default:throw fail();
                }
            }throw fail();
        }
    }
}
