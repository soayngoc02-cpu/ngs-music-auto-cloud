package com.ngsmusic.visualizer

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max

object AudioAnalyzer {
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
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
                format.getLong(MediaFormat.KEY_DURATION)
            } else 0L
            var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

            try { format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT) } catch (_: Throwable) {}

            decoder = MediaCodec.createDecoderByType(mime)
            decoder.configure(format, null, null, 0)
            decoder.start()

            val peakRate = 300
            var blockSize = max(1, sampleRate / peakRate)
            var framesInBlock = 0
            var blockPeak = 0f
            val peaks = FloatAccumulator(16_384)

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
                                val p = ((pts * 100L) / durationUs).toInt().coerceIn(0, 99)
                                if (p != lastProgress) { lastProgress = p; onProgress(p) }
                            }
                        }
                    }
                }

                when (val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val outFormat = decoder.outputFormat
                        if (outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        if (outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        blockSize = max(1, sampleRate / peakRate)
                    }
                    else -> if (outputIndex >= 0) {
                        val output = decoder.getOutputBuffer(outputIndex)
                        if (output != null && info.size > 0) {
                            output.position(info.offset)
                            output.limit(info.offset + info.size)
                            output.order(ByteOrder.LITTLE_ENDIAN)
                            val shorts = output.slice().order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                            val ch = max(1, channels)
                            while (shorts.remaining() >= ch) {
                                var framePeak = 0
                                repeat(ch) {
                                    val s = shorts.get().toInt()
                                    framePeak = max(framePeak, abs(if (s == Short.MIN_VALUE.toInt()) Short.MAX_VALUE.toInt() else s))
                                }
                                blockPeak = max(blockPeak, framePeak / 32767f)
                                framesInBlock++
                                if (framesInBlock >= blockSize) {
                                    peaks.add(blockPeak.coerceIn(0f, 1f)); blockPeak = 0f; framesInBlock = 0
                                }
                            }
                        }
                        outputDone = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        decoder.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }

            if (framesInBlock > 0) peaks.add(blockPeak.coerceIn(0f, 1f))
            onProgress(100)
            return SpectrumData(peaks.toArray(), peakRate, durationUs, sampleRate, channels)
        } finally {
            try { decoder?.stop() } catch (_: Throwable) {}
            try { decoder?.release() } catch (_: Throwable) {}
            try { extractor.release() } catch (_: Throwable) {}
        }
    }

    private class FloatAccumulator(initialCapacity: Int) {
        private var data = FloatArray(initialCapacity)
        private var size = 0
        fun add(value: Float) { if (size >= data.size) data = data.copyOf(data.size * 2); data[size++] = value }
        fun toArray(): FloatArray = data.copyOf(size)
    }
}
