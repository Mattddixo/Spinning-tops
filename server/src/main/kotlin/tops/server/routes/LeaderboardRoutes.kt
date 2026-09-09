package tops.server.routes

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import tops.protocol.ErrorResponse
import tops.protocol.MatchMode
import tops.server.leaderboard.Leaderboard

fun Route.leaderboardRoutes() {
    get("/leaderboard") {
        val modeParam = call.request.queryParameters["mode"]
        val mode = if (modeParam == null) {
            null
        } else {
            runCatching { MatchMode.valueOf(modeParam) }.getOrElse {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("unknown mode: $modeParam"))
                return@get
            }
        }
        call.respond(Leaderboard.query(mode))
    }
}
