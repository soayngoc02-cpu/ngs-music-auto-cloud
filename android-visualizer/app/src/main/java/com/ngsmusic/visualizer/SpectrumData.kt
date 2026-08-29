package com.ngsmusic.visualizer

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Compact audio envelope sampled hundreds of times per second.
 * It is intentionally lightweight enough for long songs and 4K/60 export.
 */
data class SpectrumData(
    val peaks: FloatArray,
    val peakRate: Int,
    val durationUs: Long,
    val sampleRate: Int,
    val channels: Int
) {
    val durationMs: Long get() = durationUs / 1000L

    fun barsAt(timeMs: Long, count: Int = 64, windowMs: Int = 340): FloatArray {
        val out = FloatArray(count)
        if (peaks.isEmpty()) return out

        val center = ((timeMs.coerceAtLeast(0L) * peakRate) / 1000L).toInt()
        val halfWindow = max(count / 2, windowMs * peakRate / 2000)
        val start = center - halfWindow
        val span = max(count, halfWindow * 2)

        for (i in 0 until count) {
            val a = start + (i * span) / count
            val b = start + ((i + 1) * span) / count
            var peak = 0f
            var j = a
            while (j <= b) {
                if (j in peaks.indices) peak = max(peak, peaks[j])
                j++
            }
            // Gentle non-linear lift: quieter detail remains visible without clipping loud hits.
            out[i] = min(1f, peak.coerceAtLeast(0f).pow(0.62f))
        }

        // Spatial smoothing makes the waveform look premium instead of jittery.
        if (count > 4) {
            val copy = out.copyOf()
            for (i in 1 until count - 1) {
                out[i] = (copy[i - 1] * 0.2f + copy[i] * 0.6f + copy[i + 1] * 0.2f)
            }
        }
        return out
    }

    fun pulseAt(timeMs: Long): Float {
        if (peaks.isEmpty()) return 0f
        val center = ((timeMs.coerceAtLeast(0L) * peakRate) / 1000L).toInt()
        val radius = max(1, peakRate / 22)
        var acc = 0f
        var n = 0
        for (i in center - radius..center + radius) {
            if (i in peaks.indices) {
                acc += peaks[i]
                n++
            }
        }
        if (n == 0) return 0f
        return min(1f, (acc / n).pow(0.55f))
    }
}
