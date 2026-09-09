package tops.server.match

import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.update
import tops.physics.ArenaConfig
import tops.physics.LaunchInput
import tops.physics.MatchResult
import tops.physics.Simulation
import tops.physics.TopConfig
import tops.protocol.MatchEvent
import tops.protocol.MatchMode
import tops.protocol.MatchStatus
import tops.server.arena.Arenas
import tops.server.db.Db
import tops.server.db.MatchParticipants
import tops.server.db.MatchResults
import tops.server.db.Matches

sealed class LobbyOutcome {
    data class Ok(val lobby: MatchLobby) : LobbyOutcome()
    data class Error(val message: String) : LobbyOutcome()
}

/**
 * Owns every in-progress lobby/match. A match is computed the instant the last player
 * submits a launch - the server is the sole physics authority (see [Simulation]), so
 * there is nothing to keep in sync afterward, only a result to hand out.
 */
object MatchEngine {
    private val json = Json { ignoreUnknownKeys = true }
    private val lobbies = ConcurrentHashMap<String, MatchLobby>()

    fun get(matchId: String): MatchLobby? = lobbies[matchId]

    suspend fun createMatch(
        mode: MatchMode,
        arenaId: String,
        hostPlayerId: String,
        hostDisplayName: String,
        hostTopConfig: TopConfig,
    ): MatchLobby {
        Arenas.byId(arenaId) // fail fast on an unknown arena
        val lobby = MatchLobby(id = UUID.randomUUID().toString(), mode = mode, arenaId = arenaId)
        lobby.participants[hostPlayerId] = Participant(hostPlayerId, hostDisplayName, hostTopConfig, lobby.nextTeamSlot())
        lobbies[lobby.id] = lobby
        Db.query {
            Matches.insert {
                it[Matches.id] = lobby.id
                it[Matches.mode] = mode.name
                it[Matches.arenaId] = arenaId
                it[Matches.status] = "LOBBY"
                it[Matches.createdAt] = System.currentTimeMillis()
            }
        }
        return lobby
    }

    suspend fun join(lobby: MatchLobby, playerId: String, displayName: String, topConfig: TopConfig): LobbyOutcome {
        val outcome = lobby.mutex.withLock {
            when {
                lobby.status != MatchStatus.LOBBY -> LobbyOutcome.Error("match already started")
                lobby.participants.containsKey(playerId) -> LobbyOutcome.Ok(lobby)
                lobby.participants.size >= lobby.capacity() -> LobbyOutcome.Error("match is full")
                else -> {
                    lobby.participants[playerId] = Participant(playerId, displayName, topConfig, lobby.nextTeamSlot())
                    LobbyOutcome.Ok(lobby)
                }
            }
        }
        if (outcome is LobbyOutcome.Ok) broadcast(lobby, MatchEvent.ParticipantJoined(playerId, displayName))
        return outcome
    }

    suspend fun submitLaunch(lobby: MatchLobby, playerId: String, launch: LaunchInput): LobbyOutcome {
        var readyToRun = false
        val gate = lobby.mutex.withLock {
            val participant = lobby.participants[playerId]
                ?: return LobbyOutcome.Error("not a participant in this match")
            if (lobby.status != MatchStatus.LOBBY) return LobbyOutcome.Error("match already started")
            participant.launch = launch
            val allIn = lobby.participants.values.all { it.launch != null }
            if (allIn && lobby.participants.size >= lobby.minPlayers()) {
                lobby.status = MatchStatus.IN_PROGRESS
                readyToRun = true
            }
            LobbyOutcome.Ok(lobby)
        }
        broadcast(lobby, MatchEvent.LaunchSubmitted(playerId))
        if (readyToRun) runMatch(lobby)
        return gate
    }

    fun addSocket(lobby: MatchLobby, session: WebSocketSession) {
        synchronized(lobby.sockets) { lobby.sockets.add(session) }
    }

    fun removeSocket(lobby: MatchLobby, session: WebSocketSession) {
        synchronized(lobby.sockets) { lobby.sockets.remove(session) }
    }

    private suspend fun runMatch(lobby: MatchLobby) {
        val arena: ArenaConfig = Arenas.byId(lobby.arenaId)
        val participants = lobby.participants.values.toList()
        val configs = participants.map { it.topConfig }
        val launches = participants.map { it.launch!! }

        val result = withContext(Dispatchers.Default) {
            Simulation.simulateMatch(arena, configs, launches)
        }
        val winnerPlayerIds = determineWinners(lobby.mode, participants, result)

        lobby.result = result
        lobby.winnerPlayerIds = winnerPlayerIds
        lobby.status = MatchStatus.COMPLETE

        persistResult(lobby, participants, result, winnerPlayerIds)
        broadcast(lobby, MatchEvent.MatchComplete(result, winnerPlayerIds))
    }

    private fun determineWinners(mode: MatchMode, participants: List<Participant>, result: MatchResult): List<String> {
        val survivorIds = result.survivorTopIds.toSet()
        val survivors = participants.filter { it.topConfig.id in survivorIds }
        return when (mode) {
            MatchMode.TEAM -> {
                val winningTeam = survivors.firstOrNull()?.team
                if (winningTeam == null) emptyList() else participants.filter { it.team == winningTeam }.map { it.playerId }
            }
            MatchMode.ONE_V_ONE, MatchMode.FFA -> survivors.map { it.playerId }
        }
    }

    private suspend fun persistResult(
        lobby: MatchLobby,
        participants: List<Participant>,
        result: MatchResult,
        winnerPlayerIds: List<String>,
    ) {
        val winners = winnerPlayerIds.toSet()
        Db.query {
            Matches.update({ Matches.id eq lobby.id }) { it[Matches.status] = "COMPLETE" }
            for (p in participants) {
                MatchParticipants.insert {
                    it[MatchParticipants.matchId] = lobby.id
                    it[MatchParticipants.playerId] = p.playerId
                    it[MatchParticipants.team] = p.team
                    it[MatchParticipants.topConfigJson] = json.encodeToString(p.topConfig)
                    it[MatchParticipants.won] = p.playerId in winners
                }
            }
            MatchResults.insert {
                it[MatchResults.matchId] = lobby.id
                it[MatchResults.resultJson] = json.encodeToString(result)
                it[MatchResults.completedAt] = System.currentTimeMillis()
            }
        }
    }

    private suspend fun broadcast(lobby: MatchLobby, event: MatchEvent) {
        val text = json.encodeToString(event)
        val sockets = synchronized(lobby.sockets) { lobby.sockets.toList() }
        for (socket in sockets) {
            runCatching { socket.send(Frame.Text(text)) }
        }
    }
}
