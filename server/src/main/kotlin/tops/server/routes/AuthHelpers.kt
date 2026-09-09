package tops.server.routes

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.respond
import tops.protocol.ErrorResponse
import tops.server.auth.Auth

/** Resolves the calling player, or writes a 401 and returns null for the caller to bail out on. */
suspend fun ApplicationCall.requirePlayerId(): String? {
    val playerId = Auth.authenticate(this)
    if (playerId == null) {
        respond(HttpStatusCode.Unauthorized, ErrorResponse("missing or invalid player credentials"))
    }
    return playerId
}
