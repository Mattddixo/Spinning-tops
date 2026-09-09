package tops.server.arena

import tops.physics.ArenaConfig
import tops.physics.ArenaFeature
import tops.physics.Vector2

/**
 * The server is the source of truth for arena physics so new layouts can ship without an
 * app update. Each preset composes the same handful of primitives (wall, basin, bumper,
 * grip zone, pit) differently - there's no bespoke per-arena code, just where things sit.
 */
object Arenas {
    private val presets: Map<String, ArenaConfig> = listOf(
        ArenaConfig.classic(id = "classic", name = "Classic Bowl"),

        // A central bumper punishes camping in the middle and rewards either high grip
        // (resist the push) or reading the bumper to get flung toward an opponent - and
        // since the wall is a ring-out, drifting too far is a loss, not a bounce back in.
        ArenaConfig(
            id = "ring_out_stadium",
            name = "Ring-Out Stadium",
            radiusM = 0.55,
            wallRestitution = 0.2,
            basinStrength = 0.25,
            ringOutEnabled = true,
            features = listOf(ArenaFeature.Bumper(center = Vector2.ZERO, radiusM = 0.14, strength = 7.0)),
        ),

        // A strong bowl pulls everyone toward the middle, where a pit waits. Low-grip
        // "attack" tops get reeled in fast; high-grip "defense" tops can cling to the rim
        // longer, but the pull never stops, so stalling forever isn't an option either.
        ArenaConfig(
            id = "pit_trap",
            name = "Pit Trap",
            radiusM = 0.50,
            wallRestitution = 0.6,
            basinStrength = 1.4,
            ringOutEnabled = false,
            features = listOf(ArenaFeature.Pit(center = Vector2.ZERO, radiusM = 0.05)),
        ),

        // Two slick patches near the wall let a low-grip top slingshot around the rim;
        // a high-grip top just plants and ignores them. No bumpers or pits at all - the
        // variety here comes entirely from the grip stat interacting with the surface.
        ArenaConfig(
            id = "slick_ring",
            name = "Slick Ring",
            radiusM = 0.55,
            wallRestitution = 0.5,
            basinStrength = 0.6,
            features = listOf(
                ArenaFeature.GripZone(center = Vector2(0.35, 0.0), radiusM = 0.16, gripMultiplier = 0.15),
                ArenaFeature.GripZone(center = Vector2(-0.35, 0.0), radiusM = 0.16, gripMultiplier = 0.15),
            ),
        ),
    ).associateBy { it.id }

    fun byId(id: String): ArenaConfig = presets[id] ?: error("unknown arenaId: $id")

    fun list(): List<ArenaConfig> = presets.values.toList()
}
