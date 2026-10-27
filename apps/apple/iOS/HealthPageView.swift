import SwiftUI
import Charts
import WeftMateCore

struct HealthPageView: View {
    @ObservedObject var app: AppleAppModel
    @EnvironmentObject private var health: DailyHealthModel
    @StateObject private var page = HealthPageModel()
    @State private var expansion = false
    @State private var requestExpansion = false
    var ask: (String) -> Void
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                if page.offline { Text("电脑不在线 · "+page.updatedText).font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary).accessibilityIdentifier("health.offline") }
                if page.loading && page.cache.overview == nil { ProgressView("正在看看今天的状态…") }
                if let error=page.error { Text(error); Button("重试") { Task { await page.refresh(app:app) } } }
                if let notice=page.notice { Text(notice).font(AppleTokens.Fonts.callout).accessibilityIdentifier("health.notice") }
                if let overview=page.cache.overview, overview.connected {
                    today(overview)
                } else if !page.loading {
                    card {
                        Text("从每天的身体变化，慢慢了解自己").font(AppleTokens.Fonts.title2.bold())
                        Text("接上 iPhone 的健康数据，就能在这里看睡眠、运动和你平时的状态。只有汇总送到自己的电脑。")
                        Button("接上") { Task { await health.expand(app:app); await page.refresh(app:app) } }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.connect")
                    }.accessibilityIdentifier("health.disconnected")
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("健康")
            .toolbarBackground(Weave.canvas,for:.navigationBar).toolbarBackground(.visible,for:.navigationBar)
            .toolbar {
                ToolbarItem(placement:.primaryAction) {
                    Button { Task { await health.activate(app:app); await page.refresh(app:app) } } label: { WeftIcon("sync") }
                        .disabled(health.busy || page.loading).accessibilityLabel("刷新健康").accessibilityIdentifier("health.refresh")
                }
                ToolbarItem(placement:.primaryAction) { NavigationLink { HealthPageSettingsView(app:app,page:page) } label: { WeftIcon("settings") }.accessibilityLabel("健康设置") }
            }
            .sheet(isPresented:$expansion,onDismiss:{
                if requestExpansion { requestExpansion=false; Task { await health.expand(app:app); await page.refresh(app:app) } }
            }) {
                HealthAdditionalAuthorizationView(authorize:{ requestExpansion=true; expansion=false },later:{ expansion=false })
            }
            .task(id:app.accountEpoch) {
                await health.enteredHealthPage(app:app)
                await page.refresh(app:app)
                expansion=await health.checkExpansion(app:app)
            }
            .refreshable { await page.refresh(app:app) }
    }
    @ViewBuilder private func today(_ o: HealthOverview) -> some View {
        card {
            Text("今日解读").font(AppleTokens.Fonts.subheadline).foregroundStyle(.secondary)
            Text(o.insight?.headline ?? "听听身体今天的节奏").font(AppleTokens.Fonts.largeTitle.bold())
            Text(o.insight?.text ?? "今天的测量还没到齐，已有的变化先看看。")
            ForEach(o.insight?.suggestions ?? []) { suggestion in
                HStack(alignment:.top) {
                    Text(suggestion.text); Spacer()
                    if suggestion.reminder != nil { Button("提醒我") { Task { await page.remind(suggestion,app:app) } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("health.remind."+suggestion.id) }
                }
            }
            HStack { Spacer(); Button("接着问它") { ask(o.insight?.text ?? "帮我看看今天的健康变化") }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.ask") }
        }.accessibilityElement(children:.contain).accessibilityIdentifier("health.insight")
        LazyVGrid(columns:Array(repeating:GridItem(.flexible(),alignment:.top),count:HealthPagePolicy.scoreColumns(width:0)),alignment:.leading,spacing:AppleTokens.Space.p12) {
            ForEach(["recovery","sleep","load"],id:\.self) { id in score(id,o) }
            if HealthPagePolicy.visibleOptionalCards(o).contains("stress"),let value=o.stress { extra("stress","压力",value.score,value.state,value.label) }
            if HealthPagePolicy.visibleOptionalCards(o).contains("energy"),let value=o.energy { extra("energy","电能",value.current,value.state,value.label) }
            if HealthPagePolicy.visibleOptionalCards(o).contains("fitnessAge"),let value=o.fitnessAge { extra("fitnessAge","体能年龄",value.fitnessAge,value.state,value.label) }
        }.accessibilityIdentifier("health.scoreGrid")
        card {
            NavigationLink { detail("sleepMinutes","睡眠时长") } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text("昨晚睡眠").font(AppleTokens.Fonts.title2.bold())
                    HealthDurationNumber(minutes:o.sleep?.minutes)
                    Text("深睡 "+minutes(o.sleep?.deepMinutes ?? page.cache.series["deepMinutes-7"]?.points.last?.value)+" · 快速眼动 "+minutes(o.sleep?.remMinutes ?? page.cache.series["remMinutes-7"]?.points.last?.value))
                    Text(time(o.sleep?.start)+" — "+time(o.sleep?.end)).foregroundStyle(.secondary)
                    if let used=o.usage?.lastUsedAt { Text("最近一次向 WeftMate 发消息 "+time(used)).font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary) }
                    else if let late=o.usage?.lateNightMinutes,(o.usage?.activeMinutes ?? 0) > 0 || late > 0 { Text("深夜使用电脑 "+minutes(late)).font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary) }
                    Text("设备本地时间").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.sleepDuration")
        }
        Text("身体指标").font(AppleTokens.Fonts.title2.bold())
        LazyVGrid(columns:[GridItem(.flexible(minimum:0)),GridItem(.flexible(minimum:0))],alignment:.leading,spacing:AppleTokens.Space.p12) {
                ForEach(vitalIDs,id:\.self) { id in
                    let metric=o.vital(id)
                    card {
                        NavigationLink { detail(id,title(id)) } label: {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                Text(title(id)).font(AppleTokens.Fonts.headline)
                                HealthScoreNumber(text:PhoneHealthText.number(metric?.value,metric:id),unit:unit(id))
                                HStack { Circle().fill(stateColor(metric?.state)).frame(width:8,height:8); Text(metric?.value == nil ? "暂时没有测量" : metric?.label ?? "再戴几天就有对比了").font(AppleTokens.Fonts.footnote).foregroundStyle(stateColor(metric?.state)) }
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("health.vital."+id)
                    }.frame(maxWidth:.infinity,minHeight:150,alignment:.topLeading)
                }
        }
        card {
            NavigationLink { detail("steps","步数") } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text("今天的活动").font(AppleTokens.Fonts.title2.bold())
                    HealthScoreNumber(text:o.activity?.steps.map { "\($0)" } ?? "—",unit:"步")
                    Text("活动能量 "+number(o.activity?.activeEnergyKcal)+" 千卡 · 运动 "+minutes(o.activity?.exerciseMinutes))
                    if o.activity?.steps == nil { Text("还没有读到今天的活动测量。") }
                    ForEach(Array((o.activity?.workouts ?? []).enumerated()),id:\.offset) { _, workout in Text(workout.type+" · "+minutes(workout.minutes)) }
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.activity")
        }
        if let calendar=page.cache.calendar {
            card {
                Text("这个月的运动").font(AppleTokens.Fonts.title2.bold())
                LazyVGrid(columns:Array(repeating:GridItem(.flexible()),count:7),spacing:AppleTokens.Space.p12) {
                    ForEach(calendar.days) { day in
                        VStack { Text(String(day.day.suffix(2))); Circle().fill(day.hasWorkout ? Weave.accent : Color.secondary.opacity(0.15)).frame(width:6,height:6) }
                            .accessibilityElement(children:.ignore).accessibilityLabel(DeviceDateText.day(day.day)+(day.hasWorkout ? "，有运动" : "，没有运动记录"))
                    }
                }
            }
        }
    }
    private func score(_ id: String, _ o: HealthOverview) -> some View {
        let value=id == "recovery" ? o.recovery : id == "sleep" ? o.sleep : o.load
        return card {
            NavigationLink { detail(id,title(id)) } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text(title(id)).font(AppleTokens.Fonts.headline)
                    Text(value?.label ?? "再戴几天就有对比了").foregroundStyle(stateColor(value?.state)).font(AppleTokens.Fonts.caption)
                    HealthScoreNumber(text:number(value?.score),unit:"分")
                    HealthScoreRangeBar(score:value?.score,low:value?.low,high:value?.high,state:value?.state)
                }.frame(maxWidth:.infinity,minHeight:210,alignment:.topLeading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.score."+id)
        }
    }
    private func extra(_ id: String,_ name: String,_ value: Double?,_ state: String?,_ label: String?) -> some View {
        card {
            NavigationLink { detail(id,name) } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text(name).font(AppleTokens.Fonts.headline)
                    Text(label ?? "还没有足够的测量").foregroundStyle(stateColor(state)).font(AppleTokens.Fonts.caption)
                    HealthScoreNumber(text:number(value),unit:id == "fitnessAge" ? "岁" : "分")
                    HealthScoreRangeBar(score:id == "fitnessAge" ? nil : value,low:nil,high:nil,state:state)
                    if id == "stress" { Text("最近一次测量 "+time(page.cache.overview?.stress?.latest?.time)).font(AppleTokens.Fonts.footnote) }
                    if id == "energy", let curve=page.cache.overview?.energy?.curve,curve.compactMap(\.value).count >= 2 {
                        Chart(Array(curve.enumerated()),id:\.offset) { i,p in
                            if let v=p.value { LineMark(x:.value("时刻",i),y:.value("电能",v)).lineStyle(StrokeStyle(lineWidth:AppleTokens.Space.p4,lineCap:.round,lineJoin:.round)) }
                        }.chartXAxis(.hidden).chartYAxis(.hidden).frame(height:32).accessibilityLabel("当日电能曲线")
                    }
                }.frame(maxWidth:.infinity,minHeight:210,alignment:.topLeading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.extra."+id)
        }
    }
    private func detail(_ id: String,_ name: String) -> some View { HealthDetailView(app:app,page:page,id:id,name:name,ask:ask) }
    private func analysis(_ scope: String) -> some View { HealthAnalysisRow(app:app,page:page,scope:scope,ask:ask) }
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p16,content:content).frame(maxWidth:.infinity,alignment:.leading)
            .padding(AppleTokens.Space.p16).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r24))
    }
}
private let vitalIDs=["restingHeartRateBpm","hrvSdnnMs","respiratoryRateBrpm","spo2Pct","wristTempC"]
private func title(_ id: String) -> String {
    ["recovery":"恢复","sleep":"睡眠","load":"负荷","restingHeartRateBpm":"静息心率","hrvSdnnMs":"心率变异性","respiratoryRateBrpm":"呼吸频率","spo2Pct":"血氧","wristTempC":"手腕温度"][id] ?? "身体变化"
}
private func unit(_ id: String) -> String { ["restingHeartRateBpm":" 次/分","hrvSdnnMs":" 毫秒","respiratoryRateBrpm":" 次/分","spo2Pct":"%","wristTempC":"°C"][id] ?? "" }
private func number(_ value: Double?) -> String { PhoneHealthText.number(value) }
private func minutes(_ value: Double?) -> String { value.map { let n=Int($0.rounded()); return n >= 60 ? "\(n/60) 小时 \(n%60) 分" : "\(n) 分钟" } ?? "—" }
private func time(_ value: String?) -> String { PhoneHealthText.time(value,zone:.current) }
private func stateColor(_ state: String?) -> Color { switch HealthPagePolicy.statusTint(state) { case .green: AppleTokens.Colors.healthRecovery; case .amber: AppleTokens.Colors.healthStressModerate; case .muted: Weave.muted } }
extension JSONValue { var healthNumber: Double? { if case .number(let v)=self { v } else { nil } } }

struct HealthAnalysisRow: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var page: HealthPageModel
    let scope: String
    var ask: (String) -> Void
    @State private var expanded=false
    var body: some View {
        if page.analysisSupported || page.analyses[scope] != nil {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                Button {
                    expanded.toggle()
                    if expanded && page.analysisEnabled { Task { await page.analyze(scope,app:app) } }
                } label: {
                    HStack(alignment:.top) {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p6) {
                            Text("AI 分析").font(AppleTokens.Fonts.caption).foregroundStyle(.secondary)
                            Text(page.analyses[scope]?.text.components(separatedBy:"。").first ?? "让 AI 分析这一项").font(AppleTokens.Fonts.callout)
                        }; Spacer(); WeftIcon("chevron",size:AppleTokens.Space.p16).rotationEffect(.degrees(expanded ? 180 : 0))
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("health.analysis."+scope)
                if expanded {
                    if let result=page.analyses[scope] {
                        Text(result.text)
                        ForEach(result.points,id:\.self) { Text($0) }
                        Text("参考了："+result.basis.joined(separator:"、")).font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary)
                        Button("接着问它") { ask(result.text) }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.analysisAsk."+scope)
                    } else if page.generating.contains(scope) { ProgressView("正在看看这一项的变化…").accessibilityIdentifier("health.analysisLoading") }
                    else if !page.analysisEnabled {
                        Button("打开 AI 分析") { Task { await page.analyze(scope,enable:true,app:app) } }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.analysisEnable."+scope)
                    }
                    if let error=page.analysisErrors[scope] {
                        Text(error).font(AppleTokens.Fonts.footnote)
                        if page.analysisEnabled { Button("再试一次") { Task { await page.analyze(scope,app:app) } } }
                    }
                }
            }
        }
    }
}
struct HealthDetailView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var page: HealthPageModel
    let id: String; let name: String
    var ask: (String) -> Void
    @State private var days=7
    @State private var series: HealthMetricSeries?
    @State private var overlay: HealthMetricSeries?
    @State private var overlays=false
    @State private var loading=false
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(series?.points.last?.label ?? "看看它相对你平时的变化").font(AppleTokens.Fonts.title2.bold())
                HealthScoreNumber(text:PhoneHealthText.number(series?.points.last?.value,metric:id),unit:unit(id))
                if let low=series?.points.last?.low, let high=series?.points.last?.high {
                    Text("你平时的范围 "+number(low)+" — "+number(high)).foregroundStyle(.secondary)
                    Gauge(value:series?.points.last?.value ?? low,in:min(low,series?.points.last?.value ?? low)...max(high,low+0.1,series?.points.last?.value ?? high)) { Text("相对平时的位置") }.tint(Weave.accent)
                } else { Text("再戴几天就有对比了").foregroundStyle(.secondary) }
                if let overview=page.cache.overview,let score=HealthPagePolicy.score(id,in:overview),let reasons=score.reasons,!reasons.isEmpty {
                    DisclosureGroup("依据") {
                        ForEach(Array(reasons.enumerated()),id:\.offset) { _,reason in Text(reason.text).font(AppleTokens.Fonts.callout) }
                    }.tint(Weave.accent).accessibilityIdentifier("health.basis."+id)
                }
                Picker("时间范围",selection:$days) { ForEach([7,14,30,60],id:\.self) { Text("\($0) 天").tag($0) } }.pickerStyle(.segmented).accessibilityIdentifier("health.range")
                if loading { ProgressView("正在读取变化…") }
                HealthTrendChart(series:series,overlay:overlays ? overlay : nil,compact:false).accessibilityIdentifier("health.trend")
                HealthFormalBasis(overview:page.cache.overview,id:id)
                Text("灰色是你常见的范围，虚线是这段时间的平均；按住图表可以看某一天。").font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary)
                Toggle("叠加深夜使用时长",isOn:$overlays).accessibilityIdentifier("health.overlay")
                if overlays { Text("淡色柱按这段时间最长的深夜使用分钟缩放，显示变化关联。").font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary) }
                if series?.points.allSatisfy({ $0.value == nil }) != false { Text("这段时间没有足够的测量，先看已有的部分。") }
                HealthAnalysisRow(app:app,page:page,scope:vitalIDs.contains(id) ? "vital:"+id : ["recovery","sleep","load","stress","energy","fitnessAge","activity"].contains(id) ? id : "activity",ask:ask)
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle(name)
            .task(id:"\(app.accountEpoch)-\(days)-\(overlays)") {
                let token=app.accountEpoch; loading=true; series=nil; overlay=nil
                let next=await page.metric(id,days:days,app:app)
                guard token == app.accountEpoch,!Task.isCancelled else { return }; series=next
                if overlays { let nextOverlay=await page.metric("usageLateNightMinutes",days:days,app:app); guard token == app.accountEpoch,!Task.isCancelled else { return }; overlay=nextOverlay }
                loading=false
            }
    }
}
struct HealthTrendChart: View {
    var series: HealthMetricSeries?; var overlay: HealthMetricSeries?; var compact: Bool
    @State private var selected: Int?
    private var points: [HealthMetricPoint] { series?.points ?? [] }
    var body: some View {
        VStack(alignment:.leading) {
            Chart {
                ForEach(Array(points.enumerated()),id:\.offset) { i,p in
                    if let low=p.low,let high=p.high { AreaMark(x:.value("日期",i),yStart:.value("常见范围下界",low),yEnd:.value("常见范围上界",high)).foregroundStyle(Color.gray.opacity(0.15)) }
                    if let v=p.value {
                        LineMark(x:.value("日期",i),y:.value("数值",v)).lineStyle(StrokeStyle(lineWidth:AppleTokens.Space.p4,lineCap:.round,lineJoin:.round)).foregroundStyle(Weave.accent)
                        PointMark(x:.value("日期",i),y:.value("数值",v)).foregroundStyle(Weave.accent)
                    }
                }
                if let average=series?.average { RuleMark(y:.value("平均",average)).lineStyle(StrokeStyle(lineWidth:1,dash:[4,4])).foregroundStyle(.secondary) }
                if let overlay {
                    ForEach(Array(overlay.points.enumerated()),id:\.offset) { i,p in
                        if let v=p.value {
                            BarMark(x:.value("日期",i),y:.value("深夜使用",v/max(1,overlay.points.compactMap(\.value).max() ?? 1)*(points.compactMap(\.value).max() ?? 100)))
                                .foregroundStyle(Color.orange.opacity(0.12))
                        }
                    }
                }
            }.frame(height:compact ? 56 : 240)
                .chartXAxis {
                    if !compact {
                        AxisMarks(values:Array(stride(from:0,to:points.count,by:max(1,points.count/4)))) { value in
                            AxisGridLine(); AxisTick()
                            AxisValueLabel { if let index=value.as(Int.self),points.indices.contains(index) { Text(String((points[index].day ?? "").suffix(5))) } }
                        }
                    }
                }.chartYAxis(compact ? .hidden : .automatic)
                .chartXSelection(value:$selected)
                .allowsHitTesting(!compact).accessibilityHidden(compact)
                .accessibilityLabel("逐日趋势").accessibilityValue(points.map { ($0.day ?? "")+" "+number($0.value) }.joined(separator:"，"))
            if !compact,let selected,points.indices.contains(selected) { Text((points[selected].day.map(DeviceDateText.day) ?? "")+" · "+number(points[selected].value)).font(AppleTokens.Fonts.callout).accessibilityIdentifier("health.selectedDay") }
        }
    }
}
struct HealthPageSettingsView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var page: HealthPageModel
    var body: some View {
        Form {
            DailyHealthSettingsRow(app:app)
            HealthAISettingsRow(app:app)
        }.navigationTitle("健康数据")
            .onDisappear { Task { await page.refresh(app:app) } }
    }
}

struct HealthAdditionalAuthorizationView: View {
    var authorize: () -> Void
    var later: () -> Void
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
            Text("再多读几项，页面才完整").font(AppleTokens.Fonts.title2.bold())
            Text("心率变异性、呼吸、血氧、手腕温度、睡眠分期、最大摄氧量、身高体重和出生年份。只读不写，拒绝也能看已有的部分。")
            Button("继续",action:authorize).buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("health.expandAuthorize")
            Button("先看已有的",action:later).buttonStyle(OutlineActionStyle()).accessibilityIdentifier("health.expandLater")
        }.padding(AppleTokens.Space.p24).presentationDetents([.medium,.large]).presentationDragIndicator(.visible)
    }
}

private struct HealthFormalBasis: View {
    var overview: HealthOverview?; var id: String
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
            if id == "stress", let stress=overview?.stress {
                Text("最近一次测量 "+time(stress.latest?.time))
                Text("当天平均 "+number(stress.average)+" · 基线 "+String(stress.baselineDays ?? 0)+" 天")
                Text((stress.samples ?? []).contains { $0.method == "stressIndex" } ? "根据逐搏间期估计压力，再与你的个人基线比较。" : "根据心率变异性和心率估计，再与你的个人基线比较。")
                missing(stress.missing); Text(stress.disclaimer ?? "这是趋势估计，不是医学结论。")
            }
            if id == "energy", let energy=overview?.energy {
                Text("夜间恢复 "+number(energy.nightCharged)+" · 白天消耗 "+number(energy.dayDrained))
                if energy.degraded == true { Text("部分时段使用每小时心率估计，空缺时段不补测量。") }
                ForEach(Array((energy.sleepPeriods ?? []).enumerated()),id:\.offset) { _,period in Text("睡眠时段 "+period.start+" — "+period.end) }
                missing(energy.missing); Text(energy.disclaimer ?? "这是趋势估计，不是医学结论。")
            }
            if id == "fitnessAge", let age=overview?.fitnessAge {
                if let difference=age.difference { Text("与实际年龄相差 "+number(difference)+" 岁") }
                if let range=age.referenceRange { Text("同年龄参考范围 "+number(range.low)+" — "+number(range.high)+" 毫升/千克/分钟") }
                if age.bounded == true { Text("已到参考表边界，只供趋势参考。") }
                missing(age.missing); Text(age.disclaimer ?? "这是趋势估计，不是医学结论。")
            }
            if id == "load", let range=overview?.load?.recommendedRange { Text("建议相对负荷 "+number(range.low)+" — "+number(range.high)) }
        }.font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
    }
    @ViewBuilder private func missing(_ values: [String]?) -> some View {
        if let values, !values.isEmpty { Text("还缺少："+values.map(HealthFieldText.name).joined(separator:"、")) }
    }
}
