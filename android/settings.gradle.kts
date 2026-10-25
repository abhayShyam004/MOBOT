pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "mobot-android"
include(":core")
include(":app")
// The canonical-memory signing authority: a second application package so the
// HMAC key lives in a UID the app's own processes cannot reach.
include(":signer")
