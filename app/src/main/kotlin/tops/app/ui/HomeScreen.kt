package tops.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import tops.app.Screen

@Composable
fun HomeScreen(displayName: String, onNavigate: (Screen) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Hey, $displayName")
        Button(onClick = { onNavigate(Screen.TopBuilder) }) { Text("Build my top") }
        Button(onClick = { onNavigate(Screen.Practice) }) { Text("Practice (offline)") }
        Button(onClick = { onNavigate(Screen.Online) }) { Text("Battle (online)") }
        Button(onClick = { onNavigate(Screen.Leaderboard) }) { Text("Leaderboard") }
    }
}
