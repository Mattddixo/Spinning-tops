// Note: the Android Gradle Plugin (com.android.application) is applied directly
// in app/build.gradle.kts rather than here, so that resolving it (it lives on
// Google's Maven repo) can never block configuring :core or :server, which
// don't need it.
//
// kotlin.android IS declared here even though only :app uses it - it's the
// same underlying kotlin-gradle-plugin artifact as kotlin.jvm (used by
// :core/:server). If the root only applied kotlin.jvm and :app separately
// requested kotlin.android, Gradle would find that plugin's classes already
// loaded on the classpath from a different declaration and refuse to
// resolve it ("already on the classpath with an unknown version").
// Declaring every Kotlin plugin flavor once here, at the same version,
// avoids that conflict.
//
// On Kotlin 1.9.x (pre-K2) there's no org.jetbrains.kotlin.plugin.compose
// Gradle plugin - Compose is wired up via composeOptions{} in :app instead
// (see app/build.gradle.kts), so it isn't declared here.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ktor) apply false
}
