package tops.server.routes

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import tops.protocol.ArenaListResponse
import tops.protocol.CreateMatchRequest
import tops.protocol.CreateMatchResponse
import tops.protocol.ErrorResponse
import tops.protocol.JoinMatchRequest
import tops.protocol.LaunchRequest
import tops.protocol.MatchLobbyView
import tops.protocol.ParticipantView
import tops.server.arena.Arenas
import tops.server.auth.Auth
import tops.server.match.LobbyOutcome
import tops.server.match.MatchEngine
import tops.server.match.MatchLobby

private fun MatchLobby.toView(): MatchLobbyView = MatchLobbyView(
    matchId = id,
    mode = mode,
    arenaId = arenaId,
    status = status,
    participants = participants.values.map {
        ParticipantView(
            playerId = it.playerId,
            displayName = it.displayName,
            team = it.team,
            ready = it.launch != null,
        )
    },
)

fun Route.matchRoutes() {
    get("/arenas") {
        call.respond(ArenaListResponse(Arenas.list()))
    }

    post("/matches") {
        val playerId = call.requirePlayerId() ?: return@post
        val request = call.receive<CreateMatchRequest>()
        val displayName = Auth.displayNameOf(playerId) ?: "Unknown"
        val lobby = runCatching {
            MatchEngine.createMatch(request.mode, request.arenaId, playerId, displayName, request.topConfig)
        }.getOrElse {
            call.respond(HttpStatusCode.BadRequest, ErrorResponse(it.message ?: "could not create match"))
            return@post
        }
        call.respond(CreateMatchResponse(lobby.id))
    }

    get("/matches/{id}") {
        val lobby = call.matchLobbyOrRespond404() ?: return@get
        call.respond(lobby.toView())
    }

    post("/matches/{id}/join") {
        val playerId = call.requirePlayerId() ?: return@post
        val lobby = call.matchLobbyOrRespond404() ?: return@post
        val request = call.receive<JoinMatchRequest>()
        val displayName = Auth.displayNameOf(playerId) ?: "Unknown"
        when (val outcome = MatchEngine.join(lobby, playerId, displayName, request.topConfig)) {
            is LobbyOutcome.Ok -> call.respond(lobby.toView())
            is LobbyOutcome.Error -> call.respond(HttpStatusCode.Conflict, ErrorResponse(outcome.message))
        }
    }

    post("/matches/{id}/launch") {
        val playerId = call.requirePlayerId() ?: return@post
        val lobby = call.matchLobbyOrRespond404() ?: return@post
        val request = call.receive<LaunchRequest>()
        when (val outcome = MatchEngine.submitLaunch(lobby, playerId, request)) {
            is LobbyOutcome.Ok -> call.respond(lobby.toView())
            is LobbyOutcome.Error -> call.respond(HttpStatusCode.Conflict, ErrorResponse(outcome.message))
        }
    }

    get("/matches/{id}/result") {
        val lobby = call.matchLobbyOrRespond404() ?: return@get
        val result = lobby.result
        if (result == null) {
            call.respond(HttpStatusCode.Accepted, ErrorResponse("match not complete yet"))
        } else {
            call.respond(result)
        }
    }

    webSocket("/matches/{id}/socket") {
        val playerId = Auth.authenticate(call)
        if (playerId == null) {
            close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "unauthenticated"))
            return@webSocket
        }
        val matchId = call.parameters["id"]
        val lobby = matchId?.let { MatchEngine.get(it) }
        if (lobby == null) {
            close(CloseReason(CloseReason.Codes.NOT_CONSISTENT, "unknown match"))
            return@webSocket
        }
        MatchEngine.addSocket(lobby, this)
        try {
            for (frame in incoming) {
                // Clients don't need to send anything; this just keeps the connection
                // open and lets us detect disconnects via the loop ending.
                if (frame is Frame.Close) break
            }
        } finally {
            MatchEngine.removeSocket(lobby, this)
        }
    }
}

private suspend fun io.ktor.server.application.ApplicationCall.matchLobbyOrRespond404(): MatchLobby? {
    val id = parameters["id"]
    val lobby = id?.let { MatchEngine.get(it) }
    if (lobby == null) {
        respond(HttpStatusCode.NotFound, ErrorResponse("unknown match id"))
    }
    return lobby
}
