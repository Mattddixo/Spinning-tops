// NOTE: com.android.application lives on Google's Maven repo, which this
// dev sandbox cannot reach (see README "What wasn't verified in-sandbox").
// It's applied here directly, with an explicit version, precisely so that
// this file alone carries that dependency - building :core or :server
// never needs to touch it.
//
// Kotlin is pinned to 1.9.24 (pre-K2) here, not 2.0+, because there's no
// org.jetbrains.kotlin.plugin.compose Gradle plugin on 1.9.x - Compose is
// wired up the traditional way instead, via composeOptions{} below with a
// standalone Compose compiler artifact version.
plugins {
    id("com.android.application") version "8.5.2"
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "tops.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "tops.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

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
