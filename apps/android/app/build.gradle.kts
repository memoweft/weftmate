plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val updateChannel = providers.gradleProperty("weftmateUpdateChannel").orElse("stable").get()
require(updateChannel in listOf("stable", "preview"))
val qaProfile = providers.gradleProperty("weftmateQaProfile").orElse("false").get().toBooleanStrict()
require(!qaProfile || providers.gradleProperty("weftmateApplicationId").orNull in
    setOf("com.memoweft.weftmate.mobile.and4qa", "com.memoweft.weftmate.mobile.and12qa"))

android {
    namespace = "com.memoweft.weftmate.mobile"
    compileSdk = 35
    buildFeatures { buildConfig = true; compose = true }

    defaultConfig {
        applicationId = providers.gradleProperty("weftmateApplicationId")
            .orElse("com.memoweft.weftmate.mobile.debug").get()
        minSdk = 26
        targetSdk = 35
        versionCode = 54
        versionName = "0.8.41"
        buildConfigField("String", "UPDATE_CHANNEL", "\"$updateChannel\"")
        buildConfigField("boolean", "NATIVE_UI", providers.gradleProperty("weftmateNativeUi").orElse("true").get())
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release { isMinifyEnabled = false }
        debug {
            isDebuggable = !qaProfile
            // Keep the disposable package's existing loopback fixture hooks. This
            // property is rejected for every production application id above.
            if(qaProfile) buildConfigField("boolean", "DEBUG", "true")
        }
    }
    // Profiling is a disposable synthetic variant, not a release validation build.
    // Normal debug/release checks retain their existing lint configuration.
    lint { if(qaProfile) checkReleaseBuilds = false }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("main").assets.srcDir(project.file("../../mobile-ui/www"))
    sourceSets.getByName("main").assets.srcDir(project.file("src/updateAssets"))
}

val checkMobileUiAssets by tasks.registering(Exec::class) {
    workingDir(project.file("../../mobile-ui"))
    commandLine("node", "src/check.mjs")
}
tasks.named("preBuild") { dependsOn(checkMobileUiAssets) }

dependencies {
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui:1.7.6")
    implementation("androidx.compose.foundation:foundation:1.7.6")
    implementation("androidx.compose.material3:material3:1.3.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4:1.7.6")
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.7.6")
    implementation("androidx.work:work-runtime:2.9.1")
    testImplementation("org.json:json:20240303")
    implementation("org.bouncycastle:bcprov-jdk15to18:1.86")
    implementation("androidx.webkit:webkit:1.16.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
