package tops.server.auth

import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.select
import tops.server.db.Db
import tops.server.db.Players

/**
 * No accounts, no email, no passwords: a player registers a display name once and gets
 * back an unguessable secret token that must accompany every request made "as" them.
 * Only the SHA-256 hash of that token is ever stored, so a leaked database doesn't hand
 * out working credentials. This is deliberately lighter than a real auth system - it's
 * meant to stop one friend from impersonating another on the same Tailscale network,
 * not to resist a hostile public internet, which is exactly the threat model for a
 * self-hosted homelab server reachable only over Tailscale.
 */
object Auth {
    private val secureRandom = SecureRandom()

    data class Registered(val playerId: String, val secretToken: String, val displayName: String)

    suspend fun register(displayName: String): Registered {
        val trimmed = displayName.trim().take(64)
        require(trimmed.isNotEmpty()) { "displayName must not be blank" }
        val playerId = UUID.randomUUID().toString()
        val secret = generateSecret()
        Db.query {
            Players.insert {
                it[Players.id] = playerId
                it[Players.displayName] = trimmed
                it[Players.secretHash] = hash(secret)
                it[Players.createdAt] = System.currentTimeMillis()
            }
        }
        return Registered(playerId, secret, trimmed)
    }

    suspend fun displayNameOf(playerId: String): String? = Db.query {
        Players.select(Players.displayName)
            .where { Players.id eq playerId }
            .singleOrNull()
            ?.get(Players.displayName)
    }

    /** Returns the authenticated player id, or null if the headers are missing/invalid. */
    suspend fun authenticate(call: ApplicationCall): String? {
        val playerId = call.request.header(PLAYER_ID_HEADER) ?: return null
        val token = call.request.header(PLAYER_TOKEN_HEADER) ?: return null
        val storedHash = Db.query {
            Players.select(Players.secretHash)
                .where { Players.id eq playerId }
                .singleOrNull()
                ?.get(Players.secretHash)
        } ?: return null
        return if (constantTimeEquals(storedHash, hash(token))) playerId else null
    }

    private fun generateSecret(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun hash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun constantTimeEquals(a: String, b: String): Boolean = MessageDigest.isEqual(
        a.toByteArray(Charsets.UTF_8),
        b.toByteArray(Charsets.UTF_8),
    )

    const val PLAYER_ID_HEADER = "X-Player-Id"
    const val PLAYER_TOKEN_HEADER = "X-Player-Token"
}
