package tops.physics

import kotlinx.serialization.Serializable
import kotlin.math.pow

/**
 * Every customizable "part" is a single physical quantity. There is no
 * special-cased behavior anywhere else in the codebase keyed off part
 * choice - a part is just a slider on one of these fields, and the sim
 * turns them into forces via ordinary mechanics. Variety comes from real
 * tradeoffs (heavier => more knockback resistance but slower to accelerate;
 * rim-weighted => higher moment of inertia => spins down slower and hits
 * harder, but the same inertia makes it slower to redirect after a hit),
 * not from hardcoded abilities.
 *
 * Parts map onto fields as:
 *  - Frame (size)        -> radiusM
 *  - Weight ring          -> massKg, inertiaRatio, comOffsetM
 *  - Spin driver (tip)    -> tipFriction, lateralGrip
 *  - Frame material       -> restitution
 */
@Serializable
data class TopConfig(
    val id: String,
    val name: String,
    /** Total mass in kilograms (game-scale, not literal toy weight). */
    val massKg: Double = 0.032,
    /** Outer radius in meters. Bigger = larger collision cross-section. */
    val radiusM: Double = 0.020,
    /**
     * Where between a solid disk (0.5) and a thin rim (1.0) the mass sits.
     * I = inertiaRatio * massKg * radiusM^2. A rim-weighted top ("attack"
     * or "stamina" builds in Beyblade terms) has a higher moment of inertia
     * for the same mass: it resists both spin decay and knockback harder,
     * at the cost of being sluggish to accelerate when hit off-center.
     */
    val inertiaRatio: Double = 0.65,
    /**
     * How far the center of mass sits from the geometric center, in meters.
     * Zero is a perfectly balanced grinder. Nonzero induces a wobble torque
     * that grows as spin decays (see Simulation.wobbleThreshold) - a build
     * that trades late-match stability for something (lower mass, sharper
     * tip) elsewhere.
     */
    val comOffsetM: Double = 0.0,
    /**
     * Coulomb friction coefficient between the tip and the arena floor.
     * Directly drives spin-down rate: dω/dt = -tipFriction * g / (inertiaRatio * radiusM).
     * Low friction ("sharp tip") spins far longer; high friction ("flat
     * tip") spins down fast but is far more stable (see wobble threshold).
     */
    val tipFriction: Double = 0.03,
    /**
     * 0..1 lateral grip of the tip against the floor. High grip resists
     * being pushed by collisions and by arena slope (a stationary
     * "defense" build); low grip lets the top slide/drift across the
     * arena under collisions and slope forces (an "attack" build that
     * covers more ground and lands more hits).
     */
    val lateralGrip: Double = 0.5,
    /** Collision restitution (0=absorbs hits, 1=near-perfectly elastic). */
    val restitution: Double = 0.55,
) {
    init {
        require(massKg > 0.0) { "massKg must be positive" }
        require(radiusM > 0.0) { "radiusM must be positive" }
        require(inertiaRatio in 0.5..1.0) { "inertiaRatio must be in [0.5, 1.0]" }
        require(comOffsetM in 0.0..radiusM * 0.9) { "comOffsetM must be within the disk" }
        require(tipFriction > 0.0) { "tipFriction must be positive" }
        require(lateralGrip in 0.0..1.0) { "lateralGrip must be in [0,1]" }
        require(restitution in 0.0..1.0) { "restitution must be in [0,1]" }
    }

    /** Moment of inertia about the spin axis, I = k * m * r^2. */
    val momentOfInertia: Double get() = inertiaRatio * massKg * radiusM.pow(2)

    companion object {
        /** A safe, perfectly average starting config for new players. */
        fun default(id: String, name: String = "Starter") = TopConfig(id = id, name = name)
    }
}
