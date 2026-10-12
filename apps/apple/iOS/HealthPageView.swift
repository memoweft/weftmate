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
                if page.offline { Text("电脑不在线 · "+page.updatedText).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("health.offline") }
                if page.loading && page.cache.overview == nil { ProgressView("正在看看今天的状态…") }
                if let error=page.error { Text(error); Button("重试") { Task { await page.refresh(app:app) } } }
                if let notice=page.notice { Text(notice).font(.callout).accessibilityIdentifier("health.notice") }
                if let overview=page.cache.overview, overview.connected {
                    today(overview)
                } else if !page.loading {
                    card {
                        Text("从每天的身体变化，慢慢了解自己").font(.title2.bold())
                        Text("接上 iPhone 的健康数据，就能在这里看睡眠、运动和你平时的状态。只有汇总送到自己的电脑。")
                        Button("接上") { Task { await health.expand(app:app); await page.refresh(app:app) } }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.connect")
                    }.accessibilityIdentifier("health.disconnected")
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("健康")
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
                await page.refresh(app:app)
                expansion=await health.checkExpansion(app:app)
            }
            .refreshable { await page.refresh(app:app) }
    }
    @ViewBuilder private func today(_ o: HealthOverview) -> some View {
        card {
            Text("今日解读").font(.subheadline).foregroundStyle(.secondary)
            Text(o.insight?.headline ?? "听听身体今天的节奏").font(.largeTitle.bold())
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
            if HealthPagePolicy.visibleOptionalCards(o).contains("stress"),let value=o.stress { extra("stress","压力",value) }
            if HealthPagePolicy.visibleOptionalCards(o).contains("energy"),let value=o.energy { extra("energy","电能",value) }
            if HealthPagePolicy.visibleOptionalCards(o).contains("fitnessAge"),let value=o.fitnessAge { extra("fitnessAge","体能年龄",value) }
        }.accessibilityIdentifier("health.scoreGrid")
        card {
            NavigationLink { detail("sleepMinutes","睡眠时长") } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text("昨晚睡眠").font(.title2.bold())
                    Text(minutes(o.sleep?.minutes)).font(.largeTitle.bold())
                    Text("深睡 "+minutes(o.sleep?.deepMinutes ?? page.cache.series["deepMinutes-7"]?.points.last?.value)+" · 快速眼动 "+minutes(o.sleep?.remMinutes ?? page.cache.series["remMinutes-7"]?.points.last?.value))
                    Text(time(o.sleep?.start)+" — "+time(o.sleep?.end)).foregroundStyle(.secondary)
                    Text(o.usage?.lastActiveAt == nil ? "深夜使用电脑 "+minutes(o.usage?.lateNightMinutes) : "昨晚用电脑到 "+time(o.usage?.lastActiveAt)).font(.footnote).foregroundStyle(.secondary)
                }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.sleepDuration")
        }
        Text("身体指标").font(.title2.bold())
        ScrollView(.horizontal) {
            HStack(alignment:.top,spacing:AppleTokens.Space.p12) {
                ForEach(vitalIDs,id:\.self) { id in
                    let metric=o.vitals[id]
                    card {
                        NavigationLink { detail(id,title(id)) } label: {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                Text(title(id)).font(.headline)
                                Text(number(metric?.value)+unit(id)).font(.title.bold())
                                HStack { Circle().fill(stateColor(metric?.state)).frame(width:8,height:8); Text(metric?.value == nil ? "暂时没有测量" : metric?.label ?? "再戴几天就有对比了").font(.footnote) }
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("health.vital."+id)
                    }.frame(width:210)
                }
            }
        }
        card {
            NavigationLink { detail("steps","步数") } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text("今天的活动").font(.title2.bold())
                    Text(o.activity?.steps.map { "\($0) 步" } ?? "—").font(.largeTitle.bold())
                    Text("活动能量 "+number(o.activity?.activeEnergyKcal)+" 千卡 · 运动 "+minutes(o.activity?.exerciseMinutes))
                    if o.activity?.steps == nil { Text("还没有读到今天的活动测量。") }
                    ForEach(Array((o.activity?.workouts ?? []).enumerated()),id:\.offset) { _, workout in Text(workout.type+" · "+minutes(workout.minutes)) }
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.activity")
        }
        if let calendar=page.cache.calendar {
            card {
                Text("这个月的运动").font(.title2.bold())
                LazyVGrid(columns:Array(repeating:GridItem(.flexible()),count:7),spacing:AppleTokens.Space.p12) {
                    ForEach(calendar.days) { day in
                        VStack { Text(String(day.day.suffix(2))); Circle().fill(day.hasWorkout ? Weave.accent : Color.secondary.opacity(0.15)).frame(width:6,height:6) }
                            .accessibilityElement(children:.ignore).accessibilityLabel(DeviceDateText.day(day.day)+(day.hasWorkout ? "，有运动" : "，没有运动记录"))
                    }
                }
            }
        }
        Text("这些变化帮你了解自己，不是医学结论。").font(.footnote).foregroundStyle(.secondary)
    }
    private func score(_ id: String, _ o: HealthOverview) -> some View {
        let value=id == "recovery" ? o.recovery : id == "sleep" ? o.sleep : o.load
        return card {
            NavigationLink { detail(id,title(id)) } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text(title(id)).font(AppleTokens.Fonts.headline)
                    Text(value?.label ?? "再戴几天就有对比了").foregroundStyle(stateColor(value?.state)).font(AppleTokens.Fonts.caption)
                    Text(number(value?.score)).font(.system(.largeTitle,design:.rounded,weight:.bold))
                    HealthTrendChart(series:page.cache.series[id+"-7"],overlay:nil,compact:true)
                    Text(value?.reasons?.first.map { "主要因为："+$0.text } ?? "再戴几天就有对比了").font(.callout).foregroundStyle(.secondary)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("health.score."+id)
        }
    }
    private func extra(_ id: String,_ name: String,_ value: JSONValue) -> some View {
        card {
            NavigationLink { detail(id,name) } label: {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text(name).font(.title2.bold())
                    Text(number(value["score"]?.healthNumber ?? value["value"]?.healthNumber)).font(.largeTitle.bold())
                    Text(value["label"]?.string ?? "根据你平时的变化估计")
                    if id == "stress" { Text("最近一次测量 "+time(value["measuredAt"]?.string ?? value["updatedAt"]?.string)).font(.footnote) }
                    if id == "energy", case .array(let points)=value["points"] {
                        Chart(Array(points.enumerated()),id:\.offset) { i,p in
                            if let v=p["value"]?.healthNumber { LineMark(x:.value("时刻",i),y:.value("电能",v)) }
                        }.frame(height:80).accessibilityLabel("当日电能曲线")
                    }
                    Text("趋势估计，不是医学结论").font(.footnote).foregroundStyle(.secondary)
                }.contentShape(Rectangle())
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
private func number(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(0...1))) } ?? "—" }
private func minutes(_ value: Double?) -> String { value.map { $0 >= 60 ? "\(Int($0)/60) 小时 \(Int($0)%60) 分" : "\(Int($0)) 分钟" } ?? "—" }
private func time(_ value: String?) -> String { guard let value,let date=HealthInputMath.parseISO(value) else { return "—" }; let f=DateFormatter(); f.dateFormat="H:mm"; return f.string(from:date) }
private func stateColor(_ state: String?) -> Color { switch state { case "normal","balanced": .green; case "high","more","low": .orange; default: .secondary } }
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
                            Text("AI 分析").font(.caption).foregroundStyle(.secondary)
                            Text(page.analyses[scope]?.text.components(separatedBy:"。").first ?? "让 AI 分析这一项").font(.callout)
                        }; Spacer(); WeftIcon("chevron",size:AppleTokens.Space.p16).rotationEffect(.degrees(expanded ? 180 : 0))
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("health.analysis."+scope)
                if expanded {
                    if let result=page.analyses[scope] {
                        Text(result.text)
                        ForEach(result.points,id:\.self) { Text($0) }
                        Text("参考了："+result.basis.joined(separator:"、")).font(.footnote).foregroundStyle(.secondary)
                        Button("接着问它") { ask(result.text) }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.analysisAsk."+scope)
                    } else if page.generating.contains(scope) { ProgressView("正在看看这一项的变化…").accessibilityIdentifier("health.analysisLoading") }
                    else if !page.analysisEnabled {
                        Text("会把这一项每天的汇总数字发给你设置的模型，不发明细；随时可以在设置里关掉").font(.footnote)
                        Button("打开 AI 分析") { Task { await page.analyze(scope,enable:true,app:app) } }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("health.analysisEnable."+scope)
                    }
                    if let error=page.analysisErrors[scope] {
                        Text(error).font(.footnote)
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
                Text(series?.points.last?.label ?? "看看它相对你平时的变化").font(.title2.bold())
                Text(number(series?.points.last?.value)+unit(id)).font(.largeTitle.bold())
                if let low=series?.points.last?.low, let high=series?.points.last?.high {
                    Text("你平时的范围 "+number(low)+" — "+number(high)).foregroundStyle(.secondary)
                    Gauge(value:series?.points.last?.value ?? low,in:min(low,series?.points.last?.value ?? low)...max(high,low+0.1,series?.points.last?.value ?? high)) { Text("相对平时的位置") }.tint(Weave.accent)
                } else { Text("再戴几天就有对比了").foregroundStyle(.secondary) }
                Picker("时间范围",selection:$days) { ForEach([7,14,30,60],id:\.self) { Text("\($0) 天").tag($0) } }.pickerStyle(.segmented).accessibilityIdentifier("health.range")
                if loading { ProgressView("正在读取变化…") }
                HealthTrendChart(series:series,overlay:overlays ? overlay : nil,compact:false).accessibilityIdentifier("health.trend")
                Text("灰色是你常见的范围，虚线是这段时间的平均；按住图表可以看某一天。").font(.footnote).foregroundStyle(.secondary)
                Toggle("叠加深夜使用时长",isOn:$overlays).accessibilityIdentifier("health.overlay")
                if overlays { Text("淡色柱按这段时间最长的深夜使用分钟缩放，显示变化关联。").font(.footnote).foregroundStyle(.secondary) }
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
                        LineMark(x:.value("日期",i),y:.value("数值",v)).foregroundStyle(Weave.accent)
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
            if !compact,let selected,points.indices.contains(selected) { Text((points[selected].day.map(DeviceDateText.day) ?? "")+" · "+number(points[selected].value)).font(.callout).accessibilityIdentifier("health.selectedDay") }
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
            Text("再多读几项，页面才完整").font(.title2.bold())
            Text("心率变异性、呼吸、血氧、手腕温度、睡眠分期、最大摄氧量、身高体重和出生年份。只读不写，拒绝也能看已有的部分。")
            Button("继续",action:authorize).buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("health.expandAuthorize")
            Button("先看已有的",action:later).buttonStyle(OutlineActionStyle()).accessibilityIdentifier("health.expandLater")
        }.padding(AppleTokens.Space.p24).presentationDetents([.medium,.large]).presentationDragIndicator(.visible)
    }
}
