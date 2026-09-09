package tops.physics

import kotlinx.serialization.Serializable

/**
 * An arena is just a boundary plus a small set of generic force/zone
 * primitives, composed. There's no per-arena bespoke code: "interesting"
 * arenas come from where you place these, not from special logic, which
 * is what keeps them simple to build while still letting design carry the
 * gameplay.
 */
@Serializable
data class ArenaConfig(
    val id: String,
    val name: String,
    /** Outer wall radius in meters, centered on (0,0). */
    val radiusM: Double = 0.60,
    /** Bounciness off the outer wall. */
    val wallRestitution: Double = 0.35,
    /**
     * Strength (1/s^2) of the parabolic-bowl restoring force pulling tops
     * back toward the center, proportional to distance from center:
     * accel = -basinStrength * offsetFromCenter. This is the physical
     * stand-in for the arena floor sloping up like a real stadium bowl.
     * Zero means a flat floor (pure friction arena); negative means a
     * dome that pushes tops outward toward the wall.
     */
    val basinStrength: Double = 0.9,
    /**
     * When true, a top whose center crosses the outer wall is eliminated
     * immediately (a "ring-out" stadium with an exit gap) instead of
     * bouncing off a solid wall.
     */
    val ringOutEnabled: Boolean = false,
    val features: List<ArenaFeature> = emptyList(),
) {
    init {
        require(radiusM > 0.0) { "radiusM must be positive" }
        require(wallRestitution in 0.0..1.0) { "wallRestitution must be in [0,1]" }
    }

    companion object {
        /** A plain round bowl with no extra features - the "neutral" arena. */
        fun classic(id: String = "classic", name: String = "Classic Bowl") =
            ArenaConfig(id = id, name = name)
    }
}

@Serializable
sealed class ArenaFeature {
    // Concrete cases (Pit/Bumper/GripZone) are annotated individually; the
    // parent must also be @Serializable for kotlinx.serialization to wire up
    // polymorphic (de)serialization automatically within this module.
    abstract val center: Vector2
    abstract val radiusM: Double

    /** Entering this zone eliminates the top immediately (a hole/pit). */
    @Serializable
    data class Pit(override val center: Vector2, override val radiusM: Double) : ArenaFeature()

    /** A radial bumper: pushes tops outward from `center` when within range. */
    @Serializable
    data class Bumper(
        override val center: Vector2,
        override val radiusM: Double,
        val strength: Double,
    ) : ArenaFeature()

    /**
     * Multiplies effective lateralGrip while inside the zone: less than 1
     * is a slick patch (tops slide/drift more), greater than 1 is a rough
     * patch (tops plant and resist being pushed).
     */
    @Serializable
    data class GripZone(
        override val center: Vector2,
        override val radiusM: Double,
        val gripMultiplier: Double,
    ) : ArenaFeature()
}
