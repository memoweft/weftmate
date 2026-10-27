import SwiftUI
import WeftMateCore
import PDFKit

struct PhoneLibraryView: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneFeaturesModel()
    @State private var selected: PhoneLibraryItem?
    private var groups: [String] {
        var result: [String]=[]
        for item in model.files { let day=phoneDateGroup(item.createdAt); if !result.contains(day) { result.append(day) } }
        return result
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                Text("做过的东西，随时找得到。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                HStack {
                    WeftIcon("search")
                    TextField("搜索文件名",text:$model.search).textFieldStyle(.plain).submitLabel(.search).onSubmit { reload() }.accessibilityIdentifier("library.search")
                    if !model.search.isEmpty { Button { model.search="";reload() } label: { WeftIcon("deny") }.accessibilityLabel("清空搜索") }
                }.padding(AppleTokens.Space.p12).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12))
                ScrollView(.horizontal,showsIndicators:false) {
                    HStack(spacing:AppleTokens.Space.p4) {
                        ForEach(["","document","spreadsheet","image","code","other"],id:\.self) { type in
                            Button { model.type=type } label: {
                                Text(type.isEmpty ? "全部" : PhoneFeaturePolicy.fileType(type)).font(AppleTokens.Fonts.callout)
                                    .padding(.horizontal,AppleTokens.Space.p12).frame(minHeight:AppleTokens.Space.p44)
                                    .background(model.type == type ? Weave.surface : .clear,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r10))
                            }.buttonStyle(.plain).accessibilityAddTraits(model.type == type ? .isSelected : []).accessibilityIdentifier("library.type."+(type.isEmpty ? "all" : type))
                        }
                    }.padding(AppleTokens.Space.p4)
                }.background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)).accessibilityIdentifier("library.filter")
                PhonePageState(loading:model.loading,error:model.errors["library"],empty:model.files.isEmpty,title:model.search.isEmpty && model.type.isEmpty ? "还没有成果文件" : "没有找到匹配的成果",message:model.search.isEmpty && model.type.isEmpty ? "做好的文档、图片和其他文件会出现在这里。" : "试试其他关键词，或把类型改成全部。") { reload() }
                ForEach(groups,id:\.self) { group in
                    PhoneSectionHeading(title:group)
                    VStack(spacing:0) {
                        ForEach(model.files.filter { phoneDateGroup($0.createdAt) == group }) { row in
                            Button { selected=row } label: {
                                PhoneFeatureRow(icon:row.type == "image" ? "image" : row.type == "code" ? "code" : "file",title:row.fileName,subtitle:PhoneFeaturePolicy.fileType(row.type)+" · "+PhoneFeaturePolicy.size(row.size)+(row.exists ? row.projectName.map { " · "+$0 } ?? "" : " · 已不在原位置"))
                            }.buttonStyle(.plain).accessibilityIdentifier("library.row."+row.id)
                            Divider()
                        }
                    }
                }
                if model.nextLibrary != nil { Button("查看更多成果") { Task { await model.read("library",app:app,more:true) } }.disabled(model.loading) }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("成果库").navigationBarTitleDisplayMode(.large)
            .task(id:app.accountEpoch) { model.prepare(app); selected=nil; await model.read("library",app:app) }
            .refreshable { await model.read("library",app:app) }
            .task(id:model.type) { await model.read("library",app:app) }
            .task(id:app.phoneLibrarySelection) {
                guard let id=app.phoneLibrarySelection else { return }; let epoch=app.accountEpoch
                do {
                    let result=try await app.assistantClient.phoneLibraryDetail(id)
                    guard epoch == app.accountEpoch,!Task.isCancelled else { return }; selected=result.item
                } catch { if epoch == app.accountEpoch { model.errors["library"]=PhoneFeaturePolicy.failure(error) } }
                if epoch == app.accountEpoch { app.phoneLibrarySelection=nil }
            }
            .navigationDestination(isPresented:Binding(get:{selected != nil},set:{if !$0 { selected=nil }})) {
                if let row=selected { PhoneLibraryDetailView(app:app,item:row) }
            }
    }
    private func reload() { Task { await model.read("library",app:app) } }
}

private struct PhoneLibraryDetailView: View {
    @ObservedObject var app: AppleAppModel
    let item: PhoneLibraryItem
    @Environment(\.phoneOpenConversation) private var openConversation
    @State private var preview: PhoneLibraryPreview?
    @State private var file: URL?
    @State private var error: String?
    @State private var loading=true
    @State private var exporting=false
    @State private var attempt=0
    private var current: PhoneLibraryItem { preview?.item ?? item }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(current.fileName).font(AppleTokens.Fonts.title.bold()).textSelection(.enabled)
                Text(PhoneFeaturePolicy.fileType(current.type)+" · "+PhoneFeaturePolicy.size(current.size)).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                if loading { ProgressView("正在读取成果…").frame(maxWidth:.infinity,minHeight:180) }
                if let file {
                    Group {
                        if preview?.contentType == "application/pdf" { PhonePDFPreview(file:file) }
                        else { NativeAttachmentPreview(file:file) }
                    }.frame(height:360).clipShape(RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)).accessibilityIdentifier("library.preview")
                    HStack {
                        Button { exporting=true } label: { WeftLabel("保存文件",icon:"download") }.buttonStyle(PrimaryActionStyle(fillsWidth:false)).accessibilityIdentifier("library.save")
                        Spacer()
                        ShareLink(item:file) { WeftLabel("分享",icon:"open") }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("library.share")
                    }
                }
                if let error {
                    InlineNotice(message:error,isError:true)
                    Button("重试") { attempt += 1 }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("library.retry")
                }
                PhoneSectionHeading(title:"这份成果")
                Text("创建于 "+phoneFeatureTime(current.createdAt)).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
                if let modified=current.modifiedAt { Text("最近修改 "+phoneFeatureTime(modified)).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted) }
                Button { openSource() } label: { PhoneFeatureRow(icon:"chat",title:"打开来源对话",subtitle:"查看生成过程") }.buttonStyle(.plain).accessibilityIdentifier("library.source")
                Divider()
                Text("历史版本以来源对话中的实际成果记录为准。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("成果详情").navigationBarTitleDisplayMode(.inline)
            .task(id:"\(app.accountEpoch)-\(attempt)") { await load() }
            .onDisappear { cleanup() }
            .fileExporter(isPresented:$exporting,item:file.map { AttachmentExport(file:$0) },contentTypes:[.data],defaultFilename:current.fileName,onCompletion:{ @Sendable result in Task { @MainActor in if case .failure = result { error="文件未保存，请重试。" } } },onCancellation:{})
            .accessibilityIdentifier("library.detail")
    }
    private func openSource() { Task { await PhoneFeaturesModel().open(current.source,app:app,navigate:openConversation) } }
    private func load() async {
        cleanup();loading=true;let epoch=app.accountEpoch
        defer { if epoch == app.accountEpoch { loading=false } }
        do {
            let value=try await app.assistantClient.phoneLibraryPreview(item.id)
            guard epoch == app.accountEpoch,!Task.isCancelled else { return };preview=value
            if let data=value.exportData {
                let directory=FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-library-"+UUID().uuidString)
                try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
                let name=URL(fileURLWithPath:item.fileName).lastPathComponent
                let path=directory.appendingPathComponent(name.isEmpty ? "成果" : name)
                do { try data.write(to:path,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]);file=path }
                catch { try? FileManager.default.removeItem(at:directory);throw error }
            } else { error=value.kind == "missing" ? "文件已不在原位置，可以回到来源对话查看。" : "这种文件暂时无法在手机预览，请在来源对话或电脑上打开。" }
        } catch { if epoch == app.accountEpoch,!Task.isCancelled { self.error=PhoneFeaturePolicy.failure(error) } }
    }
    private func cleanup() {
        if let file { try? FileManager.default.removeItem(at:file.deletingLastPathComponent()) }
        file=nil;preview=nil;error=nil;exporting=false
    }
}
