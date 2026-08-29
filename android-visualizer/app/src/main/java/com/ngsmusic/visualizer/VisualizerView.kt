package com.ngsmusic.visualizer

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class VisualizerView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    var spectrum: SpectrumData? = null; set(value) { field = value; invalidate() }
    var backgroundBitmap: Bitmap? = null; set(value) { field = value; invalidate() }
    var logoBitmap: Bitmap? = null; set(value) { field = value; invalidate() }
    var timeMs: Long = 0L; set(value) { field = value; invalidate() }
    var styleIndex: Int = 0; set(value) { field = value; invalidate() }
    var colorIndex: Int = 0; set(value) { field = value; invalidate() }
    var ratioIndex: Int = 0; set(value) { field = value; invalidate() }
    var intensity: Float = 1f; set(value) { field = value.coerceIn(.5f, 1.8f); invalidate() }

    var logoX: Float = .5f; set(value) { field = value.coerceIn(0f, 1f); invalidate(); notifyLogo() }
    var logoY: Float = .48f; set(value) { field = value.coerceIn(0f, 1f); invalidate(); notifyLogo() }
    var logoScale: Float = 1f; set(value) { field = value.coerceIn(.35f, 2.5f); invalidate(); notifyLogo() }
    var onLogoTransformChanged: ((Float, Float, Float) -> Unit)? = null

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val path = Path()
    private val content = RectF()
    private var draggingLogo = false
    private var downX = 0f
    private var downY = 0f
    private var downLogoX = .5f
    private var downLogoY = .48f

    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean = draggingLogo && logoBitmap != null
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            if (!draggingLogo || logoBitmap == null) return false
            logoScale = (logoScale * detector.scaleFactor).coerceIn(.35f, 2.5f)
            return true
        }
    })

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        isClickable = true
    }

    fun resetLogoTransform() {
        logoX = .5f
        logoY = .48f
        logoScale = 1f
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(5, 8, 16))
        computeContentRect()
        canvas.save()
        canvas.clipRect(content)
        drawBackground(canvas)
        drawOverlay(canvas)
        drawVisualizer(canvas)
        drawLogo(canvas)
        canvas.restore()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (logoBitmap == null) return super.onTouchEvent(event)
        computeContentRect()
        scaleDetector.onTouchEvent(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (!content.contains(event.x, event.y) || !currentLogoRect().contains(event.x, event.y)) {
                    draggingLogo = false
                    return super.onTouchEvent(event)
                }
                draggingLogo = true
                downX = event.x
                downY = event.y
                downLogoX = logoX
                downLogoY = logoY
                parent?.requestDisallowInterceptTouchEvent(true)
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (draggingLogo && !scaleDetector.isInProgress) {
                    logoX = (downLogoX + (event.x - downX) / max(1f, content.width())).coerceIn(0f, 1f)
                    logoY = (downLogoY + (event.y - downY) / max(1f, content.height())).coerceIn(0f, 1f)
                }
                return draggingLogo || scaleDetector.isInProgress
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val handled = draggingLogo
                draggingLogo = false
                parent?.requestDisallowInterceptTouchEvent(false)
                invalidate()
                if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
                return handled
            }
        }
        return draggingLogo || scaleDetector.isInProgress || super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun notifyLogo() {
        onLogoTransformChanged?.invoke(logoX, logoY, logoScale)
    }

    private fun computeContentRect() {
        val targetAspect = when (ratioIndex) { 1 -> 16f / 9f; 2 -> 1f; else -> 9f / 16f }
        val viewAspect = width.toFloat() / max(1, height).toFloat()
        if (viewAspect > targetAspect) {
            val w = height * targetAspect
            val l = (width - w) / 2f
            content.set(l, 0f, l + w, height.toFloat())
        } else {
            val h = width / targetAspect
            val t = (height - h) / 2f
            content.set(0f, t, width.toFloat(), t + h)
        }
    }

    private fun drawBackground(canvas: Canvas) {
        val bg = backgroundBitmap
        if (bg == null) {
            paint.shader = LinearGradient(content.left, content.top, content.right, content.bottom, Color.rgb(19, 10, 39), Color.rgb(3, 18, 34), Shader.TileMode.CLAMP)
            canvas.drawRect(content, paint)
            paint.shader = null
            return
        }
        canvas.drawBitmap(bg, centerCropSource(bg.width, bg.height, content.width(), content.height()), content, paint)
    }

    private fun drawOverlay(canvas: Canvas) {
        paint.shader = LinearGradient(0f, content.top, 0f, content.bottom, intArrayOf(Color.argb(45, 0, 0, 0), Color.argb(105, 0, 0, 0), Color.argb(165, 0, 0, 0)), floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP)
        canvas.drawRect(content, paint)
        paint.shader = null
        paint.shader = RadialGradient(content.centerX(), content.centerY(), max(content.width(), content.height()) * .68f, Color.TRANSPARENT, Color.argb(125, 0, 0, 0), Shader.TileMode.CLAMP)
        canvas.drawRect(content, paint)
        paint.shader = null
    }

    private fun drawVisualizer(canvas: Canvas) {
        val d = spectrum
        val pulse = d?.pulseAt(timeMs) ?: 0f
        val bars = d?.barsAt(timeMs, 72) ?: idleBars(72)
        if (d != null) {
            // Keep the real FFT shape, but let detected beats breathe the whole visualizer subtly.
            for (i in bars.indices) {
                val lowWeight = 1f - i.toFloat() / max(1, bars.lastIndex)
                val gain = .90f + pulse * (.18f + .24f * lowWeight)
                bars[i] = (bars[i] * gain).coerceIn(.015f, 1f)
            }
        }
        when (styleIndex) {
            1 -> drawMirrorBars(canvas, bars)
            2 -> drawRadial(canvas, bars, pulse)
            3 -> drawLineWave(canvas, bars)
            4 -> drawBassHalo(canvas, bars, pulse)
            else -> drawNeonBars(canvas, bars)
        }
    }

    private fun drawNeonBars(canvas: Canvas, bars: FloatArray) {
        val p = palette(); val base = content.top + content.height() * .71f; val total = content.width() * .82f; val x0 = content.centerX() - total / 2f
        val gap = total / bars.size * .34f; val bw = total / bars.size - gap; val mh = content.height() * .24f * intensity
        paint.shader = LinearGradient(0f, base - mh, 0f, base, p.first, p.second, Shader.TileMode.CLAMP); paint.strokeCap = Paint.Cap.ROUND
        for (i in bars.indices) { val h = max(3f, mh * bars[i]); val l = x0 + i * (bw + gap); paint.setShadowLayer(max(4f, bw * 1.6f), 0f, 0f, p.first); canvas.drawRoundRect(l, base - h, l + bw, base, bw, bw, paint) }
        paint.clearShadowLayer(); paint.shader = null
    }

    private fun drawMirrorBars(canvas: Canvas, bars: FloatArray) {
        val p = palette(); val mid = content.top + content.height() * .66f; val total = content.width() * .84f; val x0 = content.centerX() - total / 2f; val slot = total / bars.size; val bw = slot * .55f; val mh = content.height() * .17f * intensity
        paint.shader = LinearGradient(0f, mid - mh, 0f, mid + mh, p.first, p.second, Shader.TileMode.CLAMP)
        for (i in bars.indices) { val h = mh * bars[i]; val x = x0 + i * slot + (slot - bw) / 2f; paint.setShadowLayer(max(4f, bw * 1.6f), 0f, 0f, p.first); canvas.drawRoundRect(x, mid - h, x + bw, mid + h, bw, bw, paint) }
        paint.clearShadowLayer(); paint.shader = null; paint.color = Color.argb(110, 255, 255, 255); paint.strokeWidth = max(1f, content.width() * .0022f); canvas.drawLine(x0, mid, x0 + total, mid, paint)
    }

    private fun drawRadial(canvas: Canvas, bars: FloatArray, pulse: Float) {
        val p = palette(); val cx = content.centerX(); val cy = content.top + content.height() * .49f; val ms = min(content.width(), content.height()); val r = ms * (.16f + pulse * .018f); val ml = ms * .12f * intensity
        paint.strokeWidth = max(2f, ms * .008f); paint.strokeCap = Paint.Cap.ROUND; paint.shader = SweepGradient(cx, cy, intArrayOf(p.first, p.second, p.first), null); paint.setShadowLayer(paint.strokeWidth * 2, 0f, 0f, p.first)
        for (i in bars.indices) { val a = 2.0 * PI * i / bars.size - PI / 2; val r2 = r + ml * bars[i]; canvas.drawLine(cx + cos(a).toFloat() * r, cy + sin(a).toFloat() * r, cx + cos(a).toFloat() * r2, cy + sin(a).toFloat() * r2, paint) }
        paint.clearShadowLayer(); paint.shader = null
    }

    private fun drawLineWave(canvas: Canvas, bars: FloatArray) {
        val p = palette(); val base = content.top + content.height() * .68f; val total = content.width() * .84f; val x0 = content.centerX() - total / 2f; val amp = content.height() * .17f * intensity
        path.reset()
        for (i in bars.indices) { val x = x0 + i * total / (bars.size - 1).coerceAtLeast(1); val y = base + (if (i % 2 == 0) -1f else 1f) * amp * bars[i] * .58f; if (i == 0) path.moveTo(x, y) else path.lineTo(x, y) }
        paint.style = Paint.Style.STROKE; paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND; paint.strokeWidth = max(3f, content.width() * .008f); paint.shader = LinearGradient(x0, 0f, x0 + total, 0f, p.first, p.second, Shader.TileMode.CLAMP); paint.setShadowLayer(paint.strokeWidth * 2.8f, 0f, 0f, p.first)
        canvas.drawPath(path, paint); paint.clearShadowLayer(); paint.shader = null; paint.style = Paint.Style.FILL
    }

    private fun drawBassHalo(canvas: Canvas, bars: FloatArray, pulse: Float) {
        val p = palette(); val cx = content.centerX(); val cy = content.top + content.height() * .5f; val ms = min(content.width(), content.height()); val r = ms * (.18f + pulse * .065f)
        paint.style = Paint.Style.STROKE; paint.strokeWidth = max(3f, ms * .009f); paint.color = p.first; paint.setShadowLayer(paint.strokeWidth * 3, 0f, 0f, p.first); canvas.drawCircle(cx, cy, r, paint); paint.strokeWidth *= .45f; paint.color = p.second; canvas.drawCircle(cx, cy, r * 1.10f, paint); paint.clearShadowLayer(); paint.style = Paint.Style.FILL
        drawRadial(canvas, FloatArray(36) { bars[it * 2 % bars.size] }, pulse * .28f)
    }

    private fun currentLogoRect(): RectF {
        val logo = logoBitmap ?: return RectF()
        val pulse = spectrum?.pulseAt(timeMs) ?: 0f
        val base = min(content.width(), content.height()) * .22f * logoScale * (1f + pulse * .018f)
        val a = logo.width.toFloat() / max(1, logo.height)
        val w: Float; val h: Float
        if (a >= 1f) { w = base; h = base / a } else { h = base; w = base * a }
        val cx = content.left + content.width() * logoX
        val cy = content.top + content.height() * logoY
        return RectF(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    }

    private fun drawLogo(canvas: Canvas) {
        val logo = logoBitmap ?: return
        val d = currentLogoRect()
        paint.setShadowLayer(min(content.width(), content.height()) * .018f, 0f, 0f, Color.argb(150, 255, 255, 255))
        canvas.drawBitmap(logo, null, d, paint)
        paint.clearShadowLayer()
        if (draggingLogo) {
            paint.style = Paint.Style.STROKE; paint.strokeWidth = max(2f, content.width() * .004f); paint.color = Color.argb(220, 255, 255, 255); canvas.drawRoundRect(d, 12f, 12f, paint); paint.style = Paint.Style.FILL
        }
    }

    private fun palette(): Pair<Int, Int> = when (colorIndex) {
        1 -> Color.rgb(255, 76, 122) to Color.rgb(255, 190, 74)
        2 -> Color.rgb(68, 221, 255) to Color.rgb(88, 120, 255)
        3 -> Color.rgb(255, 211, 78) to Color.rgb(255, 118, 39)
        4 -> Color.rgb(245, 245, 255) to Color.rgb(150, 160, 180)
        else -> Color.rgb(178, 73, 255) to Color.rgb(39, 227, 255)
    }

    private fun centerCropSource(bw: Int, bh: Int, dw: Float, dh: Float): Rect {
        val ba = bw.toFloat() / max(1, bh); val da = dw / max(1f, dh)
        return if (ba > da) { val ww = (bh * da).toInt().coerceAtLeast(1); val l = (bw - ww) / 2; Rect(l, 0, l + ww, bh) }
        else { val hh = (bw / da).toInt().coerceAtLeast(1); val t = (bh - hh) / 2; Rect(0, t, bw, t + hh) }
    }

    private fun idleBars(count: Int): FloatArray = FloatArray(count) { i ->
        val x = i.toFloat() / max(1, count - 1)
        (.055f + .035f * sin(x * PI * 5).toFloat().coerceAtLeast(0f))
    }
}
