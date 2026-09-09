package tops.physics

import kotlinx.serialization.Serializable
import kotlin.math.sqrt

/**
 * Plain 2D vector for the top-down arena plane. No engine dependency on
 * purpose: this type is shared verbatim between the Android client and the
 * JVM server so both run the exact same simulation code.
 */
@Serializable
data class Vector2(val x: Double, val y: Double) {
    operator fun plus(o: Vector2) = Vector2(x + o.x, y + o.y)
    operator fun minus(o: Vector2) = Vector2(x - o.x, y - o.y)
    operator fun times(s: Double) = Vector2(x * s, y * s)
    operator fun unaryMinus() = Vector2(-x, -y)

    fun dot(o: Vector2): Double = x * o.x + y * o.y
    fun length(): Double = sqrt(x * x + y * y)
    fun lengthSquared(): Double = x * x + y * y

    fun normalizedOrZero(): Vector2 {
        val len = length()
        return if (len < 1e-9) ZERO else Vector2(x / len, y / len)
    }

    /** 90-degree rotation, used to get the tangent direction from a normal. */
    fun perp(): Vector2 = Vector2(-y, x)

    companion object {
        val ZERO = Vector2(0.0, 0.0)
    }
}
