package tops.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import java.util.UUID
import tops.app.data.PlayerProfile
import tops.app.data.ProfileStore
import tops.app.data.ServerClient
import tops.app.ui.HomeScreen
import tops.app.ui.LeaderboardScreen
import tops.app.ui.OnlineMatchScreen
import tops.app.ui.PracticeScreen
import tops.app.ui.RegisterScreen
import tops.app.ui.TopBuilderScreen
import tops.physics.TopConfig

sealed class Screen {
    object Home : Screen()
    object TopBuilder : Screen()
    object Practice : Screen()
    object Online : Screen()
    object Leaderboard : Screen()
}

@Composable
fun AppRoot(profileStore: ProfileStore) {
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf<PlayerProfile?>(null) }
    var serverBaseUrl by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var topConfig by remember {
        mutableStateOf(TopConfig.default(id = UUID.randomUUID().toString(), name = "My Top"))
    }
    var registerError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        profile = profileStore.currentProfile()
        serverBaseUrl = profileStore.currentServerBaseUrl()
        loaded = true
    }

    if (!loaded) return

    val currentProfile = profile
    val currentBaseUrl = serverBaseUrl
    if (currentProfile == null || currentBaseUrl == null) {
        RegisterScreen(
            errorMessage = registerError,
            onSubmit = { displayName, serverAddress ->
                scope.launch {
                    registerError = null
                    runCatching {
                        val client = ServerClient(serverAddress, null)
                        val response = client.register(displayName)
                        client.close()
                        val newProfile = PlayerProfile(response.playerId, response.secretToken, response.displayName)
                        profileStore.save(newProfile)
                        profileStore.saveServerBaseUrl(serverAddress)
                        profile = newProfile
                        serverBaseUrl = serverAddress
                    }.onFailure {
                        registerError = it.message ?: "could not reach server"
                    }
                }
            },
        )
        return
    }

    val client = remember(currentBaseUrl, currentProfile) { ServerClient(currentBaseUrl, currentProfile) }

    when (screen) {
        Screen.Home -> HomeScreen(
            displayName = currentProfile.displayName,
            onNavigate = { screen = it },
        )
        Screen.TopBuilder -> TopBuilderScreen(
            topConfig = topConfig,
            onChange = { topConfig = it },
            onBack = { screen = Screen.Home },
        )
        Screen.Practice -> PracticeScreen(
            topConfig = topConfig,
            onBack = { screen = Screen.Home },
        )
        Screen.Online -> OnlineMatchScreen(
            client = client,
            topConfig = topConfig,
            onBack = { screen = Screen.Home },
        )
        Screen.Leaderboard -> LeaderboardScreen(
            client = client,
            onBack = { screen = Screen.Home },
        )
    }
}
