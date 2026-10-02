plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.memoweft.weftmate.mobile"
    compileSdk = 35
    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = "com.memoweft.weftmate.mobile.debug"
        minSdk = 26
        targetSdk = 35
        versionCode = 9
        versionName = "0.4.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("main").assets.srcDir(project.file("../../mobile-ui/www"))
}

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
