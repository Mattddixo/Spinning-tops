package tops.server.routes

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import tops.protocol.ErrorResponse
import tops.protocol.RegisterRequest
import tops.protocol.RegisterResponse
import tops.server.auth.Auth

fun Route.playerRoutes() {
    post("/players/register") {
        val request = call.receive<RegisterRequest>()
        val registered = runCatching { Auth.register(request.displayName) }
            .getOrElse {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse(it.message ?: "invalid displayName"))
                return@post
            }
        call.respond(
            RegisterResponse(
                playerId = registered.playerId,
                secretToken = registered.secretToken,
                displayName = registered.displayName,
            ),
        )
    }
}
