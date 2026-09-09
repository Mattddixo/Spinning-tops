package tops.physics

import kotlinx.serialization.Serializable

/**
 * Everything a player controls, and nothing else: where it lands, how hard
 * it's spun, and which way. Once this is submitted there is no further
 * input - the match plays out entirely from the physics in [Simulation].
 */
@Serializable
data class LaunchInput(
    val topId: String,
    val dropPoint: Vector2,
    /** 0..1, from the charge/power bar - scales directly to launch spin rate. */
    val launchPower: Double,
    val clockwise: Boolean = true,
) {
    init {
        require(launchPower in 0.0..1.0) { "launchPower must be in [0,1]" }
    }
}

/** The authoritative outcome of a match, produced once by [Simulation.simulateMatch]. */
@Serializable
data class MatchResult(
    val arenaId: String,
    val totalTicks: Int,
    val frames: List<MatchFrame>,
    /** Top id(s) still active when the match ended - empty means a double/multi knockout on the same tick. */
    val survivorTopIds: List<String>,
    /** Top ids in the order they were eliminated. */
    val eliminationOrder: List<String>,
)
