// NOTE: com.android.application lives on Google's Maven repo, which this
// dev sandbox cannot reach (see README "What wasn't verified in-sandbox").
// This file is the only one that carries that dependency - building :core
// or :server never needs to touch it.
//
// No org.jetbrains.kotlin.android plugin here: AGP 9.0+ has "built-in Kotlin
// support" enabled by default, which replaces what that plugin used to do.
// Applying both crashes AGP's own Kotlin wiring (it tries to create a
// KotlinAndroidTarget that references an old Variant API class AGP already
// removed). kotlin.compose stays - it's a separate plugin (the Compose
// compiler) and built-in Kotlin support doesn't cover it.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "tops.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "tops.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // No kotlinOptions {} block: that DSL extension came from the
    // org.jetbrains.kotlin.android plugin, which is no longer applied (see
    // the plugins {} block above). Built-in Kotlin support derives jvmTarget
    // from compileOptions.targetCompatibility above automatically.

    packaging {
        resources.excludes.add("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    implementation(project(":core"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.foundation)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.cio)
    implementation(libs.ktor.client.websockets)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
}
