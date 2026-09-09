package tops.server.leaderboard

import org.jetbrains.exposed.sql.select
import org.jetbrains.exposed.sql.selectAll
import tops.protocol.LeaderboardEntry
import tops.protocol.MatchMode
import tops.server.db.Db
import tops.server.db.MatchParticipants
import tops.server.db.Matches
import tops.server.db.Players

object Leaderboard {
    suspend fun query(modeFilter: MatchMode?): List<LeaderboardEntry> = Db.query {
        val rows = if (modeFilter == null) {
            MatchParticipants.selectAll().toList()
        } else {
            (MatchParticipants innerJoin Matches).selectAll()
                .where { Matches.mode eq modeFilter.name }
                .toList()
        }
        rows.groupBy { it[MatchParticipants.playerId] }
            .map { (playerId, group) ->
                val wins = group.count { it[MatchParticipants.won] }
                val displayName = Players.select(Players.displayName)
                    .where { Players.id eq playerId }
                    .singleOrNull()
                    ?.get(Players.displayName)
                    ?: "Unknown"
                LeaderboardEntry(playerId = playerId, displayName = displayName, matches = group.size, wins = wins)
            }
            .sortedWith(compareByDescending<LeaderboardEntry> { it.wins }.thenByDescending { it.matches })
    }
}
