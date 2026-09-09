package tops.server.db

import org.jetbrains.exposed.sql.Table

object Players : Table("players") {
    val id = varchar("id", 36)
    val displayName = varchar("display_name", 64)
    val secretHash = varchar("secret_hash", 128)
    val createdAt = long("created_at")
    override val primaryKey = PrimaryKey(id)
}

object Matches : Table("matches") {
    val id = varchar("id", 36)
    val mode = varchar("mode", 16)
    val arenaId = varchar("arena_id", 64)
    val status = varchar("status", 16)
    val createdAt = long("created_at")
    override val primaryKey = PrimaryKey(id)
}

/** One row per player per match. `won` is only meaningful once the match is complete. */
object MatchParticipants : Table("match_participants") {
    val matchId = varchar("match_id", 36).references(Matches.id)
    val playerId = varchar("player_id", 36).references(Players.id)
    val team = integer("team").nullable()
    val topConfigJson = text("top_config_json")
    val won = bool("won").default(false)
    override val primaryKey = PrimaryKey(matchId, playerId)
}

/** The full authoritative replay for a completed match, kept for the leaderboard and post-match viewing. */
object MatchResults : Table("match_results") {
    val matchId = varchar("match_id", 36).references(Matches.id)
    val resultJson = text("result_json")
    val completedAt = long("completed_at")
    override val primaryKey = PrimaryKey(matchId)
}
