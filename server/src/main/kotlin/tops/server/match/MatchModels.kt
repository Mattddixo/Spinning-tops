package tops.server.match

import io.ktor.websocket.WebSocketSession
import kotlinx.coroutines.sync.Mutex
import tops.physics.LaunchInput
import tops.physics.MatchResult
import tops.physics.TopConfig
import tops.protocol.MatchMode
import tops.protocol.MatchStatus

class Participant(
    val playerId: String,
    val displayName: String,
    val topConfig: TopConfig,
    val team: Int?,
) {
    @Volatile var launch: LaunchInput? = null
}

/** In-memory lobby/match state. Matches are short-lived (a lobby plus one instantly-computed match), so there's no need to persist this beyond completion - only [MatchResult] and the leaderboard rows are durable. */
class MatchLobby(val id: String, val mode: MatchMode, val arenaId: String) {
    val mutex = Mutex()
    val participants = linkedMapOf<String, Participant>()
    val sockets = mutableListOf<WebSocketSession>()
    @Volatile var status: MatchStatus = MatchStatus.LOBBY
    @Volatile var result: MatchResult? = null
    @Volatile var winnerPlayerIds: List<String> = emptyList()

    fun capacity(): Int = when (mode) {
        MatchMode.ONE_V_ONE -> 2
        MatchMode.TEAM -> 8
        MatchMode.FFA -> 8
    }

    fun minPlayers(): Int = when (mode) {
        MatchMode.ONE_V_ONE -> 2
        MatchMode.TEAM -> 2
        MatchMode.FFA -> 2
    }

    fun nextTeamSlot(): Int? = if (mode == MatchMode.TEAM) participants.size % 2 else null
}
