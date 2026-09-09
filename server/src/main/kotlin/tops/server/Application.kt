package tops.server

import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.callloging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.Json
import tops.protocol.ErrorResponse
import tops.server.db.Db
import tops.server.routes.leaderboardRoutes
import tops.server.routes.matchRoutes
import tops.server.routes.playerRoutes
import java.time.Duration

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8081
    embeddedServer(Netty, port = port, module = Application::module).start(wait = true)
}

fun Application.module() {
    Db.connect()

    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true; encodeDefaults = true })
    }
    install(WebSockets) {
        pingPeriod = Duration.ofSeconds(15)
        timeout = Duration.ofSeconds(30)
    }
    install(CallLogging)
    install(CORS) {
        anyHost() // friends-only, Tailscale-gated homelab server - see README for the threat model
        allowHeader("X-Player-Id")
        allowHeader("X-Player-Token")
        allowHeader("Content-Type")
    }
    install(StatusPages) {
        exception<Throwable> { call, cause ->
            call.respond(HttpStatusCode.InternalServerError, ErrorResponse(cause.message ?: "internal error"))
        }
    }

    routing {
        get("/health") { call.respondText("ok") }
        playerRoutes()
        matchRoutes()
        leaderboardRoutes()
    }
}
