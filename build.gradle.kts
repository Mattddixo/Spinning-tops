// Note: the Android Gradle Plugin (com.android.application) is applied directly
// in app/build.gradle.kts rather than here, so that resolving it (it lives on
// Google's Maven repo) can never block configuring :core or :server, which
// don't need it.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ktor) apply false
}
