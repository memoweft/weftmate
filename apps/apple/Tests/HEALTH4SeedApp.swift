import SwiftUI
import HealthKit

@main struct HEALTH4SeedApp: App { var body: some Scene { WindowGroup { Health4SeedView() } } }
private enum SeedCallbacks {
    nonisolated static func added(_ c: CheckedContinuation<Void, any Error>) -> @Sendable (Bool,(any Error)?) -> Void {
        { @Sendable ok,error in if let error { c.resume(throwing:error) } else if ok { c.resume() } else { c.resume(throwing:URLError(.unknown)) } }
    }
    nonisolated static func finished(_ c: CheckedContinuation<HKHeartbeatSeriesSample?, any Error>) -> @Sendable (HKHeartbeatSeriesSample?,(any Error)?) -> Void {
        { @Sendable values,error in if let error { c.resume(throwing:error) } else { c.resume(returning:values) } }
    }
}
private struct Health4SeedView: View {
    @State private var result="Ready"
    @State private var written: [HKSample]=[]
    var body: some View {
        VStack(spacing:24) {
            Button("写入九十天合成样本") { Task { await seed() } }.accessibilityIdentifier("health4.seed")
            Button("清除合成样本") { Task { await cleanup() } }.accessibilityIdentifier("health4.cleanup")
            Text(result).accessibilityIdentifier("health4.seedResult")
        }
    }
    @MainActor private func cleanup() async {
        #if targetEnvironment(simulator)
        guard ProcessInfo.processInfo.arguments.contains("--health4-synthetic") else { return }
        let store=HKHealthStore()
        let ids: [HKQuantityTypeIdentifier]=[.stepCount,.restingHeartRate,.activeEnergyBurned,.heartRate,.heartRateVariabilitySDNN,.respiratoryRate,.oxygenSaturation,.vo2Max,.height,.bodyMass]
        for type in Set<HKSampleType>(ids.compactMap { HKObjectType.quantityType(forIdentifier:$0) }+[HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!,HKObjectType.workoutType(),HKSeriesType.heartbeat()]) {
            _ = try? await store.deleteObjects(of:type,predicate:HKQuery.predicateForObjects(from:HKSource.default()))
        }
        result="CLEAN"
        #endif
    }
    @MainActor private func seed() async {
        #if targetEnvironment(simulator)
        guard ProcessInfo.processInfo.arguments.contains("--health4-synthetic") else { return }
        let store=HKHealthStore()
        let ids: [HKQuantityTypeIdentifier]=[.stepCount,.restingHeartRate,.activeEnergyBurned,.heartRate,.heartRateVariabilitySDNN,.respiratoryRate,.oxygenSaturation,.vo2Max,.height,.bodyMass]
        let types=Set<HKSampleType>(ids.compactMap { HKObjectType.quantityType(forIdentifier:$0) }+[HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!,HKObjectType.workoutType(),HKSeriesType.heartbeat()])
        do {
            try await store.requestAuthorization(toShare:types,read:[])
            await cleanup()
            var c=Calendar(identifier:.gregorian); c.timeZone=TimeZone.current
            let today=c.startOfDay(for:Date()); var samples: [HKSample]=[]
            func q(_ id: HKQuantityTypeIdentifier,_ v: Double,_ unit: HKUnit,_ date: Date) {
                samples.append(HKQuantitySample(type:HKQuantityType(id),quantity:HKQuantity(unit:unit,doubleValue:v),start:date,end:date.addingTimeInterval(1)))
            }
            for offset in -89...0 where offset != -20 {
                let day=c.date(byAdding:.day,value:offset,to:today)!
                let night=day.addingTimeInterval(-2*3600), wake=day.addingTimeInterval(6*3600)
                let sleep=HKObjectType.categoryType(forIdentifier:.sleepAnalysis)!
                for (stage,a,b) in [(HKCategoryValueSleepAnalysis.inBed,-2.0,6.0),(.asleepDeep,-2,-1),(.asleepREM,-1,0),(.awake,0,0.5),(.asleepCore,0.5,6)] {
                    samples.append(HKCategorySample(type:sleep,value:stage.rawValue,start:day.addingTimeInterval(a*3600),end:day.addingTimeInterval(b*3600)))
                }
                // An identical overlapping core source must not add minutes.
                samples.append(HKCategorySample(type:sleep,value:HKCategoryValueSleepAnalysis.asleepCore.rawValue,start:day.addingTimeInterval(3600),end:wake))
                q(.stepCount,1234,.count(),day.addingTimeInterval(7*3600))
                q(.restingHeartRate,60,.count().unitDivided(by:.minute()),day.addingTimeInterval(7*3600))
                q(.activeEnergyBurned,200,.kilocalorie(),day.addingTimeInterval(7*3600))
                q(.respiratoryRate,16,.count().unitDivided(by:.minute()),day.addingTimeInterval(3*3600))
                q(.oxygenSaturation,0.98,.percent(),day.addingTimeInterval(3*3600))
                q(.vo2Max,42,HKUnit(from:"ml/kg*min"),day.addingTimeInterval(7*3600))
                let measure=day.addingTimeInterval(2*3600)
                q(.heartRateVariabilitySDNN,50,.secondUnit(with:.milli),measure)
                q(.heartRateVariabilitySDNN,30,.secondUnit(with:.milli),day.addingTimeInterval(7*3600))
                let builder=HKHeartbeatSeriesBuilder(healthStore:store,device:nil,start:measure)
                var elapsed=0.0
                for index in 0...40 {
                    if index > 0 { elapsed += index%2 == 1 ? 1 : 1.1 }
                    let time=elapsed
                    try await withCheckedThrowingContinuation { continuation in builder.addHeartbeatWithTimeInterval(sinceSeriesStartDate:time,precededByGap:false,completion:SeedCallbacks.added(continuation)) }
                }
                let beats: HKHeartbeatSeriesSample?=try await withCheckedThrowingContinuation { c in builder.finishSeries(completion:SeedCallbacks.finished(c)) }
                if let beats { written.append(beats) }
                for (i,rate) in [100.0,120,140,160,180].enumerated() {
                    q(.heartRate,rate,.count().unitDivided(by:.minute()),day.addingTimeInterval(7*3600+Double(i)*60))
                }
                samples.append(HKWorkout(activityType:.running,start:day.addingTimeInterval(7*3600),end:day.addingTimeInterval(7*3600+300),duration:300,totalEnergyBurned:HKQuantity(unit:.kilocalorie(),doubleValue:30),totalDistance:nil,metadata:nil))
                _=night
            }
            q(.height,175,.meterUnit(with:.centi),today.addingTimeInterval(-86400))
            q(.bodyMass,70,.gramUnit(with:.kilo),today.addingTimeInterval(-86400))
            // The current day's future samples are omitted; past ninety days stay deterministic.
            samples=samples.filter { $0.endDate <= Date() }
            try await store.save(samples); written += samples; result="SAVED"
        } catch { result="FAILED: "+String(describing:error) }
        #endif
    }
}
