package com.ngsmusic.visualizer

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object AudioAnalyzer {
    private const val BAND_COUNT = 48
    private const val FRAME_RATE = 50
    private const val FFT_SIZE = 2048

    fun analyze(
        context: Context,
        uri: Uri,
        onProgress: (Int) -> Unit = {}
    ): SpectrumData {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        try {
            extractor.setDataSource(context, uri, null)
            var audioTrack = -1
            var inputFormat: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME).orEmpty()
                if (mime.startsWith("audio/")) {
                    audioTrack = i
                    inputFormat = f
                    break
                }
            }
            require(audioTrack >= 0 && inputFormat != null) { "Không tìm thấy track âm thanh." }
            extractor.selectTrack(audioTrack)

            val format = inputFormat!!
            val mime = format.getString(MediaFormat.KEY_MIME) ?: error("Audio MIME không hợp lệ")
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
            runCatching { format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT) }

            decoder = MediaCodec.createDecoderByType(mime)
            decoder.configure(format, null, null, 0)
            decoder.start()

            var builder: SpectralBuilder? = null
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var lastProgress = -1

            while (!outputDone) {
                if (!inputDone) {
                    val inputIndex = decoder.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val input = decoder.getInputBuffer(inputIndex) ?: error("Decoder input buffer unavailable")
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            decoder.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val pts = extractor.sampleTime.coerceAtLeast(0L)
                            decoder.queueInputBuffer(inputIndex, 0, size, pts, extractor.sampleFlags)
                            extractor.advance()
                            if (durationUs > 0) {
                                val p = ((pts * 92L) / durationUs).toInt().coerceIn(0, 92)
                                if (p != lastProgress) {
                                    lastProgress = p
                                    onProgress(p)
                                }
                            }
                        }
                    }
                }

                when (val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val out = decoder.outputFormat
                        if (out.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        if (out.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (out.containsKey(MediaFormat.KEY_PCM_ENCODING)) pcmEncoding = out.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    }
                    else -> if (outputIndex >= 0) {
                        val output = decoder.getOutputBuffer(outputIndex)
                        if (output != null && info.size > 0) {
                            val b = builder ?: SpectralBuilder(sampleRate, BAND_COUNT, FRAME_RATE, FFT_SIZE).also { builder = it }
                            feedPcm(output, info.offset, info.size, max(1, channels), pcmEncoding, b)
                        }
                        outputDone = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        decoder.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }

            onProgress(94)
            val result = (builder ?: SpectralBuilder(sampleRate, BAND_COUNT, FRAME_RATE, FFT_SIZE))
                .finish(durationUs, sampleRate, channels)
            onProgress(100)
            return result
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { extractor.release() }
        }
    }

    private fun feedPcm(
        source: ByteBuffer,
        offset: Int,
        size: Int,
        channels: Int,
        encoding: Int,
        builder: SpectralBuilder
    ) {
        val src = source.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        src.position(offset)
        src.limit(offset + size)
        val slice = src.slice().order(ByteOrder.LITTLE_ENDIAN)
        val ch = max(1, channels)

        if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
            val fb = slice.asFloatBuffer()
            while (fb.remaining() >= ch) {
                var sum = 0f
                repeat(ch) { sum += fb.get().coerceIn(-1f, 1f) }
                builder.add(sum / ch)
            }
        } else {
            val sb = slice.asShortBuffer()
            while (sb.remaining() >= ch) {
                var sum = 0f
                repeat(ch) { sum += sb.get() / 32768f }
                builder.add(sum / ch)
            }
        }
    }

    private class SpectralBuilder(
        private val sampleRate: Int,
        private val bandCount: Int,
        private val frameRate: Int,
        private val fftSize: Int
    ) {
        private val hop = max(1, sampleRate / frameRate)
        private val queue = SampleQueue(fftSize * 4)
        private val raw = FloatAccumulator(16_384)
        private val real = DoubleArray(fftSize)
        private val imag = DoubleArray(fftSize)
        private val bandStarts = IntArray(bandCount)
        private val bandEnds = IntArray(bandCount)

        init {
            val nyquist = sampleRate / 2.0
            val low = 45.0
            val high = min(18_000.0, nyquist * .94).coerceAtLeast(low * 2)
            val maxBin = fftSize / 2 - 1
            for (b in 0 until bandCount) {
                val f0 = exp(ln(low) + (ln(high) - ln(low)) * b / bandCount)
                val f1 = exp(ln(low) + (ln(high) - ln(low)) * (b + 1) / bandCount)
                val s = ((f0 * fftSize) / sampleRate).toInt().coerceIn(1, maxBin)
                val e = ((f1 * fftSize) / sampleRate).toInt().coerceIn(s + 1, fftSize / 2)
                bandStarts[b] = s
                bandEnds[b] = e
            }
        }

        fun add(sample: Float) {
            queue.add(sample)
            while (queue.size >= fftSize) {
                analyzeWindow()
                queue.skip(hop)
            }
        }

        private fun analyzeWindow() {
            for (i in 0 until fftSize) {
                val window = .5 - .5 * cos(2.0 * PI * i / (fftSize - 1))
                real[i] = queue[i] * window
                imag[i] = 0.0
            }
            fft(real, imag)

            for (b in 0 until bandCount) {
                val start = bandStarts[b]
                val end = bandEnds[b]
                var power = 0.0
                var n = 0
                for (k in start until end) {
                    power += real[k] * real[k] + imag[k] * imag[k]
                    n++
                }
                val rms = if (n > 0) sqrt(power / n) * 2.0 / fftSize else 0.0
                // Log compression keeps quiet musical detail visible without letting one loud kick dominate.
                raw.add(ln(1.0 + rms * 180.0).toFloat())
            }
        }

        fun finish(durationUs: Long, finalRate: Int, channels: Int): SpectrumData {
            if (raw.size == 0 && queue.size > 0) {
                while (queue.size < fftSize) queue.add(0f)
                analyzeWindow()
            }
            val rawData = raw.toArray()
            val frames = rawData.size / bandCount
            if (frames <= 0) {
                return SpectrumData(FloatArray(0), bandCount, frameRate, FloatArray(0), durationUs, finalRate, channels)
            }

            val refs = FloatArray(bandCount)
            val tmp = FloatArray(frames)
            for (b in 0 until bandCount) {
                for (f in 0 until frames) tmp[f] = rawData[f * bandCount + b]
                tmp.sort()
                val idx = ((frames - 1) * .965f).toInt().coerceIn(0, frames - 1)
                refs[b] = max(.0001f, tmp[idx])
            }

            val normalized = FloatArray(frames * bandCount)
            val states = FloatArray(bandCount)
            for (f in 0 until frames) {
                for (b in 0 until bandCount) {
                    var x = (rawData[f * bandCount + b] / refs[b]).coerceIn(0f, 1.35f)
                    x = ((x - .025f) / .975f).coerceAtLeast(0f).pow(.72f).coerceIn(0f, 1f)
                    val coeff = if (x > states[b]) .72f else .19f
                    states[b] += (x - states[b]) * coeff
                    normalized[f * bandCount + b] = states[b].coerceIn(0f, 1f)
                }
            }

            val beatRaw = FloatArray(frames)
            val bassBands = min(12, max(4, bandCount / 4))
            var baseline = 0f
            val previous = FloatArray(bandCount)
            for (f in 0 until frames) {
                var bass = 0f
                for (b in 0 until bassBands) bass += normalized[f * bandCount + b]
                bass /= bassBands

                var flux = 0f
                val fluxBands = min(bandCount, 30)
                for (b in 0 until fluxBands) {
                    val v = normalized[f * bandCount + b]
                    val d = (v - previous[b]).coerceAtLeast(0f)
                    val weight = 1f - .45f * (b.toFloat() / max(1, fluxBands - 1))
                    flux += d * weight
                    previous[b] = v
                }
                flux /= max(1, fluxBands)

                if (f == 0) baseline = bass
                val onset = (bass - baseline * 1.06f).coerceAtLeast(0f)
                baseline = baseline * .94f + bass * .06f
                beatRaw[f] = onset * 3.6f + flux * 2.4f + bass * .07f
            }

            val sortedBeat = beatRaw.copyOf().apply { sort() }
            val beatRef = max(.0001f, sortedBeat[((frames - 1) * .97f).toInt().coerceIn(0, frames - 1)])
            val pulse = FloatArray(frames)
            var env = 0f
            for (f in 0 until frames) {
                val target = (beatRaw[f] / beatRef).coerceIn(0f, 1f).pow(.68f)
                val coeff = if (target > env) .88f else .18f
                env += (target - env) * coeff
                pulse[f] = env.coerceIn(0f, 1f)
            }

            return SpectrumData(normalized, bandCount, frameRate, pulse, durationUs, finalRate, channels)
        }
    }

    private class SampleQueue(initialCapacity: Int) {
        private var data = FloatArray(initialCapacity)
        private var start = 0
        private var end = 0
        val size: Int get() = end - start

        operator fun get(index: Int): Float = data[start + index]

        fun add(value: Float) {
            ensure(1)
            data[end++] = value
        }

        fun skip(count: Int) {
            start = min(end, start + count)
            if (start > data.size / 2) compact()
        }

        private fun ensure(extra: Int) {
            if (end + extra <= data.size) return
            compact()
            if (end + extra <= data.size) return
            data = data.copyOf(max(data.size * 2, end + extra))
        }

        private fun compact() {
            if (start == 0) return
            val n = size
            System.arraycopy(data, start, data, 0, n)
            start = 0
            end = n
        }
    }

    private class FloatAccumulator(initialCapacity: Int) {
        private var data = FloatArray(initialCapacity)
        var size = 0
            private set
        fun add(value: Float) {
            if (size >= data.size) data = data.copyOf(data.size * 2)
            data[size++] = value
        }
        fun toArray(): FloatArray = data.copyOf(size)
    }

    private fun fft(real: DoubleArray, imag: DoubleArray) {
        val n = real.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                val tr = real[i]; real[i] = real[j]; real[j] = tr
                val ti = imag[i]; imag[i] = imag[j]; imag[j] = ti
            }
        }

        var len = 2
        while (len <= n) {
            val angle = -2.0 * PI / len
            val wLenR = cos(angle)
            val wLenI = sin(angle)
            var i = 0
            while (i < n) {
                var wr = 1.0
                var wi = 0.0
                val half = len / 2
                for (k in 0 until half) {
                    val uR = real[i + k]
                    val uI = imag[i + k]
                    val vR = real[i + k + half] * wr - imag[i + k + half] * wi
                    val vI = real[i + k + half] * wi + imag[i + k + half] * wr
                    real[i + k] = uR + vR
                    imag[i + k] = uI + vI
                    real[i + k + half] = uR - vR
                    imag[i + k + half] = uI - vI
                    val nextWr = wr * wLenR - wi * wLenI
                    wi = wr * wLenI + wi * wLenR
                    wr = nextWr
                }
                i += len
            }
            len = len shl 1
        }
    }
}
