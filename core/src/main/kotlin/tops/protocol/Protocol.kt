package tops.protocol

import kotlinx.serialization.Serializable
import tops.physics.ArenaConfig
import tops.physics.LaunchInput
import tops.physics.MatchResult
import tops.physics.TopConfig

/**
 * The client/server wire contract. Lives in :core (not :server) so the Android app and the
 * backend compile against the exact same request/response/event types - no hand-kept-in-sync
 * duplicate DTOs on either side.
 */
@Serializable
enum class MatchMode { ONE_V_ONE, TEAM, FFA }

@Serializable
enum class MatchStatus { LOBBY, IN_PROGRESS, COMPLETE }

@Serializable
data class RegisterRequest(val displayName: String)

@Serializable
data class RegisterResponse(val playerId: String, val secretToken: String, val displayName: String)

@Serializable
data class ErrorResponse(val message: String)

@Serializable
data class CreateMatchRequest(val mode: MatchMode, val arenaId: String, val topConfig: TopConfig)

@Serializable
data class CreateMatchResponse(val matchId: String)

@Serializable
data class JoinMatchRequest(val topConfig: TopConfig)

@Serializable
data class ParticipantView(val playerId: String, val displayName: String, val team: Int?, val ready: Boolean)

@Serializable
data class MatchLobbyView(
    val matchId: String,
    val mode: MatchMode,
    val arenaId: String,
    val status: MatchStatus,
    val participants: List<ParticipantView>,
)

@Serializable
data class ArenaListResponse(val arenas: List<ArenaConfig>)

@Serializable
data class LeaderboardEntry(
    val playerId: String,
    val displayName: String,
    val matches: Int,
    val wins: Int,
)

typealias LaunchRequest = LaunchInput

@Serializable
sealed class MatchEvent {
    @Serializable data class ParticipantJoined(val playerId: String, val displayName: String) : MatchEvent()
    @Serializable data class LaunchSubmitted(val playerId: String) : MatchEvent()
    @Serializable data class MatchComplete(val result: MatchResult, val winnerPlayerIds: List<String>) : MatchEvent()
    @Serializable data class LobbyError(val message: String) : MatchEvent()
}
