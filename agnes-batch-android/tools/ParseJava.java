import com.sun.source.util.JavacTask;
import java.nio.file.*;
import java.util.*;
import javax.tools.*;

/** Syntax check only; not a replacement for the real Android build. */
public final class ParseJava {
    public static void main(String[] args)throws Exception {
        List<String> sources=new ArrayList<>();
        try(var stream=Files.walk(Path.of(args[0]))){stream.filter(p->p.toString().endsWith(".java")).forEach(p->sources.add(p.toString()));}
        JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
        try(StandardJavaFileManager manager=compiler.getStandardFileManager(diagnostics,null,null)){
            JavacTask task=(JavacTask)compiler.getTask(null,manager,diagnostics,Arrays.asList("-proc:none","--release","17"),null,manager.getJavaFileObjectsFromStrings(sources));task.parse();
            for(Diagnostic<?> d:diagnostics.getDiagnostics())if(d.getKind()==Diagnostic.Kind.ERROR){System.err.println(d);System.exit(1);}
        }
        System.out.println("PASS: Java syntax parsed for "+sources.size()+" files. Android type/lint/build checks still require the SDK.");
    }
}
