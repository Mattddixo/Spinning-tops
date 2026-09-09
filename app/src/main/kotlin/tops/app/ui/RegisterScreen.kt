package tops.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The entire "sign-up flow": a name and the homelab server's Tailscale address, both
 * typed once. No email, no password - see ProfileStore/Auth for why that's an
 * acceptable tradeoff for a friends-only, Tailscale-gated server.
 */
@Composable
fun RegisterScreen(errorMessage: String?, onSubmit: (displayName: String, serverAddress: String) -> Unit) {
    var displayName by remember { mutableStateOf("") }
    var serverAddress by remember { mutableStateOf("http://100.") }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Spinning Tops")
        Text("Pick a name and point this at your homelab server's Tailscale address.")
        OutlinedTextField(
            value = displayName,
            onValueChange = { displayName = it },
            label = { Text("Display name") },
        )
        OutlinedTextField(
            value = serverAddress,
            onValueChange = { serverAddress = it },
            label = { Text("Server address (e.g. http://100.x.y.z:8081)") },
        )
        if (errorMessage != null) {
            Text("Couldn't register: $errorMessage")
        }
        Button(
            onClick = { onSubmit(displayName.trim(), serverAddress.trim()) },
            enabled = displayName.isNotBlank() && serverAddress.isNotBlank(),
        ) {
            Text("Play")
        }
    }
}
