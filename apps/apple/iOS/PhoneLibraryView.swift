import SwiftUI
import WeftMateCore
import PDFKit

struct PhoneLibraryView: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneFeaturesModel()
    @State private var selected: PhoneLibraryItem?
    var body: some View {
        Group {
            ScrollView {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    HStack { WeftIcon("search"); TextField("搜索文件名",text:$model.search).textFieldStyle(.plain).onSubmit { reload() }.accessibilityIdentifier("library.search"); Button("搜索") { reload() }.buttonStyle(OutlineActionStyle()) }.phoneCard()
                    Picker("文件类型",selection:$model.type) { Text("全部").tag(""); ForEach(["document","spreadsheet","image","code","other"],id:\.self) { type in Text(PhoneFeaturePolicy.fileType(type)).tag(type) } }.pickerStyle(.menu).accessibilityIdentifier("library.filter")
                    PhonePageState(loading:model.loading,error:model.errors["library"],empty:model.files.isEmpty,title:"还没有成果文件",message:"WeftMate 做好的文档、图片和其他文件会出现在这里。") { reload() }
                    ForEach(model.files) { row in
                        HStack(alignment:.top) {
                            Button { selected=row } label: {
                                VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                    Text(row.fileName).font(AppleTokens.Fonts.headline)
                                    Text(PhoneFeaturePolicy.fileType(row.type)+" · "+PhoneFeaturePolicy.size(row.size)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                                    Text(row.exists ? phoneFeatureTime(row.createdAt) : "已不在原位置").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                                }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityIdentifier("library.row."+row.id)
                            Menu { Button("预览") { selected=row }; Button("打开来源对话") { Task { await openSource(row) } } } label: { WeftIcon("more").phoneMenuLabel(circle:true,onCard:true) }.accessibilityLabel("成果操作")
                        }.phoneCard()
                    }
                    if model.nextLibrary != nil { Button("查看更多成果") { Task { await model.read("library",app:app,more:true) } }.disabled(model.loading) }
                }.padding(AppleTokens.Space.p16)
            }.background(Weave.canvas).navigationTitle("成果库").toolbar { PhoneAccountMenu(model:app) }
                .task(id:app.accountEpoch) { model.prepare(app); selected=nil; await model.read("library",app:app) }
                .refreshable { await model.read("library",app:app) }
                .onChange(of:model.type) { _,_ in reload() }
                .task(id:app.phoneLibrarySelection) {
                    guard let id=app.phoneLibrarySelection else { return }; let epoch=app.accountEpoch
                    if let result=try? await app.assistantClient.phoneLibraryDetail(id), epoch == app.accountEpoch { selected=result.item }
                    if epoch == app.accountEpoch { app.phoneLibrarySelection=nil }
                }
                .fullScreenCover(item:$selected) { row in PhoneLibraryPreviewView(app:app,item:row,openSource:{ Task { await openSource(row) }; selected=nil }) }
        }
    }
    private func reload() { Task { await model.read("library",app:app) } }
    private func openSource(_ row: PhoneLibraryItem) async {
        let epoch=app.accountEpoch
        do { let result=try await app.assistantClient.phoneLibraryDetail(row.id); guard epoch == app.accountEpoch else { return }; await model.open(result.item.source,app:app) }
        catch { if epoch == app.accountEpoch { model.errors["library"]=PhoneFeaturePolicy.failure(error) } }
    }
}
private struct PhoneLibraryPreviewView: View {
    @ObservedObject var app: AppleAppModel
    var item: PhoneLibraryItem
    var openSource: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var preview: PhoneLibraryPreview?
    @State private var file: URL?
    @State private var error: String?
    @State private var loading=true
    var body: some View {
        ConversationAttachmentPreview(file:file,name:item.fileName,contentType:preview?.contentType ?? "text/plain",loading:loading,error:error,close:{ dismiss() },sourceAction:openSource)
.task(id:app.accountEpoch) {
            cleanup(); loading=true; let epoch=app.accountEpoch
            do {
                let value=try await app.assistantClient.phoneLibraryPreview(item.id)
                guard epoch == app.accountEpoch,!Task.isCancelled else { return }; preview=value
                if let data=value.exportData {
                    let directory=FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-library-"+UUID().uuidString)
                    try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
                    let name=URL(fileURLWithPath:item.fileName).lastPathComponent
                    let path=directory.appendingPathComponent(name.isEmpty ? "成果" : name)
                    try data.write(to:path,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]); file=path
                } else {
                    error=value.kind == "missing" ? "文件已不在原位置，可以回到来源对话查看。" : "这种文件暂时无法在手机预览，请在电脑上打开。"
                }
            } catch { if epoch == app.accountEpoch { self.error=PhoneFeaturePolicy.failure(error) } }
            if epoch == app.accountEpoch { loading=false }
        }.onDisappear { cleanup() }
    }
    private func cleanup() { if let file { try? FileManager.default.removeItem(at:file.deletingLastPathComponent()) }; file=nil; preview=nil; error=nil }
}
