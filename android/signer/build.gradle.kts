// The canonical-memory signing authority, in its own Android application
// package so it gets its own Linux UID.
//
// Android binds Keystore keys to the UID that created them. While the HMAC key
// lived in the main app's UID, every process of that app — the harness, the
// Node host, and the bot's own PTY shell — shared one Keystore namespace, so a
// same-UID process could ask for a MAC directly. Key confidentiality is a
// UID property; this package is how it becomes one.
//
// What this package is NOT: a service that signs whatever arrives. The caller
// authorization is the hard half of the problem and lives in
// [com.openmausbot.companion.signer.MemorySignerService], where the pinned
// caller pid is established at the trusted bind (see that file's comment).
//
// No sharedUserId anywhere: that would put the signer back in the caller's UID
// and undo the only boundary this package exists to create.

plugins {
    // AGP 9 carries Kotlin support for Android modules; a separate
    // kotlin-android plugin is rejected.
    id("com.android.application")
}

android {
    namespace = "com.openmausbot.companion.signer"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.openmausbot.companion.signer"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        create("preview") {
            initWith(getByName("debug"))
            matchingFallbacks += "debug"
            // Same local debug key as the preview app: a signature-level
            // permission only crosses packages that share a signing
            // certificate, and these two are built together for device work.
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            // The signer must be signed with the same certificate as the app
            // that binds it, or the signature permission is never granted.
            // Without keystore material this stays unsigned, exactly like the
            // app's release build.
            signingConfig = null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        aidl = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation(kotlin("test"))
    // The authorization state machine is plain Kotlin, so the caller-race
    // matrix runs as a JVM unit test on every build.
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.2.21")
    testImplementation("junit:junit:4.13.2")
}
