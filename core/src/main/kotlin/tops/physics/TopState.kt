package tops.physics

import kotlinx.serialization.Serializable

/**
 * Mutable runtime state for one top during simulation. Kept separate from
 * [TopConfig] (which never changes mid-match) and from [TopSnapshot] (the
 * immutable, serializable frame sent to clients for rendering/replay).
 */
class TopState(
    val config: TopConfig,
    var position: Vector2,
    var velocity: Vector2 = Vector2.ZERO,
    /** Angular velocity in rad/s. Sign is spin direction; magnitude decays over time. */
    var spinRate: Double,
    var active: Boolean = true,
    /** Set once, the tick on which this top was eliminated (wobbled out, pitted, or launched over the wall). */
    var eliminatedAtTick: Int? = null,
    /**
     * Rotation phase in radians, purely so a client can draw a rotation tick mark
     * without running any animation logic of its own - it's just cos(phase)/sin(phase).
     */
    var phase: Double = 0.0,
) {
    fun toSnapshot(tick: Int): TopSnapshot = TopSnapshot(
        topId = config.id,
        tick = tick,
        x = position.x,
        y = position.y,
        spinRate = spinRate,
        phase = phase,
        active = active,
    )
}

/** Immutable, serializable per-tick frame for one top - what actually goes over the wire. */
@Serializable
data class TopSnapshot(
    val topId: String,
    val tick: Int,
    val x: Double,
    val y: Double,
    val spinRate: Double,
    val phase: Double,
    val active: Boolean,
)

/** One full tick's worth of frames for every top still worth reporting on. */
@Serializable
data class MatchFrame(
    val tick: Int,
    val tops: List<TopSnapshot>,
)
