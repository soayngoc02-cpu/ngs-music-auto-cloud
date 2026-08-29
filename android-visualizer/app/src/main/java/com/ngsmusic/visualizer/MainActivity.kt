package com.ngsmusic.visualizer

import android.app.Activity
import android.content.Intent
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.widget.*
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

class MainActivity : Activity() {
    companion object {
        const val REQ_AUDIO = 1001
        const val REQ_BG = 1002
        const val REQ_LOGO = 1003
    }

    private lateinit var visualizer: VisualizerView
    private lateinit var songText: TextView
    private lateinit var playButton: Button
    private lateinit var seekBar: SeekBar
    private lateinit var statusText: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var exportButton: Button
    private lateinit var ratioSpinner: Spinner
    private lateinit var qualitySpinner: Spinner
    private lateinit var fpsSpinner: Spinner
    private lateinit var styleSpinner: Spinner
    private lateinit var colorSpinner: Spinner
    private lateinit var intensitySeek: SeekBar
    private lateinit var logoScaleSeek: SeekBar

    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val generation = AtomicInteger(0)

    private var audioUri: Uri? = null
    private var backgroundBitmap: Bitmap? = null
    private var logoBitmap: Bitmap? = null
    private var spectrum: SpectrumData? = null
    private var player: MediaPlayer? = null
    private var prepared = false
    private var seeking = false
    private var exporting = false

    private val ticker = object : Runnable {
        override fun run() {
            player?.let { p ->
                if (prepared) {
                    val pos = runCatching { p.currentPosition }.getOrDefault(0)
                    visualizer.timeMs = pos.toLong()
                    if (!seeking) {
                        val d = max(1, runCatching { p.duration }.getOrDefault(1))
                        seekBar.progress = (pos * 1000L / d).toInt()
                    }
                    playButton.text = if (runCatching { p.isPlaying }.getOrDefault(false)) "TẠM DỪNG" else "PHÁT"
                }
            }
            handler.postDelayed(this, 16)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(7, 10, 18)
        window.navigationBarColor = Color.rgb(7, 10, 18)
        buildUi()
        handler.post(ticker)
    }

    private fun buildUi() {
        val root = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(7, 10, 18))
            isFillViewport = true
        }
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(28))
        }
        root.addView(c, FrameLayout.LayoutParams(-1, -2))

        c.addView(text("NGS MUSIC VISUALIZER PRO", 27f, Color.WHITE, true))
        c.addView(text("Real FFT • Beat Sync • 4K Music Wave Studio", 13f, Color.rgb(162, 170, 198), false).apply { setPadding(0, dp(2), 0, dp(14)) })

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(Color.rgb(12, 16, 29), 20)
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        visualizer = VisualizerView(this).apply { background = rounded(Color.BLACK, 16) }
        card.addView(visualizer, LinearLayout.LayoutParams(-1, dp(430)))
        c.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) })

        c.addView(section("NGUỒN MEDIA"))
        c.addView(button("CHỌN NHẠC • MP3 / WAV / M4A") { pick(REQ_AUDIO, "audio/*") })
        c.addView(button("CHỌN ẢNH MINH HỌA") { pick(REQ_BG, "image/*") }.withTop(8))
        c.addView(button("CHỌN LOGO • PNG/JPG") { pick(REQ_LOGO, "image/*") }.withTop(8))
        songText = text("Chưa chọn bài hát", 14f, Color.rgb(197, 202, 222), false).apply { setPadding(dp(4), dp(12), dp(4), dp(6)) }
        c.addView(songText)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        playButton = smallButton("PHÁT") { player?.let { if (prepared) { if (it.isPlaying) it.pause() else it.start() } } }
        row.addView(playButton, LinearLayout.LayoutParams(dp(104), dp(46)))
        seekBar = SeekBar(this).apply {
            max = 1000
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(s: SeekBar?) { seeking = true }
                override fun onStopTrackingTouch(s: SeekBar?) {
                    player?.let { if (prepared) it.seekTo((it.duration * (progress / 1000f)).toInt()) }
                    seeking = false
                }
                override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) {
                    if (fromUser && prepared) player?.let { visualizer.timeMs = (it.duration * (p / 1000f)).toLong() }
                }
            })
        }
        row.addView(seekBar, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
        c.addView(row)

        c.addView(section("LOGO TỰ DO"))
        c.addView(text("Chạm vào logo rồi kéo tới vị trí bất kỳ. Dùng 2 ngón để phóng/thu logo ngay trên preview.", 12f, Color.rgb(168, 176, 202), false).apply { setPadding(dp(4), 0, dp(4), dp(8)) })
        logoScaleSeek = SeekBar(this).apply {
            max = 215
            progress = 65
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) {}
                override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) {
                    if (fromUser) visualizer.logoScale = .35f + p / 100f
                }
            })
        }
        c.addView(labeled("Kích thước logo", logoScaleSeek))
        c.addView(button("ĐẶT LOGO VỀ GIỮA") {
            visualizer.resetLogoTransform()
            statusText.text = "Đã đặt logo về giữa"
        }.withTop(6))
        visualizer.onLogoTransformChanged = { _, _, scale ->
            val p = ((scale - .35f) * 100f).toInt().coerceIn(0, 215)
            if (logoScaleSeek.progress != p) logoScaleSeek.progress = p
        }

        c.addView(section("STYLE SÓNG • REAL FFT"))
        styleSpinner = spinner(arrayOf("Neon Spectrum", "Mirror Spectrum", "Radial Spectrum", "Spectrum Wave", "Bass Halo"))
        colorSpinner = spinner(arrayOf("Neon Purple/Cyan", "Sunset", "Ice Blue", "Gold Fire", "Clean Mono"))
        c.addView(labeled("Kiểu visualizer", styleSpinner))
        c.addView(labeled("Màu", colorSpinner))
        intensitySeek = SeekBar(this).apply {
            max = 130
            progress = 50
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) {}
                override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) { visualizer.intensity = .5f + p / 100f }
            })
        }
        c.addView(labeled("Độ mạnh sóng", intensitySeek))
        listen(styleSpinner) { visualizer.styleIndex = it }
        listen(colorSpinner) { visualizer.colorIndex = it }

        c.addView(text("PRO dùng FFT từ PCM thật: mỗi cột đại diện một dải tần số, còn Bass/Beat detector chỉ tạo nhịp thở theo kick/onset. Không còn lấy các điểm thời gian ngẫu nhiên làm cột sóng.", 12f, Color.rgb(145, 156, 187), false).apply { setPadding(dp(4), dp(8), dp(4), dp(6)) })

        c.addView(section("XUẤT VIDEO"))
        ratioSpinner = spinner(arrayOf("9:16 • TikTok/Reels", "16:9 • YouTube", "1:1 • Square"))
        qualitySpinner = spinner(arrayOf("1080p Full HD", "2K QHD", "4K UHD"))
        fpsSpinner = spinner(arrayOf("30 FPS", "60 FPS")).apply { setSelection(1) }
        c.addView(labeled("Tỉ lệ khung hình", ratioSpinner))
        c.addView(labeled("Độ phân giải", qualitySpinner))
        c.addView(labeled("Frame rate", fpsSpinner))
        listen(ratioSpinner) { visualizer.ratioIndex = it }
        c.addView(text("4K 60fps cần encoder phần cứng tương ứng. Nếu máy không hỗ trợ, app sẽ báo để đổi xuống 2K/1080p hoặc 30fps.", 12f, Color.rgb(144, 152, 180), false).apply { setPadding(dp(4), dp(8), dp(4), dp(12)) })

        exportButton = button("XUẤT VIDEO MP4") { startExport() }.apply {
            textSize = 17f
            background = rounded(Color.rgb(121, 72, 255), 14)
        }
        c.addView(exportButton, LinearLayout.LayoutParams(-1, dp(58)))
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = View.GONE }
        c.addView(progressBar, LinearLayout.LayoutParams(-1, dp(16)).apply { topMargin = dp(12) })
        statusText = text("Sẵn sàng", 13f, Color.rgb(184, 190, 214), false).apply { setPadding(dp(4), dp(6), dp(4), 0) }
        c.addView(statusText)

        setContentView(root)
    }

    private fun pick(code: Int, mime: String) {
        if (exporting) return
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }, code)
    }

    @Deprecated("legacy")
    override fun onActivityResult(code: Int, result: Int, data: Intent?) {
        super.onActivityResult(code, result, data)
        if (result != RESULT_OK) return
        val uri = data?.data ?: return
        runCatching { contentResolver.takePersistableUriPermission(uri, data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        when (code) {
            REQ_AUDIO -> setAudio(uri)
            REQ_BG -> loadImage(uri, false)
            REQ_LOGO -> loadImage(uri, true)
        }
    }

    private fun loadImage(uri: Uri, logo: Boolean) {
        statusText.text = if (logo) "Đang nạp logo…" else "Đang nạp ảnh nền…"
        executor.execute {
            val r = runCatching { decodeBitmap(uri, if (logo) 2048 else 4096) }
            runOnUiThread {
                r.onSuccess {
                    if (logo) {
                        logoBitmap?.takeIf { old -> old !== it }?.recycle()
                        logoBitmap = it
                        visualizer.logoBitmap = it
                        statusText.text = "Đã chọn logo • kéo logo để đổi vị trí, pinch để đổi kích thước"
                    } else {
                        backgroundBitmap?.takeIf { old -> old !== it }?.recycle()
                        backgroundBitmap = it
                        visualizer.backgroundBitmap = it
                        statusText.text = "Đã chọn ảnh minh họa"
                    }
                }.onFailure { showError("Không đọc được ảnh: ${it.message}") }
            }
        }
    }

    private fun setAudio(uri: Uri) {
        audioUri = uri
        spectrum = null
        visualizer.spectrum = null
        songText.text = displayName(uri)
        statusText.text = "Đang phân tích FFT + beat…"
        progressBar.visibility = View.VISIBLE
        progressBar.progress = 0
        setupPlayer(uri)
        val g = generation.incrementAndGet()
        executor.execute {
            val r = runCatching {
                AudioAnalyzer.analyze(this, uri) { p ->
                    if (generation.get() == g) runOnUiThread {
                        progressBar.progress = p
                        statusText.text = if (p < 94) "Đang đọc PCM và phân tích FFT $p%" else "Đang tối ưu beat/smoothing…"
                    }
                }
            }
            if (generation.get() != g) return@execute
            runOnUiThread {
                r.onSuccess {
                    spectrum = it
                    visualizer.spectrum = it
                    progressBar.visibility = View.GONE
                    statusText.text = "FFT/Beat đã sẵn sàng • ${formatDuration(it.durationMs)}"
                }.onFailure {
                    progressBar.visibility = View.GONE
                    showError("Phân tích audio thất bại: ${it.message}")
                }
            }
        }
    }

    private fun setupPlayer(uri: Uri) {
        runCatching { player?.release() }
        prepared = false
        player = MediaPlayer().apply {
            setDataSource(this@MainActivity, uri)
            setOnPreparedListener { prepared = true; seekBar.progress = 0 }
            setOnCompletionListener { playButton.text = "PHÁT"; seekBar.progress = 1000 }
            setOnErrorListener { _, w, e -> showError("Không phát được nhạc ($w/$e)"); true }
            prepareAsync()
        }
    }

    private fun startExport() {
        if (exporting) return
        val uri = audioUri ?: return showError("Hãy chọn nhạc trước.")
        val d = spectrum ?: return showError("Audio chưa phân tích FFT xong.")
        val spec = VideoExporter.Spec(
            ratioIndex = ratioSpinner.selectedItemPosition,
            qualityIndex = qualitySpinner.selectedItemPosition,
            fps = if (fpsSpinner.selectedItemPosition == 1) 60 else 30,
            styleIndex = styleSpinner.selectedItemPosition,
            colorIndex = colorSpinner.selectedItemPosition,
            intensity = visualizer.intensity,
            logoX = visualizer.logoX,
            logoY = visualizer.logoY,
            logoScale = visualizer.logoScale
        )
        player?.pause()
        exporting = true
        exportButton.isEnabled = false
        exportButton.text = "ĐANG RENDER…"
        progressBar.visibility = View.VISIBLE
        progressBar.progress = 0
        executor.execute {
            val r = runCatching {
                VideoExporter.export(this, uri, backgroundBitmap, logoBitmap, d, spec) { p, m ->
                    runOnUiThread { progressBar.progress = p; statusText.text = m }
                }
            }
            runOnUiThread {
                exporting = false
                exportButton.isEnabled = true
                exportButton.text = "XUẤT VIDEO MP4"
                r.onSuccess {
                    progressBar.progress = 100
                    statusText.text = "Đã lưu video vào Movies/NGS Music Visualizer"
                    Toast.makeText(this, "Xuất video xong!", Toast.LENGTH_LONG).show()
                }.onFailure {
                    progressBar.visibility = View.GONE
                    showError(it.message ?: "Xuất video thất bại")
                }
            }
        }
    }

    private fun decodeBitmap(uri: Uri, maxSide: Int): Bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(contentResolver, uri)) { d, info, _ ->
        d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val largest = max(info.size.width, info.size.height)
        if (largest > maxSide) d.setTargetSampleSize((largest.toFloat() / maxSide).toInt().coerceAtLeast(1))
    }

    private fun displayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) return it.getString(0) ?: "Bài hát đã chọn"
        }
        return "Bài hát đã chọn"
    }

    private fun formatDuration(ms: Long): String { val t = ms / 1000; return "%d:%02d".format(t / 60, t % 60) }
    private fun section(s: String) = text(s, 13f, Color.rgb(153, 125, 255), true).apply { setPadding(dp(2), dp(16), dp(2), dp(8)); letterSpacing = .08f }
    private fun text(v: String, size: Float, color: Int, bold: Boolean) = TextView(this).apply { text = v; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD) }
    private fun button(s: String, click: () -> Unit) = Button(this).apply { text = s; textSize = 14f; setTextColor(Color.WHITE); isAllCaps = false; background = rounded(Color.rgb(25, 31, 52), 13); setOnClickListener { click() }; gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(-1, dp(52)) }
    private fun smallButton(s: String, click: () -> Unit) = Button(this).apply { text = s; textSize = 12f; setTextColor(Color.WHITE); isAllCaps = false; background = rounded(Color.rgb(121, 72, 255), 12); setOnClickListener { click() } }
    private fun spinner(items: Array<String>) = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, items); setPadding(dp(10), 0, dp(8), 0); background = rounded(Color.rgb(20, 25, 43), 11) }
    private fun labeled(s: String, v: View) = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; addView(text(s, 12f, Color.rgb(181, 187, 207), false).apply { setPadding(dp(3), dp(7), 0, dp(5)) }); addView(v, LinearLayout.LayoutParams(-1, dp(50))) }
    private fun listen(s: Spinner, cb: (Int) -> Unit) { s.onItemSelectedListener = object : AdapterView.OnItemSelectedListener { override fun onNothingSelected(p: AdapterView<*>?) {}; override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) { cb(pos) } } }
    private fun rounded(color: Int, r: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(r).toFloat() }
    private fun Button.withTop(t: Int) = apply { layoutParams = LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(t) } }
    private fun showError(s: String) { statusText.text = s; Toast.makeText(this, s, Toast.LENGTH_LONG).show() }
    private fun dp(v: Int) = (v * resources.displayMetrics.density + .5f).toInt()

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        generation.incrementAndGet()
        runCatching { player?.release() }
        executor.shutdownNow()
        super.onDestroy()
    }
}
