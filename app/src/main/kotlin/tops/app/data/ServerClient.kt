package tops.app.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import tops.physics.ArenaConfig
import tops.physics.LaunchInput
import tops.physics.MatchResult
import tops.physics.TopConfig
import tops.protocol.ArenaListResponse
import tops.protocol.CreateMatchRequest
import tops.protocol.CreateMatchResponse
import tops.protocol.JoinMatchRequest
import tops.protocol.LeaderboardEntry
import tops.protocol.MatchLobbyView
import tops.protocol.MatchMode
import tops.protocol.RegisterRequest
import tops.protocol.RegisterResponse

/**
 * Thin wrapper over the Ktor client. The server is the sole physics authority (see
 * :core Simulation) - this class only ever moves data, never runs any game logic.
 */
class ServerClient(private val baseUrl: String, private val profile: PlayerProfile?) {
    private val client = HttpClient(CIO) {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        install(WebSockets)
    }

    suspend fun register(displayName: String): RegisterResponse =
        client.post("$baseUrl/players/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(displayName))
        }.body()

    suspend fun arenas(): List<ArenaConfig> =
        client.get("$baseUrl/arenas").body<ArenaListResponse>().arenas

    suspend fun createMatch(mode: MatchMode, arenaId: String, topConfig: TopConfig): String =
        client.post("$baseUrl/matches") {
            authHeaders()
            contentType(ContentType.Application.Json)
            setBody(CreateMatchRequest(mode, arenaId, topConfig))
        }.body<CreateMatchResponse>().matchId

    suspend fun joinMatch(matchId: String, topConfig: TopConfig): MatchLobbyView =
        client.post("$baseUrl/matches/$matchId/join") {
            authHeaders()
            contentType(ContentType.Application.Json)
            setBody(JoinMatchRequest(topConfig))
        }.body()

    suspend fun getMatch(matchId: String): MatchLobbyView =
        client.get("$baseUrl/matches/$matchId").body()

    suspend fun submitLaunch(matchId: String, launch: LaunchInput): MatchLobbyView =
        client.post("$baseUrl/matches/$matchId/launch") {
            authHeaders()
            contentType(ContentType.Application.Json)
            setBody(launch)
        }.body()

    suspend fun getResult(matchId: String): MatchResult? {
        val response = client.get("$baseUrl/matches/$matchId/result")
        return if (response.status.value == 200) response.body() else null
    }

    suspend fun leaderboard(mode: MatchMode? = null): List<LeaderboardEntry> {
        val url = if (mode == null) "$baseUrl/leaderboard" else "$baseUrl/leaderboard?mode=${mode.name}"
        return client.get(url).body()
    }

    /** Opens the live socket for a match's join/launch/result push events. */
    suspend fun matchSocket(matchId: String): DefaultClientWebSocketSession {
        val id = profile?.playerId
        val token = profile?.secretToken
        return client.webSocketSession("${baseUrl.toWsUrl()}/matches/$matchId/socket") {
            if (id != null) header("X-Player-Id", id)
            if (token != null) header("X-Player-Token", token)
        }
    }

    private fun HttpRequestBuilder.authHeaders() {
        profile?.let {
            header("X-Player-Id", it.playerId)
            header("X-Player-Token", it.secretToken)
        }
    }

    private fun String.toWsUrl(): String = replaceFirst("http://", "ws://").replaceFirst("https://", "wss://")

    fun close() = client.close()
}
