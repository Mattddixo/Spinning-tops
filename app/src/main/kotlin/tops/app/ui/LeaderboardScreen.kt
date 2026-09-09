package tops.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import tops.app.data.ServerClient
import tops.protocol.LeaderboardEntry

@Composable
fun LeaderboardScreen(client: ServerClient, onBack: () -> Unit) {
    var entries by remember { mutableStateOf(listOf<LeaderboardEntry>()) }
    var errorText by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { client.leaderboard() }
            .onSuccess { entries = it }
            .onFailure { errorText = it.message }
    }

    Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Leaderboard")
        if (errorText != null) Text("Error: $errorText")
        LazyColumn(modifier = Modifier.fillMaxSize().weight(1f, fill = false)) {
            items(entries) { entry ->
                Text("${entry.displayName}: ${entry.wins} wins / ${entry.matches} matches")
            }
        }
        Button(onClick = onBack) { Text("Back") }
    }
}
