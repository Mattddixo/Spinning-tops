package tops.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onSizeChanged
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import tops.physics.ArenaConfig
import tops.physics.ArenaFeature
import tops.physics.Vector2

/** A top-down, rendering-only view of one top's state - no physics, just numbers to draw. */
data class RenderTop(
    val id: String,
    val x: Double,
    val y: Double,
    val radiusM: Double,
    val phase: Double,
    val active: Boolean,
)

/** Maps between arena meters and canvas pixels, with the arena centered and scaled to fit. */
class ArenaProjection(private val canvasSizePx: Float, private val arenaRadiusM: Double) {
    private val scale = (canvasSizePx / 2f) * 0.92f / arenaRadiusM.toFloat()
    private val centerPx = canvasSizePx / 2f

    fun toPixels(m: Vector2): Offset = Offset(centerPx + (m.x * scale).toFloat(), centerPx + (m.y * scale).toFloat())
    fun toMeters(px: Offset): Vector2 = Vector2(
        ((px.x - centerPx) / scale).toDouble(),
        ((px.y - centerPx) / scale).toDouble(),
    )

    fun metersToPx(m: Double): Float = (m * scale).toFloat()
}

@Composable
fun ArenaCanvas(
    arena: ArenaConfig,
    tops: List<RenderTop>,
    modifier: Modifier = Modifier,
    dropPointPreview: Vector2? = null,
    onProjectionReady: (ArenaProjection) -> Unit = {},
) {
    var sizePx by remember { mutableStateOf(0f) }
    val projection = remember(sizePx, arena.radiusM) {
        if (sizePx > 0f) ArenaProjection(sizePx, arena.radiusM) else null
    }

    // Only fires when the measured size (or arena) actually changes, not on every
    // frame - the draw phase below is pure rendering, no state writes in it.
    LaunchedEffect(projection) {
        projection?.let(onProjectionReady)
    }

    Box(modifier = modifier.onSizeChanged { sizePx = min(it.width, it.height).toFloat() }) {
        if (projection != null) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val centerOffset = projection.toPixels(Vector2.ZERO)
                val wallRadiusPx = projection.metersToPx(arena.radiusM)

                drawCircle(color = Color(0xFFB0BEC5), radius = wallRadiusPx, center = centerOffset, style = Stroke(width = 4f))

                for (feature in arena.features) {
                    drawFeature(feature, projection)
                }

                if (dropPointPreview != null) {
                    drawCircle(color = Color(0xFF9E9E9E), radius = 10f, center = projection.toPixels(dropPointPreview))
                }

                for (top in tops) {
                    drawTop(top, projection)
                }
            }
        }
    }
}

private fun DrawScope.drawFeature(feature: ArenaFeature, projection: ArenaProjection) {
    val center = projection.toPixels(feature.center)
    val radiusPx = projection.metersToPx(feature.radiusM)
    when (feature) {
        is ArenaFeature.Pit -> drawCircle(color = Color(0xFF212121), radius = radiusPx, center = center)
        is ArenaFeature.Bumper -> drawCircle(color = Color(0xFFFF7043), radius = radiusPx, center = center, style = Stroke(width = 6f))
        is ArenaFeature.GripZone -> {
            val tint = if (feature.gripMultiplier < 1.0) Color(0x2229B6F6) else Color(0x228D6E63)
            drawCircle(color = tint, radius = radiusPx, center = center)
        }
    }
}

private fun DrawScope.drawTop(top: RenderTop, projection: ArenaProjection) {
    if (!top.active) return
    val center = projection.toPixels(Vector2(top.x, top.y))
    val radiusPx = projection.metersToPx(top.radiusM).coerceAtLeast(6f)
    drawCircle(color = Color(0xFF3949AB), radius = radiusPx, center = center)
    val tickEnd = Offset(
        center.x + (cos(top.phase) * radiusPx).toFloat(),
        center.y + (sin(top.phase) * radiusPx).toFloat(),
    )
    drawLine(color = Color.White, start = center, end = tickEnd, strokeWidth = 3f)
}
