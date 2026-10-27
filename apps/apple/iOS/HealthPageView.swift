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
        }.background(Weave.canvas).navigationTitle("健康").navigationBarTitleDisplayMode(.large)
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
        Text(DeviceDateText.day(o.day)).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
        HStack {
            Text(page.updatedText).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            Spacer()
            NavigationLink("数据与权限") { HealthPageSettingsView(app:app,page:page) }.font(AppleTokens.Fonts.footnote)
        }
        NavigationLink { detail("recovery","恢复") } label: {
            HStack(spacing:AppleTokens.Space.p16) {
                HealthScoreNumber(text:number(o.recovery?.score)).foregroundStyle(stateColor(o.recovery?.state)).fixedSize(horizontal:true,vertical:false)
                VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                    Text(o.recovery?.score == nil ? "恢复 · —" : o.recovery?.label ?? "恢复").font(AppleTokens.Fonts.headline)
                    Text(o.recovery?.score == nil ? "测量还没到齐，再戴几天看看。" : o.insight?.headline ?? "看看相对平时的变化").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                }.frame(maxWidth:.infinity,alignment:.leading)
                WeftIcon("right",size:AppleTokens.Space.p16).foregroundStyle(Weave.muted)
            }.frame(minHeight:AppleTokens.Space.p44).padding(.vertical,AppleTokens.Space.p12).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("health.score.recovery")
        Divider()
        ViewThatFits(in:.horizontal) {
            HStack(alignment:.top,spacing:AppleTokens.Space.p16) { secondaryMetrics(o) }
            VStack(alignment:.leading,spacing:AppleTokens.Space.p16) { secondaryMetrics(o) }
        }.accessibilityIdentifier("health.secondaryMetrics")
        Divider()
        NavigationLink { detail("sleepMinutes","睡眠时长") } label: {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                HStack { Text("昨晚睡眠").font(AppleTokens.Fonts.headline).foregroundStyle(AppleTokens.Colors.healthSleep);Spacer();WeftIcon("right",size:AppleTokens.Space.p16).foregroundStyle(Weave.muted) }
                HealthDurationNumber(minutes:o.sleep?.minutes)
                Text(time(o.sleep?.start)+" 入睡 · "+time(o.sleep?.end)+" 起床").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                if let stages=(health.state.pending[o.day] ?? health.state.delivered[o.day])?.sleep?.stages,!stages.isEmpty { PhoneSleepStageTimeline(stages:stages) }
                sleepStages(o)
                if let used=o.usage?.lastUsedAt { Text("最近一次向 WeftMate 发消息 "+time(used)).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted) }
                else if let late=o.usage?.lateNightMinutes { Text("深夜使用电脑 "+minutes(late)).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted) }
                Text("设备本地时间").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("health.sleepDuration")
        NavigationLink { detail("sleep","睡眠分数") } label: { PhoneFeatureRow(title:"睡眠分数",subtitle:o.sleep?.label ?? "测量还没到齐",value:number(o.sleep?.score)) }.buttonStyle(.plain).accessibilityIdentifier("health.score.sleep")
        Divider()
        PhoneSectionHeading(title:"身体指标")
        VStack(spacing:0) {
            ForEach(vitalIDs,id:\.self) { id in
                let metric=o.vital(id)
                NavigationLink { detail(id,title(id)) } label: {
                    PhoneFeatureRow(title:title(id),subtitle:metric?.value == nil ? "暂时没有测量，请检查健康读取权限。" : metric?.label,value:PhoneHealthText.number(metric?.value,metric:id)+unit(id))
                }.buttonStyle(.plain).accessibilityIdentifier("health.vital."+id)
                Divider()
            }
            if let age=o.fitnessAge {
                NavigationLink { detail("fitnessAge","体能年龄") } label: { PhoneFeatureRow(title:"体能年龄",subtitle:age.label ?? "还没有足够的测量",value:number(age.fitnessAge)+" 岁") }.buttonStyle(.plain).accessibilityIdentifier("health.extra.fitnessAge")
                Divider()
            }
        }
        PhoneSectionHeading(title:"今天的活动")
        NavigationLink { detail("steps","步数") } label: {
            PhoneFeatureRow(title:o.activity?.steps.map { "\($0) 步" } ?? "— 步",subtitle:"活动能量 "+number(o.activity?.activeEnergyKcal)+" 千卡 · 运动 "+minutes(o.activity?.exerciseMinutes))
        }.buttonStyle(.plain).accessibilityIdentifier("health.activity")
        ForEach(Array((o.activity?.workouts ?? []).enumerated()),id:\.offset) { _,workout in Text(workout.type+" · "+minutes(workout.minutes)).font(AppleTokens.Fonts.callout) }
        if let calendar=page.cache.calendar {
            PhoneSectionHeading(title:"这个月的运动")
            LazyVGrid(columns:Array(repeating:GridItem(.flexible()),count:7),spacing:AppleTokens.Space.p12) {
                // Empty leading cells keep each day under its actual weekday.
                ForEach(0..<calendarLeadingDays(calendar),id:\.self) { _ in Color.clear.frame(height:AppleTokens.Space.p44).accessibilityHidden(true) }
                ForEach(calendar.days) { day in
                    VStack { Text(String(day.day.suffix(2)));Circle().fill(day.hasWorkout ? Weave.accent : Weave.line).frame(width:6,height:6) }
                        .frame(minHeight:AppleTokens.Space.p44).accessibilityElement(children:.ignore).accessibilityLabel(DeviceDateText.day(day.day)+(day.hasWorkout ? "，有运动" : "，没有运动记录"))
                }
            }
        }
        Divider()
        VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
            Text(o.insight?.headline ?? "今日解读").font(AppleTokens.Fonts.headline)
            Text(o.insight?.text ?? "今天的测量还没到齐，已有的变化先看看。")
            ForEach(o.insight?.suggestions ?? []) { suggestion in
                HStack(alignment:.top) {
                    Text(suggestion.text);Spacer()
                    if suggestion.reminder != nil { Button("提醒我") { Task { await page.remind(suggestion,app:app) } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("health.remind."+suggestion.id) }
                }
            }
            Button("接着问它") { ask(o.insight?.text ?? "帮我看看今天的健康变化") }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("health.ask")
        }.accessibilityIdentifier("health.insight")
    }
    @ViewBuilder private func secondaryMetrics(_ o: HealthOverview) -> some View {
        secondary("stress","压力",o.stress?.score,o.stress?.label,o.stress?.state)
        secondary("energy","电能",o.energy?.current,o.energy?.label,o.energy?.state)
        secondary("load","活动负荷",o.load?.score,o.load?.label,o.load?.state)
    }
    private func secondary(_ id: String,_ name: String,_ value: Double?,_ label: String?,_ state: String?) -> some View {
        NavigationLink { detail(id,name) } label: {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                Text(name).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                Text(value == nil ? "—" : id == "energy" ? number(value)+" / 100" : label ?? number(value)).font(AppleTokens.Fonts.headline).foregroundStyle(stateColor(state))
                if value == nil { Text("测量不足").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }.frame(maxWidth:.infinity,minHeight:AppleTokens.Space.p44,alignment:.leading).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier(id == "load" ? "health.score.load" : "health.extra."+id)
    }
    @ViewBuilder private func sleepStages(_ o: HealthOverview) -> some View {
        let deep=o.sleep?.deepMinutes ?? page.cache.series["deepMinutes-7"]?.points.last?.value
        let rem=o.sleep?.remMinutes ?? page.cache.series["remMinutes-7"]?.points.last?.value
        if let total=o.sleep?.minutes,total > 0,let deep,let rem {
            GeometryReader { geometry in
                HStack(spacing:AppleTokens.Space.p2) {
                    Rectangle().fill(AppleTokens.Colors.healthSleep).frame(width:max(0,geometry.size.width-4)*min(1,deep/total))
                    Rectangle().fill(AppleTokens.Colors.healthSleep.opacity(0.55)).frame(width:max(0,geometry.size.width-4)*min(max(0,1-deep/total),rem/total))
                    Rectangle().fill(Weave.line)
                }
            }.frame(height:AppleTokens.Space.p16).accessibilityHidden(true)
            Text("深睡 "+minutes(deep)+" · 快速眼动 "+minutes(rem)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            Text("分期时长汇总；其余时长不推定睡眠阶段。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        } else { Text("睡眠分期还没到齐。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
    }
    private func calendarLeadingDays(_ month: HealthCalendarReply) -> Int {
        guard let first=month.days.first,let date=HealthInputMath.parseISO(first.day+"T12:00:00Z") else { return 0 }
        let calendar=Calendar.current
        return (calendar.component(.weekday,from:date)-calendar.firstWeekday+7)%7
    }
    private func detail(_ id: String,_ name: String) -> some View { HealthDetailView(app:app,page:page,id:id,name:name,ask:ask) }
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p16,content:content).frame(maxWidth:.infinity,alignment:.leading)
            .padding(AppleTokens.Space.p16).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Phone.groupRadius))
    }
}

private struct PhoneSleepStageTimeline: View {
    let stages: [HealthRecordSleepStage]
    private func color(_ stage: String) -> Color {
        switch stage {
        case "deep": AppleTokens.Colors.healthSleepDeep
        case "core": AppleTokens.Colors.healthSleepCore
        case "rem": AppleTokens.Colors.healthSleepRem
        default: AppleTokens.Colors.healthSleepAwake
        }
    }
    var body: some View {
        Chart(Array(stages.enumerated()),id:\.offset) { _,stage in
            if let start=HealthInputMath.parseISO(stage.start),let end=HealthInputMath.parseISO(stage.end) {
                BarMark(xStart:.value("开始",start),xEnd:.value("结束",end),y:.value("阶段",stage.stage)).foregroundStyle(color(stage.stage))
            }
        }.chartXAxis(.hidden).chartYAxis(.hidden).frame(height:56)
            .accessibilityLabel("实际睡眠分期，深睡、核心睡眠、快速眼动和清醒时段")
    }
}

private let vitalIDs=["restingHeartRateBpm","hrvSdnnMs","respiratoryRateBrpm","spo2Pct","wristTempC"]
private func title(_ id: String) -> String {
    ["recovery":"恢复","sleep":"睡眠","load":"负荷","stress":"压力","energy":"电能","fitnessAge":"体能年龄","sleepMinutes":"睡眠时长","steps":"步数","restingHeartRateBpm":"静息心率","hrvSdnnMs":"心率变异性","respiratoryRateBrpm":"呼吸频率","spo2Pct":"血氧","wristTempC":"手腕温度"][id] ?? "身体变化"
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
    @State private var attempt=0
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(series?.points.last?.label ?? "看看它相对你平时的变化").font(AppleTokens.Fonts.title2.bold())
                if id == "sleepMinutes" { HealthDurationNumber(minutes:series?.points.last?.value) }
                else { HealthScoreNumber(text:PhoneHealthText.number(series?.points.last?.value,metric:id),unit:unit(id)) }
                Text(page.updatedText).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
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
                Text("灰色是你常见的范围，虚线是这段时间的平均；点按或按住图表可以看某一天。").font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary)
                Toggle("叠加深夜使用时长",isOn:$overlays).accessibilityIdentifier("health.overlay")
                if overlays { Text("淡色柱按这段时间最长的深夜使用分钟缩放，显示变化关联。").font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary) }
                if !loading,series == nil {
                    InlineNotice(message:"这段趋势暂时读不到，请连接电脑后重试。",isError:true)
                    Button("重试") { attempt += 1 }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("health.trendRetry")
                } else if !loading,series?.points.allSatisfy({ $0.value == nil }) != false { Text("这段时间没有足够的测量，先看已有的部分。") }
                HealthAnalysisRow(app:app,page:page,scope:vitalIDs.contains(id) ? "vital:"+id : id == "sleepMinutes" ? "sleep" : ["recovery","sleep","load","stress","energy","fitnessAge","activity"].contains(id) ? id : "activity",ask:ask)
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle(name)
            .task(id:"\(app.accountEpoch)-\(days)-\(overlays)-\(attempt)") {
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
                                .foregroundStyle(AppleTokens.Colors.healthSleep.opacity(0.12))
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
                .chartOverlay { proxy in
                    GeometryReader { geometry in
                        Rectangle().fill(.clear).contentShape(Rectangle()).gesture(SpatialTapGesture().onEnded { tap in
                            guard !compact,let frame=proxy.plotFrame else { return }
                            selected=proxy.value(atX:tap.location.x-geometry[frame].origin.x,as:Int.self)
                        })
                    }
                }
                .allowsHitTesting(!compact).accessibilityHidden(compact)
                .accessibilityLabel("逐日趋势").accessibilityValue(points.map { ($0.day ?? "")+" "+number($0.value) }.joined(separator:"，"))
            if !compact,let selected,points.indices.contains(selected) { Text((points[selected].day.map(DeviceDateText.day) ?? "")+" · "+number(points[selected].value)).font(AppleTokens.Fonts.callout).accessibilityIdentifier("health.selectedDay") }
        }
    }
}
struct HealthPageSettingsView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var page: HealthPageModel
    @EnvironmentObject private var health: DailyHealthModel
    @StateObject private var summaries=HealthSettingsModel()
    @State private var stopping=false
    var body: some View {
        Form {
            Section { Text("由你决定读取什么、用在哪里。").foregroundStyle(Weave.muted) }
            DailyHealthSettingsRow(app:app,showsReview:false)
            Section("解读") { HealthAISettingsRow(app:app) }
            Section("查看数据") {
                NavigationLink("每日与小时摘要") { PhoneHealthSummaryView(app:app) }.accessibilityIdentifier("health.summaries")
                if app.session != nil { NavigationLink("每日摘要与云端范围") { HealthSettingsView(model:summaries,app:app) }.accessibilityIdentifier("health.cloudScope") }
                else { Text("云端范围与电脑同步设置，连上电脑后可用。").foregroundStyle(Weave.muted) }
            }
            Section("停止与清理") {
                Button("停止读取并撤回电脑摘要",role:.destructive) { stopping=true }.disabled(health.busy).accessibilityIdentifier("health.stopReading")
                Text(health.state.needsRemoteClear || !health.state.pending.isEmpty && !health.state.enabled ? "撤回尚未确认，连上电脑后会继续处理。" : health.state.enabled ? "停止后不再读取；健康 App 中的原始记录保留。" : "读取已停止。电脑摘要的撤回状态以同步回执为准。")
                    .font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted).accessibilityIdentifier("health.cleanupReceipt")
            }
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("健康数据")
            .confirmationDialog("停止读取并撤回电脑摘要？",isPresented:$stopping,titleVisibility:.visible) {
                Button("停止并撤回",role:.destructive) { Task { await health.setEnabled(false,app:app);await page.refresh(app:app) } }
                Button("取消",role:.cancel) {}
            } message: { Text("不删除健康 App 的原始记录。电脑不在线时保留待撤回状态，连接后继续。") }
            .onDisappear { Task { await page.refresh(app:app) } }
            .accessibilityIdentifier("health.settings")
    }
}

struct PhoneHealthSummaryView: View {
    @ObservedObject var app: AppleAppModel
    @EnvironmentObject private var health: DailyHealthModel
    private var days: [String] { Set(health.state.delivered.keys).union(health.state.pending.keys).sorted(by:>) }
    var body: some View {
        List {
            Section { Text(health.status).foregroundStyle(Weave.muted);Text("每天的汇总和同步状态；不把缺少的测量记成零。").font(AppleTokens.Fonts.footnote) }
            if days.isEmpty { Text("还没有每日摘要。授权并更新后再来看看。") }
            ForEach(days,id:\.self) { day in
                let value=health.state.pending[day] ?? health.state.delivered[day]
                Section(DeviceDateText.day(day)) {
                    Text(health.state.pending[day] != nil ? value?.status == "unavailable" ? "等待电脑撤回" : "等待电脑收到" : value?.status == "unavailable" ? "电脑已撤回" : "电脑已收到")
                    if value?.status == "available" {
                        LabeledContent("步数",value:value?.steps.map(String.init) ?? "—")
                        LabeledContent("睡眠",value:minutes(value?.sleepMinutes))
                        LabeledContent("静息心率",value:number(value?.restingHeartRateBpm)+" 次/分")
                        LabeledContent("心率变异性",value:number(value?.hrvSdnnMs)+" 毫秒")
                        Text("小时心率 "+String(value?.heartRateHourly?.compactMap { $0 }.count ?? 0)+" 个时段").font(AppleTokens.Fonts.footnote)
                    }
                }
            }
        }.navigationTitle("每日摘要").refreshable { await health.activate(app:app) }
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
                missing(stress.missing)
            }
            if id == "energy", let energy=overview?.energy {
                Text("夜间恢复 "+number(energy.nightCharged)+" · 白天消耗 "+number(energy.dayDrained))
                if energy.degraded == true { Text("部分时段使用每小时心率估计，空缺时段不补测量。") }
                ForEach(Array((energy.sleepPeriods ?? []).enumerated()),id:\.offset) { _,period in Text("睡眠时段 "+period.start+" — "+period.end) }
                missing(energy.missing)
            }
            if id == "fitnessAge", let age=overview?.fitnessAge {
                if let difference=age.difference { Text("与实际年龄相差 "+number(difference)+" 岁") }
                if let range=age.referenceRange { Text("同年龄参考范围 "+number(range.low)+" — "+number(range.high)+" 毫升/千克/分钟") }
                if age.bounded == true { Text("已到参考表边界，只供趋势参考。") }
                missing(age.missing)
            }
            if id == "load", let range=overview?.load?.recommendedRange { Text("建议相对负荷 "+number(range.low)+" — "+number(range.high)) }
        }.font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
    }
    @ViewBuilder private func missing(_ values: [String]?) -> some View {
        if let values, !values.isEmpty { Text("还缺少："+values.map(HealthFieldText.name).joined(separator:"、")) }
    }
}
