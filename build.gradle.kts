// Note: the Android Gradle Plugin (com.android.application) is applied directly
// in app/build.gradle.kts rather than here, so that resolving it (it lives on
// Google's Maven repo) can never block configuring :core or :server, which
// don't need it.
//
// The Kotlin plugins ARE all declared here, though (including kotlin.android
// and kotlin.compose, which only :app uses) - kotlin.jvm, kotlin.android and
// kotlin.multiplatform are all different faces of the same underlying
// kotlin-gradle-plugin artifact. If the root only applies kotlin.jvm and a
// subproject separately requests kotlin.android, Gradle finds that plugin's
// classes already loaded on the classpath from a different declaration and
// refuses to resolve it ("already on the classpath with an unknown version").
// Declaring every Kotlin plugin flavor once here, at the same version, avoids
// that conflict for every subproject.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.shadow) apply false
}
