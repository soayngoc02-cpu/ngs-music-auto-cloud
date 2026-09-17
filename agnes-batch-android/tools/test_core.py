#!/usr/bin/env python3
"""Run meaningful desktop tests using the compiler module even on a JRE image."""
import pathlib, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
sources=root/'app/src/main/java/org/ngsmedia/agnesbatch'
with tempfile.TemporaryDirectory(prefix='agnes-core-tests-') as output:
    subprocess.run(['java','-m','jdk.compiler/com.sun.tools.javac.Main','--release','17','--add-modules','jdk.httpserver','-Xlint:all','-d',output,*[str(sources/name) for name in ['Json.java','PromptParser.java','QueueRules.java','AgnesClient.java','PromptReferences.java','VideoOrder.java']],str(root/'tests/CoreTests.java')],check=True)
    subprocess.run(['java','--add-modules','jdk.httpserver','-cp',output,'org.ngsmedia.agnesbatch.CoreTests'],check=True)
