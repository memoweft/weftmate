package com.memoweft.weftmate.mobile

/** Same shipped web shell; only app-local logical width differs for comparison evidence. */
class And5LegacyActivity:HybridActivity(){
    override fun attachBaseContext(base:android.content.Context){
        if(base.packageName!="com.memoweft.weftmate.mobile.and5qa"){super.attachBaseContext(base);return}
        val width=base.getSharedPreferences("native-qa",MODE_PRIVATE).getInt("width",360)
        val config=android.content.res.Configuration(base.resources.configuration)
        config.densityDpi=(base.resources.displayMetrics.widthPixels*160f/width).toInt()
        config.screenWidthDp=width
        config.screenHeightDp=(base.resources.displayMetrics.heightPixels*160f/config.densityDpi).toInt()
        super.attachBaseContext(base.createConfigurationContext(config))
    }
}
