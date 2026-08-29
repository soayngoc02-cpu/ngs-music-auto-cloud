package com.ngsmusic.visualizer

/** Shared preview/export position state for the visualizer. */
object WaveLayoutState {
    @Volatile var offsetX: Float = 0f
    @Volatile var offsetY: Float = 0f

    fun set(x: Float, y: Float) {
        offsetX = x.coerceIn(-0.48f, 0.48f)
        offsetY = y.coerceIn(-0.48f, 0.48f)
    }

    fun reset() {
        offsetX = 0f
        offsetY = 0f
    }
}
