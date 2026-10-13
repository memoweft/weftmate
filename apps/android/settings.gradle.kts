pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    resolutionStrategy.eachPlugin {
        if (requested.id.id == "org.jetbrains.kotlin.plugin.compose")
            useModule("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.0.21")
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "WeftMateMobile"
include(":app")
