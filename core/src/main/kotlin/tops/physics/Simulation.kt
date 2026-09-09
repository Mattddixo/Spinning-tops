package tops.physics

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * The entire game's physics in one place. Every "part" a player picks
 * (see [TopConfig]) and every arena layout (see [ArenaConfig]) only ever
 * feeds numbers into the equations below - there is no per-part or
 * per-arena special-case branch anywhere in here. This is what makes the
 * customization system "just part of the physical system": if it plays
 * differently, it's because a real force changed, not because of a rule.
 *
 * Deterministic and wall-clock-free (advances by a fixed `dt` per [step]
 * call) so the server can run it as the sole authority and either replay
 * frames to clients or - if ever needed - a client could re-simulate the
 * exact same match from the same inputs.
 */
class Simulation(
    val arena: ArenaConfig,
    val tops: List<TopState>,
) {
    private var tick: Int = 0

    /** Advance the whole match by one fixed timestep. */
    fun step(dt: Double) {
        for (top in tops) {
            if (!top.active) continue
            applySpinDecay(top, dt)
            if (!top.active) continue
            applyArenaForces(top, dt)
            applyEccentricWobble(top, dt)
            integrate(top, dt)
            applyWallInteraction(top)
            checkFeatureElimination(top)
        }
        resolveCollisions()
        tick++
    }

    fun currentTick(): Int = tick

    fun activeTops(): List<TopState> = tops.filter { it.active }

    fun snapshotFrame(): MatchFrame = MatchFrame(tick = tick, tops = tops.map { it.toSnapshot(tick) })

    private fun applySpinDecay(top: TopState, dt: Double) {
        val cfg = top.config
        // alpha = mu * g * tipContactRadius / (I / m) ... mass cancels out of I/m = inertiaRatio*r^2,
        // so decay rate only depends on friction, shape (inertiaRatio) and size - not mass. A heavier
        // top of the same shape spins down at the same rate as a lighter one, but hits harder.
        val alpha = cfg.tipFriction * GRAVITY * TIP_CONTACT_RADIUS_M / (cfg.inertiaRatio * cfg.radiusM * cfg.radiusM)
        val sign = if (top.spinRate >= 0) 1.0 else -1.0
        val newSpin = top.spinRate - sign * alpha * dt
        top.spinRate = if (sign * newSpin < 0) 0.0 else newSpin

        val wobbleThreshold = wobbleThreshold(cfg)
        if (abs(top.spinRate) < wobbleThreshold) {
            top.active = false
            top.eliminatedAtTick = tick
        }
    }

    /** Below this |spinRate|, a top topples. Imbalance (comOffsetM) raises the threshold. */
    private fun wobbleThreshold(cfg: TopConfig): Double =
        BASE_WOBBLE_SPIN_RAD_S * (1.0 + (cfg.comOffsetM / cfg.radiusM) * WOBBLE_IMBALANCE_FACTOR)

    private fun applyArenaForces(top: TopState, dt: Double) {
        val cfg = top.config
        var accel = -top.position * arena.basinStrength // parabolic-bowl restoring force

        var effectiveGrip = cfg.lateralGrip
        for (feature in arena.features) {
            val toTop = top.position - feature.center
            val dist = toTop.length()
            if (dist > feature.radiusM) continue
            when (feature) {
                is ArenaFeature.Bumper -> {
                    val dir = toTop.normalizedOrZero()
                    val falloff = 1.0 - dist / feature.radiusM
                    accel += dir * (feature.strength * falloff)
                }
                is ArenaFeature.GripZone -> effectiveGrip *= feature.gripMultiplier
                is ArenaFeature.Pit -> Unit // handled in checkFeatureElimination
            }
        }
        effectiveGrip = effectiveGrip.coerceIn(0.0, 1.0)

        top.velocity += accel * dt
        // Linear drag standing in for how hard the tip "bites" the floor: high grip bleeds
        // linear speed fast (stays near its drop point), low grip lets it keep drifting.
        val dampingFactor = (1.0 - effectiveGrip * LATERAL_DAMPING_SCALE * dt).coerceIn(0.0, 1.0)
        top.velocity *= dampingFactor
    }

    /** An off-center mass sweeps around as the top spins, producing a small rotating side-force. */
    private fun applyEccentricWobble(top: TopState, dt: Double) {
        val cfg = top.config
        if (cfg.comOffsetM <= 0.0) return
        top.phase += top.spinRate * dt
        val dir = Vector2(cos(top.phase), sin(top.phase))
        val forceMag = cfg.comOffsetM * top.spinRate * top.spinRate * ECCENTRIC_FORCE_SCALE
        top.velocity += dir * (forceMag * dt)
    }

    private fun integrate(top: TopState, dt: Double) {
        top.position += top.velocity * dt
        if (top.config.comOffsetM <= 0.0) {
            // Balanced tops don't get a wobble phase kick, but still spin - keep the
            // rendered rotation indicator moving for the client.
            top.phase += top.spinRate * dt
        }
    }

    private fun applyWallInteraction(top: TopState) {
        val dist = top.position.length()
        val limit = arena.radiusM
        if (dist <= limit) return
        if (arena.ringOutEnabled) {
            top.active = false
            top.eliminatedAtTick = tick
            return
        }
        val normal = top.position.normalizedOrZero()
        top.position = normal * limit
        val vn = top.velocity.dot(normal)
        if (vn > 0) {
            top.velocity -= normal * (vn * (1.0 + arena.wallRestitution))
        }
    }

    private fun checkFeatureElimination(top: TopState) {
        if (!top.active) return
        for (feature in arena.features) {
            if (feature is ArenaFeature.Pit) {
                if ((top.position - feature.center).length() <= feature.radiusM) {
                    top.active = false
                    top.eliminatedAtTick = tick
                    return
                }
            }
        }
    }

    private fun resolveCollisions() {
        val active = tops.filter { it.active }
        for (i in active.indices) {
            for (j in i + 1..active.lastIndex) {
                resolvePair(active[i], active[j])
            }
        }
    }

    private fun resolvePair(a: TopState, b: TopState) {
        val delta = b.position - a.position
        val dist = delta.length()
        val minDist = a.config.radiusM + b.config.radiusM
        if (dist >= minDist || dist < 1e-9) return

        val n = delta * (1.0 / dist) // normal from a to b
        val relVel = b.velocity - a.velocity
        val vn = relVel.dot(n)

        val invMassA = 1.0 / a.config.massKg
        val invMassB = 1.0 / b.config.massKg

        // Positional correction so tops don't sink into each other.
        val penetration = minDist - dist
        val correction = n * (penetration / (invMassA + invMassB) * POSITION_CORRECTION_PERCENT)
        a.position -= correction * invMassA
        b.position += correction * invMassB

        if (vn >= 0) return // already separating

        val e = (a.config.restitution + b.config.restitution) / 2.0
        val jn = -(1.0 + e) * vn / (invMassA + invMassB)
        val normalImpulse = n * jn
        a.velocity -= normalImpulse * invMassA
        b.velocity += normalImpulse * invMassB

        applyGrindFriction(a, b, n, jn)
    }

    /**
     * Coulomb friction at the contact point between two spinning rims. This is what makes
     * spin rate, tip friction and radius matter *during* a hit, not just before it: it
     * converts some of each top's spin into a push on the other (and on itself).
     */
    private fun applyGrindFriction(a: TopState, b: TopState, n: Vector2, jn: Double) {
        val t = n.perp()
        val rA = -n * a.config.radiusM
        val rB = n * b.config.radiusM
        val surfaceVelA = a.velocity + t * (a.spinRate * a.config.radiusM)
        val surfaceVelB = b.velocity + t * (b.spinRate * b.config.radiusM)
        val vt = (surfaceVelB - surfaceVelA).dot(t)
        if (abs(vt) < 1e-9) return

        val mu = (a.config.tipFriction + b.config.tipFriction) / 2.0 * GRIND_COUPLING
        val invMassA = 1.0 / a.config.massKg
        val invMassB = 1.0 / b.config.massKg
        val maxImpulse = abs(vt) / (invMassA + invMassB)
        val jt = (-mu * abs(jn)).coerceIn(-maxImpulse, maxImpulse) * if (vt > 0) 1.0 else -1.0

        val frictionImpulse = t * jt
        a.velocity -= frictionImpulse * invMassA
        b.velocity += frictionImpulse * invMassB

        // Equal-and-opposite angular impulse from the same tangential force at the contact point.
        val torqueA = cross(rA, -frictionImpulse)
        val torqueB = cross(rB, frictionImpulse)
        a.spinRate += torqueA / a.config.momentOfInertia
        b.spinRate += torqueB / b.config.momentOfInertia
    }

    private fun cross(r: Vector2, f: Vector2): Double = r.x * f.y - r.y * f.x

    companion object {
        const val GRAVITY = 9.81
        const val TIP_CONTACT_RADIUS_M = 0.003
        const val BASE_WOBBLE_SPIN_RAD_S = 2.0
        const val WOBBLE_IMBALANCE_FACTOR = 6.0
        const val LATERAL_DAMPING_SCALE = 0.6
        const val ECCENTRIC_FORCE_SCALE = 0.02
        const val GRIND_COUPLING = 0.5
        const val POSITION_CORRECTION_PERCENT = 0.8
        const val FIXED_DT = 1.0 / 120.0

        /**
         * Runs a whole match to completion (or [maxTicks]) starting from a set of
         * [LaunchInput]s, recording one [MatchFrame] every [recordEveryNTicks] ticks.
         * This is the single function the server calls to be the authority for a match.
         */
        fun simulateMatch(
            arena: ArenaConfig,
            configs: List<TopConfig>,
            launches: List<LaunchInput>,
            maxTicks: Int = 3600, // 30s at 120Hz
            recordEveryNTicks: Int = 4, // ~30Hz replay stream
        ): MatchResult {
            require(configs.size == launches.size) { "one launch per top" }
            val byId = configs.associateBy { it.id }
            val states = launches.map { launch ->
                val cfg = byId.getValue(launch.topId)
                val sign = if (launch.clockwise) 1.0 else -1.0
                TopState(
                    config = cfg,
                    position = launch.dropPoint,
                    velocity = Vector2.ZERO,
                    spinRate = sign * launch.launchPower * MAX_LAUNCH_SPIN_RAD_S,
                )
            }
            val sim = Simulation(arena, states)
            val frames = mutableListOf<MatchFrame>()
            frames += sim.snapshotFrame()
            while (sim.activeTops().size > 1 && sim.currentTick() < maxTicks) {
                sim.step(FIXED_DT)
                if (sim.currentTick() % recordEveryNTicks == 0) {
                    frames += sim.snapshotFrame()
                }
            }
            if (frames.last().tick != sim.currentTick()) frames += sim.snapshotFrame()

            val survivors = sim.activeTops().map { it.config.id }
            return MatchResult(
                arenaId = arena.id,
                totalTicks = sim.currentTick(),
                frames = frames,
                survivorTopIds = survivors,
                eliminationOrder = states
                    .filter { it.eliminatedAtTick != null }
                    .sortedBy { it.eliminatedAtTick }
                    .map { it.config.id },
            )
        }

        const val MAX_LAUNCH_SPIN_RAD_S = 220.0 // ~35 rev/s at full power
    }
}
