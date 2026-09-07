plugins {
    id("com.android.application")
}

android {
    namespace = "com.antisdream.nunsum"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.antisdream.nunsum"
        minSdk = 26
        targetSdk = 36
        versionCode = 19
        versionName = "0.019-test"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}
