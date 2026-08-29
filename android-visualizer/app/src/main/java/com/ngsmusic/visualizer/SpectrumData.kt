package com.ngsmusic.visualizer

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Real spectral frames generated from PCM with FFT.
 * Each frame stores frequency-band energy plus a beat/onset envelope.
 */
data class SpectrumData(
    val bands: FloatArray,
    val bandCount: Int,
    val frameRate: Int,
    val pulse: FloatArray,
    val durationUs: Long,
    val sampleRate: Int,
    val channels: Int
) {
    val durationMs: Long get() = durationUs / 1000L
    val frameCount: Int get() = if (bandCount <= 0) 0 else bands.size / bandCount

    fun barsAt(timeMs: Long, count: Int = 72): FloatArray {
        val out = FloatArray(count)
        if (frameCount <= 0 || bandCount <= 0 || count <= 0) return out

        val framePos = (timeMs.coerceAtLeast(0L) * frameRate / 1000f)
            .coerceIn(0f, (frameCount - 1).toFloat())
        val f0 = floor(framePos).toInt()
        val f1 = min(frameCount - 1, f0 + 1)
        val ft = framePos - f0

        for (i in 0 until count) {
            val bandPos = if (count == 1) 0f else i * (bandCount - 1f) / (count - 1f)
            val b0 = floor(bandPos).toInt().coerceIn(0, bandCount - 1)
            val b1 = min(bandCount - 1, b0 + 1)
            val bt = bandPos - b0

            val a0 = bands[f0 * bandCount + b0]
            val a1 = bands[f0 * bandCount + b1]
            val z0 = bands[f1 * bandCount + b0]
            val z1 = bands[f1 * bandCount + b1]
            val v0 = a0 + (a1 - a0) * bt
            val v1 = z0 + (z1 - z0) * bt
            out[i] = (v0 + (v1 - v0) * ft).coerceIn(0f, 1f)
        }

        // Very light spatial smoothing only. Temporal smoothing already happened in analysis.
        if (count >= 5) {
            val copy = out.copyOf()
            for (i in 1 until count - 1) {
                out[i] = (copy[i - 1] * .12f + copy[i] * .76f + copy[i + 1] * .12f)
                    .coerceIn(0f, 1f)
            }
        }
        return out
    }

    fun pulseAt(timeMs: Long): Float {
        if (pulse.isEmpty()) return 0f
        val pos = (timeMs.coerceAtLeast(0L) * frameRate / 1000f)
            .coerceIn(0f, (pulse.size - 1).toFloat())
        val i0 = floor(pos).toInt()
        val i1 = min(pulse.lastIndex, i0 + 1)
        val t = pos - i0
        return (pulse[i0] + (pulse[i1] - pulse[i0]) * t).coerceIn(0f, 1f)
    }

    fun bassAt(timeMs: Long): Float {
        if (frameCount <= 0 || bandCount <= 0) return 0f
        val bars = barsAt(timeMs, max(6, min(12, bandCount)))
        val n = min(4, bars.size)
        if (n == 0) return 0f
        var sum = 0f
        for (i in 0 until n) sum += bars[i]
        return (sum / n).coerceIn(0f, 1f)
    }
}
