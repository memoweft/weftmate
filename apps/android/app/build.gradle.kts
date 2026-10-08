plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.memoweft.weftmate.mobile"
    compileSdk = 35
    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = providers.gradleProperty("weftmateApplicationId")
            .orElse("com.memoweft.weftmate.mobile.debug").get()
        minSdk = 26
        targetSdk = 35
        versionCode = 20
        versionName = "0.8.7"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("main").assets.srcDir(project.file("../../mobile-ui/www"))
}

val checkMobileUiAssets by tasks.registering(Exec::class) {
    workingDir(project.file("../../mobile-ui"))
    commandLine("node", "src/check.mjs")
}
tasks.named("preBuild") { dependsOn(checkMobileUiAssets) }

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
