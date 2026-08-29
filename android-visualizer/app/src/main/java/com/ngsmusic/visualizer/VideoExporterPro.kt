package com.ngsmusic.visualizer

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.media.*
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

object VideoExporter {
    data class Spec(
        val ratioIndex: Int,
        val qualityIndex: Int,
        val fps: Int,
        val styleIndex: Int,
        val colorIndex: Int,
        val intensity: Float = 1f,
        val logoX: Float = .5f,
        val logoY: Float = .48f,
        val logoScale: Float = 1f
    ) {
        val size: Pair<Int, Int>
            get() {
                val base = when (qualityIndex) {
                    2 -> 2160 to 3840
                    1 -> 1440 to 2560
                    else -> 1080 to 1920
                }
                return when (ratioIndex) {
                    1 -> base.second to base.first
                    2 -> base.first to base.first
                    else -> base
                }
            }
    }

    fun export(
        context: Context,
        audioUri: Uri,
        background: Bitmap?,
        logo: Bitmap?,
        spectrum: SpectrumData,
        spec: Spec,
        onProgress: (Int, String) -> Unit
    ): Uri {
        val dir = File(context.cacheDir, "ngs_visualizer_export").apply { mkdirs() }
        val stamp = System.currentTimeMillis()
        val video = File(dir, "v$stamp.mp4")
        val pcm = File(dir, "a$stamp.pcm")
        val audio = File(dir, "a$stamp.mp4")
        val final = File(dir, "f$stamp.mp4")
        try {
            onProgress(1, "Chuẩn bị encoder video…")
            encodeVideo(video, background, logo, spectrum, spec) {
                onProgress((it * .82f).toInt().coerceIn(1, 82), "Đang render FFT/Beat $it%")
            }
            onProgress(83, "Đang xử lý âm thanh…")
            val pcmInfo = decodeAudioToPcm(context, audioUri, pcm) {
                onProgress(83 + (it * .05f).toInt(), "Đang giải mã audio…")
            }
            encodePcmToAac(pcmInfo, audio) {
                onProgress(88 + (it * .07f).toInt(), "Đang mã hóa AAC…")
            }
            onProgress(96, "Đang ghép MP4…")
            mux(video, audio, final)
            onProgress(98, "Đang lưu vào thư viện…")
            return save(context, final, spec).also { onProgress(100, "Hoàn tất") }
        } finally {
            listOf(video, pcm, audio, final).forEach { runCatching { it.delete() } }
        }
    }

    private fun encodeVideo(
        output: File,
        bg: Bitmap?,
        logo: Bitmap?,
        sp: SpectrumData,
        spec: Spec,
        progress: (Int) -> Unit
    ) {
        val (width, height) = spec.size
        val fps = spec.fps.coerceIn(24, 60)
        val duration = sp.durationUs.coerceAtLeast(1_000_000)
        val frames = max(1L, (duration * fps + 999_999) / 1_000_000)
        val baseRate = when {
            max(width, height) >= 3800 -> 56_000_000
            max(width, height) >= 2500 -> 30_000_000
            else -> 16_000_000
        }
        val wantedRate = if (fps >= 60) baseRate else (baseRate * .72f).toInt()
        val choice = chooseEncoder(width, height, fps, wantedRate)
        val format = MediaFormat.createVideoFormat(choice.mime, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, choice.rate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            runCatching { setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR) }
        }

        val codec = MediaCodec.createByCodecName(choice.name)
        var muxer: MediaMuxer? = null
        var egl: EncoderEglSurface? = null
        var renderer: GlVisualizerRenderer? = null
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val surface = codec.createInputSurface()
            codec.start()
            egl = EncoderEglSurface(surface)
            renderer = GlVisualizerRenderer(
                width, height, bg, logo, sp,
                spec.styleIndex, spec.colorIndex, spec.intensity,
                spec.logoX, spec.logoY, spec.logoScale
            )
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val info = MediaCodec.BufferInfo()
            var track = -1
            var started = false
            var frame = 0L
            var last = -1

            fun drain(wait: Boolean): Boolean {
                var eos = false
                while (true) {
                    when (val idx = codec.dequeueOutputBuffer(info, if (wait) 20_000 else 0)) {
                        MediaCodec.INFO_TRY_AGAIN_LATER -> return eos
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            if (!started) {
                                track = muxer!!.addTrack(codec.outputFormat)
                                muxer!!.start()
                                started = true
                            }
                        }
                        else -> if (idx >= 0) {
                            val b = codec.getOutputBuffer(idx)
                            if (b != null && info.size > 0 && started && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                                b.position(info.offset)
                                b.limit(info.offset + info.size)
                                muxer!!.writeSampleData(track, b, info)
                            }
                            eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                            codec.releaseOutputBuffer(idx, false)
                            if (eos) return true
                        }
                    }
                }
            }

            while (frame < frames) {
                val us = frame * 1_000_000 / fps
                renderer.draw(us / 1000)
                egl.setPresentationTime(us * 1000)
                require(egl.swapBuffers())
                drain(false)
                frame++
                val p = (frame * 100 / frames).toInt().coerceIn(0, 99)
                if (p != last) { last = p; progress(p) }
            }
            codec.signalEndOfInputStream()
            while (!drain(true)) {}
            progress(100)
        } catch (e: Throwable) {
            throw IllegalStateException("Thiết bị không render được ${width}x${height} ${fps}fps. Hãy thử 2K/1080p hoặc 30fps. Chi tiết: ${e.message}", e)
        } finally {
            runCatching { renderer?.release() }
            runCatching { egl?.release() }
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
        }
    }

    private data class VideoCodec(val name: String, val mime: String, val rate: Int)

    private fun chooseEncoder(w: Int, h: Int, fps: Int, rate: Int): VideoCodec {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        for ((mime, r) in listOf(
            MediaFormat.MIMETYPE_VIDEO_AVC to rate,
            MediaFormat.MIMETYPE_VIDEO_HEVC to (rate * .72f).toInt()
        )) {
            val f = MediaFormat.createVideoFormat(mime, w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, r)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            }
            val name = runCatching { list.findEncoderForFormat(f) }.getOrNull()
            if (!name.isNullOrBlank()) return VideoCodec(name, mime, r)
        }
        error("Không tìm thấy encoder H.264/HEVC phù hợp cho ${w}x${h}@${fps}.")
    }

    private data class PCM(val file: File, val rate: Int, val channels: Int)

    private fun decodeAudioToPcm(context: Context, uri: Uri, output: File, progress: (Int) -> Unit): PCM {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var out: BufferedOutputStream? = null
        try {
            extractor.setDataSource(context, uri, null)
            var track = -1
            var fmt: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                if (f.getString(MediaFormat.KEY_MIME).orEmpty().startsWith("audio/")) { track = i; fmt = f; break }
            }
            require(track >= 0 && fmt != null)
            extractor.selectTrack(track)
            val input = fmt!!
            val mime = input.getString(MediaFormat.KEY_MIME) ?: error("Audio MIME lỗi")
            val duration = if (input.containsKey(MediaFormat.KEY_DURATION)) input.getLong(MediaFormat.KEY_DURATION) else 0L
            var rate = input.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = input.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var encoding = AudioFormat.ENCODING_PCM_16BIT
            runCatching { input.setInteger(MediaFormat.KEY_PCM_ENCODING, encoding) }

            decoder = MediaCodec.createDecoderByType(mime)
            decoder.configure(input, null, null, 0)
            decoder.start()
            out = BufferedOutputStream(FileOutputStream(output), 262_144)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var done = false
            var last = -1
            var outChannels = min(2, max(1, channels))

            while (!done) {
                if (!inputDone) {
                    val i = decoder.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val b = decoder.getInputBuffer(i)!!
                        val n = extractor.readSampleData(b, 0)
                        if (n < 0) {
                            decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val pts = extractor.sampleTime.coerceAtLeast(0)
                            decoder.queueInputBuffer(i, 0, n, pts, extractor.sampleFlags)
                            extractor.advance()
                            if (duration > 0) {
                                val p = (pts * 100 / duration).toInt().coerceIn(0, 99)
                                if (p != last) { last = p; progress(p) }
                            }
                        }
                    }
                }
                when (val i = decoder.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = decoder.outputFormat
                        if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = f.getInteger(MediaFormat.KEY_PCM_ENCODING)
                        outChannels = min(2, max(1, channels))
                    }
                    else -> if (i >= 0) {
                        val b = decoder.getOutputBuffer(i)
                        if (b != null && info.size > 0) writePcm16(b, info.offset, info.size, max(1, channels), outChannels, encoding, out)
                        done = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        decoder.releaseOutputBuffer(i, false)
                    }
                }
            }
            out.flush()
            progress(100)
            return PCM(output, rate, outChannels)
        } finally {
            runCatching { out?.close() }
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { extractor.release() }
        }
    }

    private fun writePcm16(src: ByteBuffer, offset: Int, size: Int, inCh: Int, outCh: Int, encoding: Int, out: OutputStream) {
        src.position(offset)
        src.limit(offset + size)
        val s = src.slice().order(ByteOrder.LITTLE_ENDIAN)
        if (encoding == AudioFormat.ENCODING_PCM_16BIT && inCh <= 2 && inCh == outCh) {
            val bytes = ByteArray(min(size, 65_536))
            while (s.hasRemaining()) { val n = min(s.remaining(), bytes.size); s.get(bytes, 0, n); out.write(bytes, 0, n) }
            return
        }
        val data = ByteArray(16_384)
        var p = 0
        fun emit(v: Int) {
            val q = v.coerceIn(-32768, 32767)
            if (p + 2 > data.size) { out.write(data, 0, p); p = 0 }
            data[p++] = (q and 255).toByte()
            data[p++] = ((q shr 8) and 255).toByte()
        }
        if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
            val fs = s.asFloatBuffer()
            while (fs.remaining() >= inCh) {
                var left = 0f; var right = 0f
                for (c in 0 until inCh) { val v = fs.get().coerceIn(-1f, 1f); if (c == 0) left = v; if (c == 1) right = v }
                emit((left * 32767).toInt())
                if (outCh > 1) emit(((if (inCh > 1) right else left) * 32767).toInt())
            }
        } else {
            val ss = s.asShortBuffer()
            while (ss.remaining() >= inCh) {
                var left = 0; var right = 0
                for (c in 0 until inCh) { val v = ss.get().toInt(); if (c == 0) left = v; if (c == 1) right = v }
                emit(left)
                if (outCh > 1) emit(if (inCh > 1) right else left)
            }
        }
        if (p > 0) out.write(data, 0, p)
    }

    private fun encodePcmToAac(pcm: PCM, output: File, progress: (Int) -> Unit) {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, pcm.rate, pcm.channels).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, if (pcm.channels == 1) 128_000 else 192_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 32_768)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        var muxer: MediaMuxer? = null
        var input: BufferedInputStream? = null
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            input = BufferedInputStream(FileInputStream(pcm.file), 262_144)
            val info = MediaCodec.BufferInfo()
            val total = max(1L, pcm.file.length())
            var read = 0L; var frames = 0L; val bpf = pcm.channels * 2
            var inputDone = false; var done = false; var track = -1; var started = false; var last = -1

            while (!done) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val b = codec.getInputBuffer(i)!!; b.clear()
                        var wanted = min(b.remaining(), 32_768); wanted -= wanted % bpf
                        val temp = ByteArray(wanted.coerceAtLeast(0))
                        val n = if (wanted > 0) input.read(temp) else -1
                        val pts = frames * 1_000_000 / pcm.rate
                        if (n <= 0) {
                            codec.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            b.put(temp, 0, n)
                            codec.queueInputBuffer(i, 0, n, pts, 0)
                            frames += n / bpf; read += n
                            val p = (read * 100 / total).toInt().coerceIn(0, 99)
                            if (p != last) { last = p; progress(p) }
                        }
                    }
                }
                when (val i = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> if (!started) { track = muxer.addTrack(codec.outputFormat); muxer.start(); started = true }
                    else -> if (i >= 0) {
                        val b = codec.getOutputBuffer(i)
                        if (b != null && info.size > 0 && started && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                            b.position(info.offset); b.limit(info.offset + info.size); muxer.writeSampleData(track, b, info)
                        }
                        done = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        codec.releaseOutputBuffer(i, false)
                    }
                }
            }
            progress(100)
        } finally {
            runCatching { input?.close() }
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
        }
    }

    private fun mux(video: File, audio: File, output: File) {
        val v = MediaExtractor(); val a = MediaExtractor(); var muxer: MediaMuxer? = null
        try {
            v.setDataSource(video.absolutePath); a.setDataSource(audio.absolutePath)
            val vt = find(v, "video/"); val at = find(a, "audio/")
            require(vt >= 0 && at >= 0)
            v.selectTrack(vt); a.selectTrack(at)
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val outVideo = muxer.addTrack(v.getTrackFormat(vt)); val outAudio = muxer.addTrack(a.getTrackFormat(at)); muxer.start()
            val buf = ByteBuffer.allocateDirect(16 * 1024 * 1024); val info = MediaCodec.BufferInfo(); var vd = false; var ad = false
            while (!vd || !ad) {
                val useVideo = (if (!vd) v.sampleTime else Long.MAX_VALUE) <= (if (!ad) a.sampleTime else Long.MAX_VALUE)
                val ex = if (useVideo) v else a; val track = if (useVideo) outVideo else outAudio
                buf.clear(); val n = ex.readSampleData(buf, 0)
                if (n < 0) { if (useVideo) vd = true else ad = true }
                else { info.set(0, n, ex.sampleTime.coerceAtLeast(0), ex.sampleFlags); buf.position(0); buf.limit(n); muxer.writeSampleData(track, buf, info); ex.advance() }
            }
        } finally {
            runCatching { muxer?.stop() }; runCatching { muxer?.release() }; runCatching { v.release() }; runCatching { a.release() }
        }
    }

    private fun find(extractor: MediaExtractor, prefix: String): Int {
        for (i in 0 until extractor.trackCount) if (extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME).orEmpty().startsWith(prefix)) return i
        return -1
    }

    private fun save(context: Context, file: File, spec: Spec): Uri {
        val (w, h) = spec.size
        val q = when (spec.qualityIndex) { 2 -> "4K"; 1 -> "2K"; else -> "1080p" }
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, "NGS_Visualizer_PRO_${q}_${w}x${h}_${spec.fps}fps_${System.currentTimeMillis()}.mp4")
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/NGS Music Visualizer")
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: error("Không tạo được file")
        try {
            resolver.openOutputStream(uri, "w")!!.use { out -> FileInputStream(file).use { it.copyTo(out, 1024 * 1024) } }
            values.clear(); values.put(MediaStore.Video.Media.IS_PENDING, 0); resolver.update(uri, values, null, null)
            return uri
        } catch (e: Throwable) {
            resolver.delete(uri, null, null)
            throw e
        }
    }
}
