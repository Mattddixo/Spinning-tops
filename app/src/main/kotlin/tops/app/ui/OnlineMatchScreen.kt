package tops.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.sin
import tops.app.data.ServerClient
import tops.physics.ArenaConfig
import tops.physics.LaunchInput
import tops.physics.MatchResult
import tops.physics.TopConfig
import tops.physics.Vector2
import tops.protocol.MatchLobbyView
import tops.protocol.MatchMode
import tops.protocol.MatchStatus

/**
 * Friends-only matchmaking, on purpose the simplest thing that works: whoever hosts
 * shares the match id (read it out, paste it in chat) and everyone else joins with it.
 * No public lobby list, no invite links - that's appropriate for a homelab server with
 * no accounts.
 */
@Composable
fun OnlineMatchScreen(client: ServerClient, topConfig: TopConfig, onBack: () -> Unit) {
    var matchId by remember { mutableStateOf<String?>(null) }
    var joinCode by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf(MatchMode.ONE_V_ONE) }
    var arenas by remember { mutableStateOf(listOf<ArenaConfig>()) }
    var arenaId by remember { mutableStateOf<String?>(null) }
    var lobby by remember { mutableStateOf<MatchLobbyView?>(null) }
    var result by remember { mutableStateOf<MatchResult?>(null) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var hasLaunched by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { client.arenas() }
            .onSuccess { arenas = it; if (arenaId == null) arenaId = it.firstOrNull()?.id }
            .onFailure { errorText = it.message }
    }

    // Poll the lobby/match status while we're in one - simple and robust for a small
    // friends server; a push-based version can use ServerClient.matchSocket instead.
    LaunchedEffect(matchId) {
        val id = matchId ?: return@LaunchedEffect
        while (result == null) {
            runCatching { client.getMatch(id) }.onSuccess { lobby = it }
            if (lobby?.status == MatchStatus.COMPLETE) {
                runCatching { client.getResult(id) }.onSuccess { r -> if (r != null) result = r }
            }
            delay(1000)
        }
    }

    val currentResult = result
    if (currentResult != null) {
        ReplayScreen(
            arena = arenas.firstOrNull { it.id == lobby?.arenaId } ?: ArenaConfig.classic(),
            result = currentResult,
            onBack = onBack,
        )
        return
    }

    val currentMatchId = matchId
    val currentLobby = lobby
    if (currentMatchId == null || currentLobby == null) {
        Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Host a match")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MatchMode.values().forEach { m ->
                    Button(onClick = { mode = m }) { Text(if (mode == m) "[${m.name}]" else m.name) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                arenas.forEach { a ->
                    Button(onClick = { arenaId = a.id }) { Text(if (arenaId == a.id) "[${a.name}]" else a.name) }
                }
            }
            Button(onClick = {
                val chosenArena = arenaId ?: return@Button
                scope.launch {
                    runCatching { client.createMatch(mode, chosenArena, topConfig) }
                        .onSuccess { matchId = it }
                        .onFailure { errorText = it.message }
                }
            }) { Text("Create match") }

            Text("- or join one -")
            OutlinedTextField(value = joinCode, onValueChange = { joinCode = it }, label = { Text("Match code") })
            Button(onClick = {
                val code = joinCode.trim()
                if (code.isEmpty()) return@Button
                scope.launch {
                    runCatching { client.joinMatch(code, topConfig) }
                        .onSuccess { matchId = code; lobby = it }
                        .onFailure { errorText = it.message }
                }
            }) { Text("Join match") }

            if (errorText != null) Text("Error: $errorText")
            Button(onClick = onBack) { Text("Back") }
        }
        return
    }

    // In a lobby: show who's in, share the code, and let this player launch once.
    val arena = arenas.firstOrNull { it.id == currentLobby.arenaId } ?: ArenaConfig.classic()
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Match code: $currentMatchId")
        Text("Players: " + currentLobby.participants.joinToString { "${it.displayName}${if (it.ready) " (ready)" else ""}" })

        if (hasLaunched) {
            Text("Launched - waiting on other players...")
        } else {
            LaunchControls(
                arena = arena,
                topConfig = topConfig,
                onLaunch = { launch ->
                    hasLaunched = true
                    scope.launch {
                        runCatching { client.submitLaunch(currentMatchId, launch) }
                            .onFailure { errorText = it.message; hasLaunched = false }
                    }
                },
            )
        }
        if (errorText != null) Text("Error: $errorText")
        Button(onClick = onBack) { Text("Back") }
    }
}

/** The same tap-to-drop, hold-to-charge control from practice mode, but it emits a [LaunchInput] instead of running a local simulation. */
@Composable
private fun ColumnScope.LaunchControls(arena: ArenaConfig, topConfig: TopConfig, onLaunch: (LaunchInput) -> Unit) {
    var projection by remember { mutableStateOf<ArenaProjection?>(null) }
    var dropPoint by remember { mutableStateOf<Vector2?>(null) }
    var power by remember { mutableStateOf(0f) }
    val scope = rememberCoroutineScope()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .weight(1f)
            .pointerInput(Unit) {
                detectTapGestures { offset -> projection?.let { dropPoint = it.toMeters(offset) } }
            },
    ) {
        ArenaCanvas(
            arena = arena,
            tops = emptyList(),
            modifier = Modifier.fillMaxSize(),
            dropPointPreview = dropPoint,
            onProjectionReady = { projection = it },
        )
    }

    val point = dropPoint
    if (point != null) {
        Text("Power: ${(power * 100).toInt()}%")
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
                .background(Color(0xFF3949AB))
                .padding(16.dp)
                .pointerInput(point) {
                    detectTapGestures(
                        onPress = {
                            var charging = true
                            var t = 0f
                            val job = scope.launch {
                                while (charging) {
                                    t += 0.05f
                                    power = ((sin(t * 3.2f) + 1f) / 2f)
                                    delay(16)
                                }
                            }
                            tryAwaitRelease()
                            charging = false
                            job.cancel()
                            onLaunch(
                                LaunchInput(
                                    topId = topConfig.id,
                                    dropPoint = point,
                                    launchPower = power.coerceIn(0.05f, 1f).toDouble(),
                                    clockwise = true,
                                ),
                            )
                        },
                    )
                },
        ) {
            Text("Hold to launch", color = Color.White)
        }
    }
}

@Composable
private fun ReplayScreen(arena: ArenaConfig, result: MatchResult, onBack: () -> Unit) {
    var frameIndex by remember { mutableStateOf(0) }

    LaunchedEffect(result) {
        frameIndex = 0
        while (frameIndex < result.frames.lastIndex) {
            delay(33) // the server records ~30 frames/sec
            frameIndex++
        }
    }

    val frame = result.frames.getOrNull(frameIndex) ?: result.frames.last()
    val renderTops = frame.tops.map {
        RenderTop(id = it.topId, x = it.x, y = it.y, radiusM = 0.02, phase = it.phase, active = it.active)
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(if (frameIndex >= result.frames.lastIndex) "Match over. Survivors: ${result.survivorTopIds}" else "Replaying...")
        ArenaCanvas(arena = arena, tops = renderTops, modifier = Modifier.fillMaxSize().weight(1f))
        Button(onClick = onBack) { Text("Back") }
    }
}
