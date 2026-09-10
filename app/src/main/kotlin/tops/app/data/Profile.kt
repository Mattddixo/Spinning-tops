package tops.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "profile")

data class PlayerProfile(val playerId: String, val secretToken: String, val displayName: String)

/**
 * The entire "account system": a display name typed once, registered with the server, and
 * the resulting id/secret cached on-device. No email, no password, nothing to log back
 * into - if you clear app data you just register again as a new player.
 */
class ProfileStore(private val context: Context) {
    private object Keys {
        val PLAYER_ID = stringPreferencesKey("player_id")
        val SECRET_TOKEN = stringPreferencesKey("secret_token")
        val DISPLAY_NAME = stringPreferencesKey("display_name")
        val SERVER_BASE_URL = stringPreferencesKey("server_base_url")
    }

    val profile: Flow<PlayerProfile?> = context.dataStore.data.map { prefs ->
        val id = prefs[Keys.PLAYER_ID]
        val token = prefs[Keys.SECRET_TOKEN]
        val name = prefs[Keys.DISPLAY_NAME]
        if (id != null && token != null && name != null) PlayerProfile(id, token, name) else null
    }

    val serverBaseUrl: Flow<String?> = context.dataStore.data.map { it[Keys.SERVER_BASE_URL] }

    suspend fun currentProfile(): PlayerProfile? = profile.first()
    suspend fun currentServerBaseUrl(): String? = serverBaseUrl.first()

    suspend fun save(profile: PlayerProfile) {
        context.dataStore.edit { prefs ->
            prefs[Keys.PLAYER_ID] = profile.playerId
            prefs[Keys.SECRET_TOKEN] = profile.secretToken
            prefs[Keys.DISPLAY_NAME] = profile.displayName
        }
    }

    suspend fun saveServerBaseUrl(url: String) {
        context.dataStore.edit { prefs -> prefs[Keys.SERVER_BASE_URL] = url.trimEnd('/') }
    }
}
