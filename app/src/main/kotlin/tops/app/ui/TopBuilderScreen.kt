package tops.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import tops.physics.TopConfig

/**
 * Every "part" here is one physical field on [TopConfig] - a slider IS the part. There's
 * no separate catalog of named parts mapping to hidden stat blocks: what you drag is what
 * the simulation reads, so two tops with the same numbers always play identically.
 */
@Composable
fun TopBuilderScreen(topConfig: TopConfig, onChange: (TopConfig) -> Unit, onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Build your top")

        LabeledSlider(
            label = "Weight",
            valueText = "${(topConfig.massKg * 1000).toInt()} g",
            value = topConfig.massKg,
            range = 0.015f..0.060f,
            onChange = { onChange(topConfig.copy(massKg = it.toDouble())) },
            help = "Heavier hits harder and resists knockback, but is slower to redirect.",
        )

        LabeledSlider(
            label = "Size (radius)",
            valueText = "${(topConfig.radiusM * 1000).toInt()} mm",
            value = topConfig.radiusM,
            range = 0.012f..0.028f,
            onChange = {
                val radius = it.toDouble()
                val clampedOffset = topConfig.comOffsetM.coerceAtMost(radius * 0.9)
                onChange(topConfig.copy(radiusM = radius, comOffsetM = clampedOffset))
            },
            help = "Bigger means a wider hitbox - easier to land hits, easier to be hit.",
        )

        LabeledSlider(
            label = "Weight distribution",
            valueText = if (topConfig.inertiaRatio > 0.8) "Rim-heavy" else if (topConfig.inertiaRatio < 0.6) "Core-heavy" else "Balanced",
            value = topConfig.inertiaRatio,
            range = 0.5f..1.0f,
            onChange = { onChange(topConfig.copy(inertiaRatio = it.toDouble())) },
            help = "Rim-heavy spins down slower and hits harder, but is sluggish after impacts.",
        )

        LabeledSlider(
            label = "Balance",
            valueText = if (topConfig.comOffsetM < topConfig.radiusM * 0.05) "Balanced" else "Imbalanced",
            value = topConfig.comOffsetM,
            range = 0f..(topConfig.radiusM * 0.9).toFloat(),
            onChange = { onChange(topConfig.copy(comOffsetM = it.toDouble())) },
            help = "An off-center mass topples earlier as spin runs down - a real cost, not free variety.",
        )

        LabeledSlider(
            label = "Tip friction",
            valueText = if (topConfig.tipFriction < 0.02) "Sharp" else if (topConfig.tipFriction > 0.05) "Flat" else "Medium",
            value = topConfig.tipFriction,
            range = 0.005f..0.08f,
            onChange = { onChange(topConfig.copy(tipFriction = it.toDouble())) },
            help = "Sharp spins far longer but tips over sooner; flat spins down fast but stands firm. Also grinds harder on contact.",
        )

        LabeledSlider(
            label = "Grip",
            valueText = "${(topConfig.lateralGrip * 100).toInt()}%",
            value = topConfig.lateralGrip,
            range = 0f..1f,
            onChange = { onChange(topConfig.copy(lateralGrip = it.toDouble())) },
            help = "High grip stays near its drop point (defense); low grip drifts and roams (attack).",
        )

        LabeledSlider(
            label = "Frame hardness",
            valueText = "${(topConfig.restitution * 100).toInt()}%",
            value = topConfig.restitution,
            range = 0f..1f,
            onChange = { onChange(topConfig.copy(restitution = it.toDouble())) },
            help = "Harder frames bounce more energy back into a collision instead of absorbing it.",
        )

        Text("Moment of inertia: %.6f kg*m^2".format(topConfig.momentOfInertia))

        Button(onClick = onBack) { Text("Done") }
    }
}

@Composable
private fun LabeledSlider(
    label: String,
    valueText: String,
    value: Double,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit,
    help: String,
) {
    Text("$label: $valueText")
    Slider(value = value.toFloat(), valueRange = range, onValueChange = onChange)
    Text(help)
}
