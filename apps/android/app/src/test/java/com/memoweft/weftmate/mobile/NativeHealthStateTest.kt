package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

class NativeHealthStateTest {
    @Test fun humanDurationsKeepZeroAndMissingDistinct(){assertEquals("7 小时 46 分",healthDuration(466.0));assertEquals("0 分",healthDuration(0.0));assertEquals("—",healthDuration(null));assertEquals("1 小时",healthDuration(60.0));assertEquals("1 小时 1 分",healthDuration(60.8));assertEquals("—",healthDuration(Double.NaN))}
    @Test fun durationMetricsNeverExposeRawMinuteTotals(){assertEquals("7 小时 46 分",healthReading(466.0,"sleepMinutes"));assertEquals("1 小时 30 分",healthReading(90.0,"usageActiveMinutes"));assertEquals("1,200 步",healthReading(1200.0,"steps"));assertEquals("36.5 ℃",healthReading(36.5,"wristTempC"))}
    @Test fun datesAndClocksUseAccountZone(){assertEquals("今天 · 10月14日",healthDay("2026-10-14","2026-10-14"));assertEquals("10月13日",healthDay("2026-10-13","2026-10-14"));assertEquals("07:46",healthClock("2026-10-13T23:46:00Z","Asia/Shanghai"));assertEquals("—",healthClock("invalid","Asia/Shanghai"));assertEquals("00:15",healthClock("00:15","Asia/Shanghai"))}
    @Test fun seriesHistoricalWindowExcludesFutureAndMissingFromAverage(){val raw=JSONObject("""{"points":[{"day":"2026-10-11","value":99},{"day":"2026-10-12","value":0},{"day":"2026-10-13","value":null},{"day":"2026-10-14","value":80}]}""");val filtered=healthSeries(raw,"2026-10-13",2);assertEquals(2,filtered.getJSONArray("points").length());assertEquals(0.0,filtered.getDouble("average"),.001);assertTrue(healthSeries(raw,"2026-10-01",7).getBoolean("outsideRange"));assertTrue(healthSeries(raw,"2026-10-01",7).isNull("average"))}
    @Test fun pathAndBaselineBandsNeverBridgeMissingDays(){val points=listOf(JSONObject("""{"value":10,"low":8,"high":12}"""),JSONObject("""{"value":null}"""),JSONObject("""{"value":0,"low":0,"high":2}"""));val g=HealthPlotGeometry(points,5.0);assertEquals(listOf(listOf(0),listOf(2)),g.lines);assertEquals(listOf(listOf(0),listOf(2)),g.bands);assertEquals(16f,g.x(0),.001f);assertEquals(304f,g.x(2),.001f);assertTrue(g.y(0.0)>g.y(10.0))}
    @Test fun flatSeriesHasFiniteCoordinatesAndSingleMeasurement(){val g=HealthPlotGeometry(listOf(JSONObject().put("value",0)));assertEquals(160f,g.x(0),.001f);assertTrue(g.y(0.0).isFinite());assertEquals(1,g.lines.size)}
    @Test fun vitalBothContractShapesAndAnalysisScopes(){val row=JSONObject("""{"vitals":[{"id":"spo2Pct","value":0}]}""");assertEquals(0.0,healthVital(row,"spo2Pct")!!.number("value")!!,.001);assertNull(healthVital(row,"wristTempC"));assertEquals("vital:spo2Pct",healthScope("spo2Pct"));assertEquals("activity",healthScope("exerciseMinutes"));assertNull(healthScope("usageActiveMinutes"))}
    @Test fun quotePreservesNewlinesAndContainsNoSendInstruction(){assertEquals("> 2026-10-14 · 睡眠\n> 第一句\n> 第二句\n\n",healthQuote("2026-10-14","睡眠","第一句\n第二句"))}
    @Test fun serverExplanationsAndQuotedTextUseHumanDurations(){assertEquals("昨晚睡了 7 小时 46 分，深夜使用 1 小时 30 分",healthText("昨晚睡了 466 分钟，深夜使用 90 分钟"));assertEquals("心率 57 次/分钟，恢复 74 分",healthText("心率 57 次/分钟，恢复 74 分"));assertTrue(healthQuote("2026-10-14","睡眠","昨晚睡了466分钟").contains("7 小时 46 分"))}
}
