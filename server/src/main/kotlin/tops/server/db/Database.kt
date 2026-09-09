package tops.server.db

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SchemaUtils
import org.jetbrains.exposed.sql.transactions.transaction

/**
 * Reads connection settings from the environment so docker-compose can point this at
 * Postgres in production while local dev with no env vars set falls back to a plain
 * file-backed H2 database - no separate config file to keep in sync.
 */
object Db {
    fun connect() {
        val url = System.getenv("DB_URL") ?: "jdbc:h2:file:./data/tops;AUTO_SERVER=TRUE"
        val driver = System.getenv("DB_DRIVER") ?: "org.h2.Driver"
        val user = System.getenv("DB_USER") ?: "sa"
        val password = System.getenv("DB_PASSWORD") ?: ""
        Database.connect(url = url, driver = driver, user = user, password = password)
        transaction {
            SchemaUtils.create(Players, Matches, MatchParticipants, MatchResults)
        }
    }

    suspend fun <T> query(block: () -> T): T = withContext(Dispatchers.IO) { transaction { block() } }
}
