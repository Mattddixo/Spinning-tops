package tops.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import tops.physics.ArenaConfig
import tops.physics.Simulation
import tops.physics.TopConfig
import tops.physics.TopState
import tops.physics.Vector2

/**
 * Offline solo mode: runs the exact same [Simulation] the server runs, right on-device,
 * to prove the physics is one shared system rather than something re-implemented per
 * platform. No network needed here at all.
 */
@Composable
fun PracticeScreen(topConfig: TopConfig, onBack: () -> Unit) {
    val arena = remember { ArenaConfig.classic() }
    val scope = rememberCoroutineScope()

    var projection by remember { mutableStateOf<ArenaProjection?>(null) }
    var dropPoint by remember { mutableStateOf<Vector2?>(null) }
    var power by remember { mutableStateOf(0f) }
    var running by remember { mutableStateOf(false) }
    var renderTops by remember { mutableStateOf(listOf<RenderTop>()) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Tap the arena to choose where it lands, then press and hold Launch.")

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .pointerInput(running) {
                    if (!running) {
                        detectTapGestures { offset ->
                            projection?.let { dropPoint = it.toMeters(offset) }
                        }
                    }
                },
        ) {
            ArenaCanvas(
                arena = arena,
                tops = renderTops,
                modifier = Modifier.fillMaxSize(),
                dropPointPreview = if (!running) dropPoint else null,
                onProjectionReady = { projection = it },
            )
        }

        if (running) {
            Text("Spinning...")
        } else if (dropPoint != null) {
            Text("Power: ${(power * 100).toInt()}%")
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
                    .background(Color(0xFF3949AB))
                    .padding(16.dp)
                    .pointerInput(dropPoint) {
                        detectTapGestures(
                            onPress = {
                                var charging = true
                                var t = 0f
                                val chargeJob = scope.launch {
                                    while (charging) {
                                        t += 0.05f
                                        power = ((sin(t * 3.2f) + 1f) / 2f)
                                        delay(16)
                                    }
                                }
                                tryAwaitRelease()
                                charging = false
                                chargeJob.cancel()
                                launchTop(scope, arena, topConfig, dropPoint!!, power) { tops, isRunning ->
                                    renderTops = tops
                                    running = isRunning
                                }
                            },
                        )
                    },
            ) {
                Text("Hold to launch", color = Color.White)
            }
        }

        Button(onClick = onBack, enabled = !running) { Text("Back") }
    }
}

private fun launchTop(
    scope: kotlinx.coroutines.CoroutineScope,
    arena: ArenaConfig,
    topConfig: TopConfig,
    dropPoint: Vector2,
    power: Float,
    onFrame: (List<RenderTop>, Boolean) -> Unit,
) {
    val state = TopState(
        config = topConfig,
        position = dropPoint,
        spinRate = power.coerceIn(0.05f, 1f) * Simulation.MAX_LAUNCH_SPIN_RAD_S,
    )
    val simulation = Simulation(arena, listOf(state))
    onFrame(simulation.tops.map { it.toRenderTop() }, true)
    scope.launch {
        var ticks = 0
        while (simulation.activeTops().isNotEmpty() && ticks < 3600) {
            repeat(2) { simulation.step(Simulation.FIXED_DT) }
            ticks += 2
            onFrame(simulation.tops.map { it.toRenderTop() }, true)
            delay(16)
        }
        onFrame(simulation.tops.map { it.toRenderTop() }, false)
    }
}

private fun TopState.toRenderTop() = RenderTop(
    id = config.id,
    x = position.x,
    y = position.y,
    radiusM = config.radiusM,
    phase = phase,
    active = active,
)
