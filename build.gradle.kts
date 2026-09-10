// kotlin.android IS declared here even though only :app uses it - it's the
// same underlying kotlin-gradle-plugin artifact as kotlin.jvm (used by
// :core/:server). If the root only applied kotlin.jvm and :app separately
// requested kotlin.android, Gradle would find that plugin's classes already
// loaded on the classpath from a different declaration and refuse to
// resolve it ("already on the classpath with an unknown version").
// Declaring every Kotlin plugin flavor once here, at the same version,
// avoids that conflict.
//
// kotlin.compose (the Compose compiler Gradle plugin, Kotlin 2.0+) is
// declared here too, apply false, for the same reason - :app is the only
// module that applies it for real.
//
// android.application is declared here too (apply false), not only in
// :app, for the same classloader reason as kotlin.android above: when a
// plugin is declared with its own explicit version only inside a
// subproject's plugins{} block, Gradle can resolve/load it into a
// classloader scope separate from plugins declared at the root. That
// breaks kotlin.android's reactive `dynamicallyApplyWhenAndroidPluginIsApplied`
// mechanism, which does reflection-based lookups against AGP's classes
// (e.g. com.android.build.gradle.api.BaseVariant) as soon as AGP applies -
// causing a NoClassDefFoundError there even though AGP resolved fine on
// its own. Declaring it centrally, apply false, keeps it in the same
// classloader scope as every other plugin here.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ktor) apply false
    alias(libs.plugins.android.application) apply false
}
