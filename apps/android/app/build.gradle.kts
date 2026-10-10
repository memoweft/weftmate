plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val updateChannel = providers.gradleProperty("weftmateUpdateChannel").orElse("stable").get()
require(updateChannel in listOf("stable", "preview"))

android {
    namespace = "com.memoweft.weftmate.mobile"
    compileSdk = 35
    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = providers.gradleProperty("weftmateApplicationId")
            .orElse("com.memoweft.weftmate.mobile.debug").get()
        minSdk = 26
        targetSdk = 35
        versionCode = 29
        versionName = "0.8.16"
        buildConfigField("String", "UPDATE_CHANNEL", "\"$updateChannel\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes { release { isMinifyEnabled = false } }
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
    implementation("androidx.work:work-runtime:2.9.1")
    testImplementation("org.json:json:20240303")
    implementation("org.bouncycastle:bcprov-jdk15to18:1.86")
    implementation("androidx.webkit:webkit:1.16.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
