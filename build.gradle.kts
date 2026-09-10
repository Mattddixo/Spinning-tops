// Note: the Android Gradle Plugin (com.android.application) is applied directly
// in app/build.gradle.kts rather than here, so that resolving it (it lives on
// Google's Maven repo) can never block configuring :core or :server, which
// don't need it.
//
// AGP 9's "built-in Kotlin support" is disabled (android.builtInKotlin=false
// in gradle.properties - see that file for why: it's broken in AGP 9.4.0),
// so org.jetbrains.kotlin.android is back to being applied explicitly, the
// same as kotlin.compose and kotlin.serialization. All of these are declared
// here (apply false) even though only :app uses kotlin.android/kotlin.compose
// - they're different faces of the same underlying kotlin-gradle-plugin
// artifact as kotlin.jvm (used by :core/:server). If the root only applied
// kotlin.jvm and a subproject separately requested kotlin.android, Gradle
// would find that plugin's classes already loaded on the classpath from a
// different declaration and refuse to resolve it ("already on the classpath
// with an unknown version"). Declaring every flavor once here, at the same
// version, avoids that conflict for every subproject.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.shadow) apply false
}
