package tops.physics

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs

class SimulationTest {

    private fun soloSim(config: TopConfig, arena: ArenaConfig = ArenaConfig.classic(), spinRate: Double = 150.0): Simulation {
        val state = TopState(config = config, position = Vector2.ZERO, spinRate = spinRate)
        return Simulation(arena, listOf(state))
    }

    @Test
    fun `spin rate decays toward zero and never overshoots negative`() {
        val sim = soloSim(TopConfig.default("a"))
        var lastSpin = sim.tops[0].spinRate
        repeat(20_000) {
            if (sim.activeTops().isEmpty()) return@repeat
            sim.step(Simulation.FIXED_DT)
            val spin = sim.tops[0].spinRate
            assertTrue(abs(spin) <= abs(lastSpin) + 1e-9, "spin magnitude must be monotonically non-increasing")
            lastSpin = spin
        }
        assertTrue(sim.tops[0].active.not() || abs(sim.tops[0].spinRate) < 5.0)
    }

    @Test
    fun `higher inertia ratio (rim-weighted) decays spin slower than a solid disk of the same shape`() {
        val disk = TopConfig.default("disk").copy(inertiaRatio = 0.5)
        val rim = TopConfig.default("rim").copy(inertiaRatio = 1.0)
        val diskSim = soloSim(disk)
        val rimSim = soloSim(rim)
        repeat(600) {
            diskSim.step(Simulation.FIXED_DT)
            rimSim.step(Simulation.FIXED_DT)
        }
        assertTrue(
            abs(rimSim.tops[0].spinRate) > abs(diskSim.tops[0].spinRate),
            "rim-weighted top should retain more spin after the same time",
        )
    }

    @Test
    fun `imbalanced top topples at a higher residual spin than a balanced one`() {
        val balanced = TopConfig.default("balanced").copy(comOffsetM = 0.0)
        val imbalanced = TopConfig.default("imbalanced").copy(comOffsetM = balanced.radiusM * 0.8)
        val balancedSim = soloSim(balanced, spinRate = 150.0)
        val imbalancedSim = soloSim(imbalanced, spinRate = 150.0)

        var balancedStopTick = -1
        var imbalancedStopTick = -1
        repeat(20_000) { i ->
            if (balancedStopTick < 0 && balancedSim.activeTops().isEmpty()) balancedStopTick = i
            if (imbalancedStopTick < 0 && imbalancedSim.activeTops().isEmpty()) imbalancedStopTick = i
            if (balancedStopTick < 0) balancedSim.step(Simulation.FIXED_DT)
            if (imbalancedStopTick < 0) imbalancedSim.step(Simulation.FIXED_DT)
        }
        assertTrue(balancedStopTick > 0 && imbalancedStopTick > 0, "both tops should eventually topple")
        assertTrue(imbalancedStopTick < balancedStopTick, "imbalanced top should topple earlier")
    }

    @Test
    fun `ring-out arena eliminates a top that drifts past the wall, classic arena bounces it back`() {
        val cfg = TopConfig.default("drifter").copy(lateralGrip = 0.0, tipFriction = 0.01)
        val edgeArena = ArenaConfig.classic().copy(radiusM = 0.10, basinStrength = 0.0)
        val bouncy = soloSim(cfg, edgeArena.copy(ringOutEnabled = false))
        val ringOut = soloSim(cfg, edgeArena.copy(ringOutEnabled = true))
        bouncy.tops[0].velocity = Vector2(5.0, 0.0)
        ringOut.tops[0].velocity = Vector2(5.0, 0.0)

        repeat(200) {
            if (bouncy.activeTops().isNotEmpty()) bouncy.step(Simulation.FIXED_DT)
            if (ringOut.activeTops().isNotEmpty()) ringOut.step(Simulation.FIXED_DT)
        }

        assertTrue(bouncy.tops[0].active, "solid-wall arena must not eliminate the top")
        assertTrue(bouncy.tops[0].position.length() <= edgeArena.radiusM + 1e-6, "top must stay within the wall")
        assertTrue(ringOut.tops[0].active.not(), "ring-out arena must eliminate a top that crosses the wall")
    }

    @Test
    fun `two tops launched at each other collide without penetrating or exploding`() {
        val a = TopState(config = TopConfig.default("a"), position = Vector2(-0.05, 0.0), velocity = Vector2(2.0, 0.0), spinRate = 100.0)
        val b = TopState(config = TopConfig.default("b"), position = Vector2(0.05, 0.0), velocity = Vector2(-2.0, 0.0), spinRate = -100.0)
        val sim = Simulation(ArenaConfig.classic().copy(basinStrength = 0.0), listOf(a, b))
        repeat(300) { sim.step(Simulation.FIXED_DT) }

        val dist = (b.position - a.position).length()
        assertTrue(dist >= a.config.radiusM + b.config.radiusM - 1e-3, "tops must not end up overlapping")
        for (top in sim.tops) {
            assertTrue(top.velocity.length() < 100.0, "velocity must stay bounded, no collision explosion")
            assertTrue(!top.position.x.isNaN() && !top.position.y.isNaN())
        }
    }

    @Test
    fun `simulateMatch produces a bounded, non-empty replay and accounts for every top`() {
        val configs = listOf(TopConfig.default("p1"), TopConfig.default("p2"))
        val launches = listOf(
            LaunchInput(topId = "p1", dropPoint = Vector2(-0.15, 0.0), launchPower = 1.0, clockwise = true),
            LaunchInput(topId = "p2", dropPoint = Vector2(0.15, 0.0), launchPower = 1.0, clockwise = false),
        )
        val result = Simulation.simulateMatch(ArenaConfig.classic(), configs, launches, maxTicks = 6000)

        assertTrue(result.frames.isNotEmpty())
        assertTrue(result.totalTicks <= 6000)
        assertEquals(configs.size, result.survivorTopIds.size + result.eliminationOrder.size)
    }
}
