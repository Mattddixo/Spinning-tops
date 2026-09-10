plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.shadow)
    application
}

application {
    mainClass.set("tops.server.ApplicationKt")
}

kotlin {
    jvmToolchain(21)
}

// Fat-jar packaging via the Shadow plugin directly (Gradle-9-compatible), rather than
// io.ktor.plugin's bundled fatJar wrapper, which still ships an old Shadow version that
// uses a Gradle API removed in Gradle 9. The Dockerfile builds this as :server:shadowJar.
tasks.shadowJar {
    archiveFileName.set("server.jar")
}

dependencies {
    implementation(project(":core"))

    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.websockets)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.server.call.logging)
    implementation(libs.ktor.serialization.kotlinx.json)

    implementation(libs.exposed.core)
    implementation(libs.exposed.dao)
    implementation(libs.exposed.jdbc)
    implementation(libs.exposed.java.time)
    implementation(libs.postgres.driver)
    implementation(libs.h2.driver)
    implementation(libs.logback.classic)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.ktor.server.test.host)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}
