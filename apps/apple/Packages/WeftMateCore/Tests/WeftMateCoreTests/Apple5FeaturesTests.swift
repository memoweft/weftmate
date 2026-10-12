import Foundation
import Testing
@testable import WeftMateCore

@Test func apple5PageModelsFiltersAndSearchPreserveSources() throws {
    let page=try JSONDecoder().decode(PhoneLibraryPage.self,from:Data(#"{"items":[{"id":"one","fileName":"周末计划.MD","type":"document","size":1024,"createdAt":"2026-10-12T09:00:00Z","exists":true,"source":{"sessionId":"s","seq":7}},{"id":"two","fileName":"成本.csv","type":"spreadsheet","size":20,"createdAt":"2026-10-12T09:00:00Z","exists":false,"source":{"sessionId":"s"}}],"total":2,"hasMore":false,"revision":3}"#.utf8))
    #expect(PhoneFeaturePolicy.files(page.items,type:"document",search:"md").map(\.id) == ["one"])
    #expect(PhoneFeaturePolicy.files(page.items,type:"spreadsheet",search:"计划").isEmpty)
    #expect(page.items.first?.source.seq == 7)
    #expect(PhoneFeaturePolicy.size(20) == "20 字节")
    #expect(PhoneFeaturePolicy.size(1024) == "1.0 KB")
    let activity=try JSONDecoder().decode(PhoneActivity.self,from:Data(#"{"id":"a","at":"2026-10-12T09:00:00Z","type":"system.device_login","title":"新设备登录","summary":"合成手机已登录","source":{},"actions":[{"kind":"view_settings","label":"查看设备","target":{"category":"devices"}}],"state":"completed","read":false,"attentionRevision":2}"#.utf8))
    #expect(activity.actions.first?.target.category == "devices" && !activity.read)
    #expect(PhoneFeaturePolicy.supportedAction("respond_approval"))
    #expect(!PhoneFeaturePolicy.supportedAction("arbitrary_url"))
}
@Test func apple5DangerousActionsAndStateMapping() {
    #expect(PhoneFeaturePolicy.needsConfirmation(.delete))
    #expect(!PhoneFeaturePolicy.needsConfirmation(.pause) && !PhoneFeaturePolicy.needsConfirmation(.resume))
    #expect(PhoneFeaturePolicy.taskStatus("approval") == "等你批准")
    #expect(PhoneFeaturePolicy.taskStatus("unconfirmed") == "等待核对")
    #expect(PhoneFeaturePolicy.goalStatus("blocked") == "等待处理")
    #expect(PhoneFeaturePolicy.supported(["activity":1],"activity"))
    #expect(!PhoneFeaturePolicy.supported(["activity":2],"activity"))
    #expect(!PhoneFeaturePolicy.supported([:],"goals"))
}
@Test func apple5PreviewExportDoesNotExportMissingOrUnsupportedFiles() throws {
    let item=#""item":{"id":"f","fileName":"计划.md","type":"document","size":6,"createdAt":"2026-10-12T09:00:00Z","exists":true,"source":{}}"#
    let preview=try JSONDecoder().decode(PhoneLibraryPreview.self,from:Data(("{"+item+",\"kind\":\"markdown\",\"text\":\"计划\"}").utf8))
    #expect(preview.exportData == Data("计划".utf8))
    let missing=try JSONDecoder().decode(PhoneLibraryPreview.self,from:Data(("{"+item+",\"kind\":\"missing\",\"text\":\"old\"}").utf8))
    #expect(missing.exportData == nil)
}
@Test func apple5HealthUploadBoundsDowngradeAndProfileGating() throws {
    let v3=try JSONDecoder().decode(HealthCapabilities.self,from:Data(#"{"record":3,"profile":true}"#.utf8))
    let old=try JSONDecoder().decode(HealthCapabilities.self,from:Data(#"{"record":2}"#.utf8))
    #expect(HealthUploadPolicy.sendsProfile(v3) && !HealthUploadPolicy.sendsProfile(old) && !HealthUploadPolicy.sendsProfile(nil))
    var record=DailyHealth(steps:1234); record.version=3
    record.hrvSamples=[.init(time:"2026-10-12T09:00:00Z",sdnnMs:30)]; record.heartRateQuarterHourly=Array(repeating:nil,count:96)
    let down=HealthUploadPolicy.wireRecord(record,capabilities:old)
    #expect(down.version == 2 && down.hrvSamples == nil && down.heartRateQuarterHourly == nil)
    #expect(HealthUploadPolicy.wireRecord(record,capabilities:v3) == record)
    #expect(HealthUploadPolicy.validBytes(Data(count:64*1024),version:3))
    #expect(!HealthUploadPolicy.validBytes(Data(count:64*1024+1),version:3))
    #expect(!HealthUploadPolicy.validBytes(Data(count:12*1024+1),version:2))
    #expect(try !HealthUploadPolicy.validBatch([]))
    #expect(try !HealthUploadPolicy.validBatch([.init(day:"2026-10-12",health:record),.init(day:"2026-10-12",health:record)]))
    let hundred=(0..<100).map { HealthBatchItem(day:String($0),health:record) }
    #expect(try HealthUploadPolicy.validBatch(hundred))
    #expect(try !HealthUploadPolicy.validBatch(hundred+[.init(day:"100",health:record)]))
}

@Test func apple5FallbackAndPhoneSettingsUseFormalFields() throws {
    let preference=try JSONDecoder().decode(BackgroundModelPreference.self,from:Data(#"{"backgroundModelProfileId":null,"backgroundModelFallback":{"profileId":"old-model","at":"2026-10-12T09:00:00Z"}}"#.utf8))
    #expect(preference.backgroundModelProfileId == nil && preference.backgroundModelFallback?.profileId == "old-model")
    #expect(OperationNames.tool("health_query") == "查了健康数据")
    #expect(AppleSettingsRegistry.list(desktop:false).contains { $0.id == "healthData" })
    #expect(AppleSettingsRegistry.list(desktop:false).contains { $0.id == "system" })
    #expect(!AppleSettingsRegistry.list(desktop:true).contains { $0.id == "healthData" })
}
