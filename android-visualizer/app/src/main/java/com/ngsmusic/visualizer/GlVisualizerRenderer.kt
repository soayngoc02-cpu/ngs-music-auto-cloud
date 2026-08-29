package com.ngsmusic.visualizer

import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.EGLExt
import android.opengl.GLES20
import android.opengl.GLUtils
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

internal class EncoderEglSurface(private val surface: Surface) {
    private val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    private val config: android.opengl.EGLConfig
    private val context: android.opengl.EGLContext
    private val eglSurface: android.opengl.EGLSurface

    init {
        require(display != EGL14.EGL_NO_DISPLAY) { "Không tạo được EGL display" }
        val version = IntArray(2)
        require(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize thất bại" }
        val attribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            0x3142, 1,
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
        val count = IntArray(1)
        require(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0) { "Không tìm thấy EGL config cho encoder" }
        config = configs[0]!!
        context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        require(context != EGL14.EGL_NO_CONTEXT) { "Không tạo được EGL context" }
        eglSurface = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
        require(eglSurface != EGL14.EGL_NO_SURFACE) { "Không tạo được EGL window surface" }
        makeCurrent()
    }

    fun makeCurrent() { require(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)) { "eglMakeCurrent thất bại" } }
    fun setPresentationTime(nsecs: Long) { EGLExt.eglPresentationTimeANDROID(display, eglSurface, nsecs) }
    fun swapBuffers(): Boolean = EGL14.eglSwapBuffers(display, eglSurface)

    fun release() {
        runCatching { EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT) }
        runCatching { EGL14.eglDestroySurface(display, eglSurface) }
        runCatching { EGL14.eglDestroyContext(display, context) }
        runCatching { EGL14.eglReleaseThread() }
        runCatching { EGL14.eglTerminate(display) }
        runCatching { surface.release() }
    }
}

internal class GlVisualizerRenderer(
    private val width: Int,
    private val height: Int,
    background: Bitmap?,
    logo: Bitmap?,
    private val spectrum: SpectrumData,
    private val styleIndex: Int,
    private val colorIndex: Int,
    private val intensity: Float,
    private val logoX: Float,
    private val logoY: Float,
    private val logoScale: Float
) {
    private val colorProgram: Int
    private val textureProgram: Int
    private val bgTexture: Int
    private val logoTexture: Int
    private val bgW: Int
    private val bgH: Int
    private val logoW: Int
    private val logoH: Int
    private val waveDx = width * WaveLayoutState.offsetX
    private val waveDy = height * WaveLayoutState.offsetY

    init {
        GLES20.glViewport(0, 0, width, height)
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)

        colorProgram = createProgram(
            "attribute vec2 aPosition; attribute vec4 aColor; varying vec4 vColor; void main(){ gl_Position=vec4(aPosition,0.0,1.0); vColor=aColor; }",
            "precision mediump float; varying vec4 vColor; void main(){ gl_FragColor=vColor; }"
        )
        textureProgram = createProgram(
            "attribute vec2 aPosition; attribute vec2 aTex; varying vec2 vTex; void main(){ gl_Position=vec4(aPosition,0.0,1.0); vTex=aTex; }",
            "precision mediump float; uniform sampler2D uTex; uniform float uAlpha; varying vec2 vTex; void main(){ vec4 c=texture2D(uTex,vTex); gl_FragColor=vec4(c.rgb,c.a*uAlpha); }"
        )

        bgW = background?.width ?: 0
        bgH = background?.height ?: 0
        logoW = logo?.width ?: 0
        logoH = logo?.height ?: 0
        bgTexture = if (background != null) createTexture(background) else 0
        logoTexture = if (logo != null) createTexture(logo) else 0
    }

    fun draw(timeMs: Long) {
        GLES20.glClearColor(.02f, .03f, .065f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        if (bgTexture != 0) drawBackgroundTexture() else drawDefaultBackground()
        drawOverlay()

        val pulse = spectrum.pulseAt(timeMs)
        val bars = spectrum.barsAt(timeMs, 72)
        for (i in bars.indices) {
            val lowWeight = 1f - i.toFloat() / max(1, bars.lastIndex)
            val gain = .90f + pulse * (.18f + .24f * lowWeight)
            bars[i] = (bars[i] * gain).coerceIn(.015f, 1f)
        }

        when (styleIndex) {
            1 -> drawMirrorBars(bars)
            2 -> drawRadial(bars, pulse)
            3 -> drawLineWave(bars)
            4 -> drawBassHalo(bars, pulse)
            else -> drawNeonBars(bars)
        }
        if (logoTexture != 0) drawLogo(pulse)
    }

    private fun drawDefaultBackground() {
        val v = mutableListOf<Float>()
        addRect(v, 0f, 0f, width.toFloat(), height.toFloat(), intArrayOf(30, 12, 58), intArrayOf(2, 24, 45), 1f)
        drawColorVertices(v)
    }

    private fun drawBackgroundTexture() {
        val targetAspect = width.toFloat() / height
        val imageAspect = bgW.toFloat() / max(1, bgH)
        var u0 = 0f; var u1 = 1f; var v0 = 0f; var v1 = 1f
        if (imageAspect > targetAspect) {
            val visible = targetAspect / imageAspect
            u0 = (1f - visible) / 2f; u1 = 1f - u0
        } else {
            val visible = imageAspect / targetAspect
            v0 = (1f - visible) / 2f; v1 = 1f - v0
        }
        drawTexture(bgTexture, 0f, 0f, width.toFloat(), height.toFloat(), u0, u1, v0, v1, 1f)
    }

    private fun drawOverlay() {
        val all = mutableListOf<Float>()
        addRect(all, 0f, 0f, width.toFloat(), height.toFloat(), intArrayOf(0, 0, 0), intArrayOf(0, 0, 0), .27f)
        drawColorVertices(all)
        val bottom = mutableListOf<Float>()
        addRect(bottom, 0f, height * .48f, width.toFloat(), height.toFloat(), intArrayOf(0, 0, 0), intArrayOf(0, 0, 0), .30f)
        drawColorVertices(bottom)
    }

    private fun drawNeonBars(bars: FloatArray) {
        val p = palette(); val base = height * .72f + waveDy; val total = width * .82f; val x0 = (width - total) / 2f + waveDx; val slot = total / bars.size; val bw = slot * .62f; val mh = height * .24f * intensity
        val glow = mutableListOf<Float>(); val solid = mutableListOf<Float>()
        for (i in bars.indices) {
            val h = max(4f, mh * bars[i]); val x = x0 + i * slot + (slot - bw) / 2f; val c = mixColor(p.first, p.second, i.toFloat() / max(1, bars.lastIndex))
            addRect(glow, x - bw * .55f, base - h - bw * .5f, x + bw * 1.55f, base + bw * .5f, c, c, .14f)
            addRect(solid, x, base - h, x + bw, base, c, c, .96f)
        }
        drawColorVertices(glow); drawColorVertices(solid)
    }

    private fun drawMirrorBars(bars: FloatArray) {
        val p = palette(); val mid = height * .67f + waveDy; val total = width * .84f; val x0 = (width - total) / 2f + waveDx; val slot = total / bars.size; val bw = slot * .56f; val mh = height * .17f * intensity
        val v = mutableListOf<Float>()
        for (i in bars.indices) {
            val h = mh * bars[i]; val x = x0 + i * slot + (slot - bw) / 2f; val c = mixColor(p.first, p.second, i.toFloat() / max(1, bars.lastIndex))
            addRect(v, x, mid - h, x + bw, mid + h, c, c, .94f)
        }
        addRect(v, x0, mid - max(1f, height * .0012f), x0 + total, mid + max(1f, height * .0012f), intArrayOf(235, 240, 255), intArrayOf(235, 240, 255), .5f)
        drawColorVertices(v)
    }

    private fun drawRadial(bars: FloatArray, pulse: Float) {
        val p = palette(); val cx = width / 2f + waveDx; val cy = height * .49f + waveDy; val ms = min(width, height).toFloat(); val r = ms * (.16f + pulse * .018f); val ml = ms * .12f * intensity; val th = max(3f, ms * .008f)
        val glow = mutableListOf<Float>(); val solid = mutableListOf<Float>()
        for (i in bars.indices) {
            val a = (2.0 * PI * i / bars.size - PI / 2).toFloat(); val len = ml * bars[i]
            val x1 = cx + cos(a) * r; val y1 = cy + sin(a) * r; val x2 = cx + cos(a) * (r + len); val y2 = cy + sin(a) * (r + len)
            val c = mixColor(p.first, p.second, i.toFloat() / max(1, bars.lastIndex))
            addLineQuad(glow, x1, y1, x2, y2, th * 2.6f, c, .12f); addLineQuad(solid, x1, y1, x2, y2, th, c, .96f)
        }
        drawColorVertices(glow); drawColorVertices(solid)
    }

    private fun drawLineWave(bars: FloatArray) {
        val p = palette(); val base = height * .69f + waveDy; val total = width * .84f; val x0 = (width - total) / 2f + waveDx; val amp = height * .17f * intensity; val th = max(3f, width * .006f)
        val glow = mutableListOf<Float>(); val solid = mutableListOf<Float>(); var px = 0f; var py = 0f
        for (i in bars.indices) {
            val x = x0 + i * total / max(1, bars.lastIndex); val y = base + (if (i % 2 == 0) -1f else 1f) * amp * bars[i] * .58f
            if (i > 0) { val c = mixColor(p.first, p.second, i.toFloat() / max(1, bars.lastIndex)); addLineQuad(glow, px, py, x, y, th * 3, c, .13f); addLineQuad(solid, px, py, x, y, th, c, .98f) }
            px = x; py = y
        }
        drawColorVertices(glow); drawColorVertices(solid)
    }

    private fun drawBassHalo(bars: FloatArray, pulse: Float) {
        val p = palette(); val cx = width / 2f + waveDx; val cy = height * .49f + waveDy; val ms = min(width, height).toFloat(); val r = ms * (.18f + pulse * .065f)
        val ring = mutableListOf<Float>()
        for (i in 0 until 96) {
            val a1 = (2.0 * PI * i / 96).toFloat(); val a2 = (2.0 * PI * (i + 1) / 96).toFloat(); val c = mixColor(p.first, p.second, i / 96f)
            addLineQuad(ring, cx + cos(a1) * r, cy + sin(a1) * r, cx + cos(a2) * r, cy + sin(a2) * r, max(3f, ms * .009f), c, .95f)
        }
        drawColorVertices(ring)
        drawRadial(FloatArray(36) { bars[it * 2 % bars.size] }, pulse * .28f)
    }

    private fun drawLogo(pulse: Float) {
        val base = min(width, height) * .22f * logoScale.coerceIn(.35f, 2.5f) * (1f + pulse * .018f)
        val aspect = logoW.toFloat() / max(1, logoH)
        val w: Float; val h: Float
        if (aspect >= 1f) { w = base; h = base / aspect } else { h = base; w = base * aspect }
        val cx = width * logoX.coerceIn(0f, 1f)
        val cy = height * logoY.coerceIn(0f, 1f)
        drawTexture(logoTexture, cx - w / 2f, cy - h / 2f, w, h, 0f, 1f, 0f, 1f, 1f)
    }

    private fun drawTexture(tex: Int, x: Float, y: Float, w: Float, h: Float, u0: Float, u1: Float, v0: Float, v1: Float, alpha: Float) {
        GLES20.glUseProgram(textureProgram)
        val pl = GLES20.glGetAttribLocation(textureProgram, "aPosition")
        val tl = GLES20.glGetAttribLocation(textureProgram, "aTex")
        val al = GLES20.glGetUniformLocation(textureProgram, "uAlpha")
        val sl = GLES20.glGetUniformLocation(textureProgram, "uTex")
        val l = ndcX(x); val r = ndcX(x + w); val t = ndcY(y); val b = ndcY(y + h)
        val fb = floatBuffer(floatArrayOf(l, t, u0, v0, l, b, u0, v1, r, t, u1, v0, r, t, u1, v0, l, b, u0, v1, r, b, u1, v1))
        fb.position(0); GLES20.glEnableVertexAttribArray(pl); GLES20.glVertexAttribPointer(pl, 2, GLES20.GL_FLOAT, false, 16, fb)
        fb.position(2); GLES20.glEnableVertexAttribArray(tl); GLES20.glVertexAttribPointer(tl, 2, GLES20.GL_FLOAT, false, 16, fb)
        GLES20.glUniform1f(al, alpha); GLES20.glActiveTexture(GLES20.GL_TEXTURE0); GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex); GLES20.glUniform1i(sl, 0)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6)
        GLES20.glDisableVertexAttribArray(pl); GLES20.glDisableVertexAttribArray(tl); GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
    }

    private fun drawColorVertices(v: List<Float>) {
        if (v.isEmpty()) return
        GLES20.glUseProgram(colorProgram)
        val pl = GLES20.glGetAttribLocation(colorProgram, "aPosition")
        val cl = GLES20.glGetAttribLocation(colorProgram, "aColor")
        val fb = floatBuffer(v.toFloatArray())
        fb.position(0); GLES20.glEnableVertexAttribArray(pl); GLES20.glVertexAttribPointer(pl, 2, GLES20.GL_FLOAT, false, 24, fb)
        fb.position(2); GLES20.glEnableVertexAttribArray(cl); GLES20.glVertexAttribPointer(cl, 4, GLES20.GL_FLOAT, false, 24, fb)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, v.size / 6)
        GLES20.glDisableVertexAttribArray(pl); GLES20.glDisableVertexAttribArray(cl)
    }

    private fun addRect(out: MutableList<Float>, left: Float, top: Float, right: Float, bottom: Float, ct: IntArray, cb: IntArray, alpha: Float) {
        val l = ndcX(left); val r = ndcX(right); val t = ndcY(top); val b = ndcY(bottom)
        vertex(out, l, t, ct, alpha); vertex(out, l, b, cb, alpha); vertex(out, r, t, ct, alpha)
        vertex(out, r, t, ct, alpha); vertex(out, l, b, cb, alpha); vertex(out, r, b, cb, alpha)
    }

    private fun addLineQuad(out: MutableList<Float>, x1: Float, y1: Float, x2: Float, y2: Float, thickness: Float, color: IntArray, alpha: Float) {
        val dx = x2 - x1; val dy = y2 - y1; val len = sqrt(dx * dx + dy * dy).coerceAtLeast(.001f); val nx = -dy / len * thickness / 2f; val ny = dx / len * thickness / 2f
        val p1x = x1 + nx; val p1y = y1 + ny; val p2x = x1 - nx; val p2y = y1 - ny; val p3x = x2 + nx; val p3y = y2 + ny; val p4x = x2 - nx; val p4y = y2 - ny
        tri(out, p1x, p1y, p2x, p2y, p3x, p3y, color, alpha); tri(out, p3x, p3y, p2x, p2y, p4x, p4y, color, alpha)
    }

    private fun tri(out: MutableList<Float>, ax: Float, ay: Float, bx: Float, by: Float, cx: Float, cy: Float, color: IntArray, alpha: Float) {
        vertex(out, ndcX(ax), ndcY(ay), color, alpha); vertex(out, ndcX(bx), ndcY(by), color, alpha); vertex(out, ndcX(cx), ndcY(cy), color, alpha)
    }

    private fun vertex(out: MutableList<Float>, x: Float, y: Float, c: IntArray, alpha: Float) {
        out.add(x); out.add(y); out.add(c[0] / 255f); out.add(c[1] / 255f); out.add(c[2] / 255f); out.add(alpha)
    }

    private fun ndcX(x: Float) = x / width * 2f - 1f
    private fun ndcY(y: Float) = 1f - y / height * 2f

    private fun palette(): Pair<IntArray, IntArray> = when (colorIndex) {
        1 -> intArrayOf(255, 76, 122) to intArrayOf(255, 190, 74)
        2 -> intArrayOf(68, 221, 255) to intArrayOf(88, 120, 255)
        3 -> intArrayOf(255, 211, 78) to intArrayOf(255, 118, 39)
        4 -> intArrayOf(245, 245, 255) to intArrayOf(150, 160, 180)
        else -> intArrayOf(178, 73, 255) to intArrayOf(39, 227, 255)
    }

    private fun mixColor(a: IntArray, b: IntArray, t: Float) = intArrayOf(
        (a[0] + (b[0] - a[0]) * t).toInt(),
        (a[1] + (b[1] - a[1]) * t).toInt(),
        (a[2] + (b[2] - a[2]) * t).toInt()
    )

    private fun createTexture(bitmap: Bitmap): Int {
        val ids = IntArray(1); GLES20.glGenTextures(1, ids, 0); val id = ids[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
        return id
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val ok = IntArray(1); GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0)
        if (ok[0] == 0) { val log = GLES20.glGetShaderInfoLog(shader); GLES20.glDeleteShader(shader); error("Shader lỗi: $log") }
        return shader
    }

    private fun createProgram(vertex: String, fragment: String): Int {
        val vs = compileShader(GLES20.GL_VERTEX_SHADER, vertex); val fs = compileShader(GLES20.GL_FRAGMENT_SHADER, fragment); val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, vs); GLES20.glAttachShader(p, fs); GLES20.glLinkProgram(p)
        val ok = IntArray(1); GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
        GLES20.glDeleteShader(vs); GLES20.glDeleteShader(fs)
        if (ok[0] == 0) { val log = GLES20.glGetProgramInfoLog(p); GLES20.glDeleteProgram(p); error("GL program lỗi: $log") }
        return p
    }

    private fun floatBuffer(values: FloatArray): FloatBuffer = ByteBuffer.allocateDirect(values.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(values); position(0) }

    fun release() {
        if (bgTexture != 0) GLES20.glDeleteTextures(1, intArrayOf(bgTexture), 0)
        if (logoTexture != 0) GLES20.glDeleteTextures(1, intArrayOf(logoTexture), 0)
        GLES20.glDeleteProgram(colorProgram)
        GLES20.glDeleteProgram(textureProgram)
    }
}
