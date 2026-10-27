import Foundation
import ImageIO
import CoreGraphics
import PDFKit
import CoreText
import AppKit
import WeftMateCore

@main struct PhoneAttachmentModelChecks {
    @MainActor static func main() async { do { try await run() } catch { print("FAIL PhoneAttachmentModelChecks: \(error)");exit(1) } }
    @MainActor static func run() async throws {
        var count=0
        func unwrap<T>(_ value: T?,_ reason: String = "missing fixture/request value") throws -> T {
            guard let value else { throw NSError(domain:reason,code:1) };return value
        }
        func require(_ value: Bool,_ name: String) throws { guard value else { throw NSError(domain:name,code:1) };count+=1 }
        func failure(_ expected: PhoneAttachmentFailure,_ operation: () throws -> Void) throws {
            do { try operation();throw NSError(domain:"expected rejection",code:1) } catch let error as PhoneAttachmentFailure { try require(error == expected,"file rejection \(expected)") }
        }
        func wait(_ model: PhoneStandaloneModel) async throws {
            for _ in 0..<200 { if !model.busy { return };try await Task.sleep(for:.milliseconds(20)) };throw NSError(domain:"request timeout",code:1)
        }
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        let process=Process(),pipe=Pipe();process.executableURL=URL(fileURLWithPath:"/usr/bin/env")
        process.arguments=["node",URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_attachment_state_server.mjs").path];process.standardOutput=pipe
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var line=Data();while true { let byte=pipe.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw NSError(domain:"fixture start",code:1) };if byte == Data([10]) { break };line.append(byte) }
        let ready=try unwrap(JSONSerialization.jsonObject(with:line) as? [String:String]),origin=try unwrap(ready["origin"])
        let context=try unwrap(CGContext(data:nil,width:3200,height:2400,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red:0.2,green:0.6,blue:0.8,alpha:1));context.fill(CGRect(x:0,y:0,width:3200,height:2400))
        let png=NSMutableData(),destination=try unwrap(CGImageDestinationCreateWithData(png,"public.png" as CFString,1,nil))
        CGImageDestinationAddImage(destination,try unwrap(context.makeImage()),nil);guard CGImageDestinationFinalize(destination) else { throw NSError(domain:"synthetic image",code:1) }
        let image=try PhoneAttachmentInput.image(png as Data,name:"合成色块.png")
        let source=try unwrap(CGImageSourceCreateWithData(image.data as CFData,nil)),properties=try unwrap(CGImageSourceCopyPropertiesAtIndex(source,0,nil)) as NSDictionary
        try require(image.contentType == "image/jpeg" && image.data.count <= PhoneAttachment.imageBytes,"normalized bounded JPEG")
        try require(unwrap(properties[kCGImagePropertyPixelWidth] as? Int) <= 2048 && unwrap(properties[kCGImagePropertyPixelHeight] as? Int) <= 2048,"long edge bound")
        let file=try PhoneAttachmentInput.file(Data("虚构记录：三件任务已经完成。".utf8),name:"虚构记录.md",remainingText:PhoneAttachment.textUnits)
        let fileText=try unwrap(file.text)
        let long=try PhoneAttachmentInput.file(Data(String(repeating:"合成资料",count:10000).utf8),name:"long.log",remainingText:32000)
        try require(long.truncated && unwrap(long.text).utf16.count <= 32000,"text prefix and label")
        try failure(.unsupported) { _=try PhoneAttachmentInput.file(Data("Office".utf8),name:"sheet.xlsx",remainingText:32000) }
        try failure(.tooLarge) { _=try PhoneAttachmentInput.file(Data(repeating:0,count:PhoneAttachment.fileBytes+1),name:"large.txt",remainingText:32000) }
        try failure(.unreadableText) { _=try PhoneAttachmentInput.file(Data([0,0,0]),name:"bad.txt",remainingText:32000) }
        let pdf=NSMutableData(),consumer=try unwrap(CGDataConsumer(data:pdf as CFMutableData))
        var rect=CGRect(x:0,y:0,width:300,height:300)
        let pdfContext=try unwrap(CGContext(consumer:consumer,mediaBox:&rect,nil))
        for _ in 0..<31 {
            pdfContext.beginPDFPage(nil);pdfContext.textPosition=CGPoint(x:20,y:150)
            let attrs=[NSAttributedString.Key(kCTFontAttributeName as String):CTFontCreateWithName("Helvetica" as CFString,14,nil)]
            CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string:"Synthetic PDF readable words",attributes:attrs)),pdfContext);pdfContext.endPDFPage()
        }
        pdfContext.closePDF()
        let document=try PhoneAttachmentInput.file(pdf as Data,name:"synthetic.pdf",remainingText:32000)
        try require(document.truncated && unwrap(document.text).contains("Synthetic PDF"),"PDFKit extraction and page bound")
        let blank=PDFDocument();blank.insert(try unwrap(PDFPage(image:NSImage(cgImage:try unwrap(context.makeImage()),size:NSSize(width:320,height:240)))),at:0)
        try failure(.unreadablePDF) { _=try PhoneAttachmentInput.file(unwrap(blank.dataRepresentation()),name:"scan.pdf",remainingText:32000) }
        let app=AppleAppModel(directory:root),keys=PhoneCheckCredentials(),model=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
        model.activate(app:app)
        try require(model.attachmentReason != nil,"no model no empty plus menu")
        try model.saveModel(.init(name:"Synthetic",baseURL:origin+"/v1",model:"synthetic",apiKey:"synthetic-key"))
        model.draft="这是什么？总结文件。";model.addAttachment(image);model.addAttachment(file)
        let restore=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);restore.activate(app:app)
        try require(restore.draft == model.draft && restore.attachments == model.attachments,"encrypted draft restore")
        model.send();try await wait(model)
        try require(model.messages.last?.text == "合成模型已收到图片和文件。" && model.attachments.isEmpty,"SSE attachment send")
        let (data,_)=try await URLSession.shared.data(from:unwrap(URL(string:origin+"/report")))
        let requests=try unwrap(JSONSerialization.jsonObject(with:data) as? [[String:Any]])
        let messages=try unwrap(unwrap(requests.first)["messages"] as? [[String:Any]])
        let parts=try unwrap(unwrap(messages.last)["content"] as? [[String:Any]])
        let imagePart=try unwrap(unwrap(parts.first {$0["type"] as? String == "image_url"})["image_url"] as? [String:String])
        let transmitted=try unwrap(Data(base64Encoded:String(unwrap(unwrap(imagePart["url"]).split(separator:",").last))))
        try require(transmitted == image.data && transmitted.count <= PhoneAttachment.imageBytes,"actual HTTP image bytes and shape")
        try require(parts.contains {($0["text"] as? String)?.contains(fileText) == true},"actual HTTP file text")
        try require(requests.count == 1 && requests.allSatisfy { $0["stream"] as? Bool == true },"attachment chat has no extraction side request")
        model.draft="";model.addAttachment(file);model.send();try await wait(model)
        try require(model.messages.filter {$0.role == "user"}.last?.text == "","attachment-only send")
        model.newThread();try model.saveModel(.init(name:"Reject",baseURL:origin+"/v1",model:"reject-images",apiKey:"synthetic-key"))
        model.draft="保留我的草稿";model.addAttachment(image);model.addAttachment(file);model.send();try await wait(model)
        try require(model.notice == PhoneAttachmentFailure.vision.message && model.draft == "保留我的草稿" && model.attachments.count == 2 && model.messages.isEmpty,"vision rejection restores without duplicate message")
        app.cloudLogin.subject="account-b";model.activate(app:app)
        try require(model.attachments.isEmpty && model.draft.isEmpty,"account isolation")
        app.cloudLogin.subject="account-a";model.activate(app:app)
        try require(model.attachments.count == 2 && model.draft == "保留我的草稿","account return retains draft bytes")
        let plain=PhoneModelConfiguration(name:"Text",baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1",model:"qwen-plus",apiKey:"fake")
        try require(plain.supportsImages == false && PhoneModelConfiguration(name:"Custom",baseURL:"https://custom.example/v1",model:"qwen-plus",apiKey:"fake").supportsImages == nil,"known preset versus custom capability")
        model.removeAttachment(image.id);model.removeAttachment(file.id)
        for _ in 0..<5 { model.addAttachment(image) }
        try require(model.attachments.count == 4 && model.notice == PhoneAttachmentFailure.tooMany.message,"four image cap")
        for _ in 0..<4 { model.addAttachment(file) }
        try require(model.attachments.count == 7 && model.notice == PhoneAttachmentFailure.tooMany.message,"three file cap")
        var imageHistory: [PhoneChatMessage]=[]
        for _ in 0..<6 { var item=PhoneChatMessage(role:"user",text:"synthetic");item.attachments=[image,long];imageHistory.append(item) }
        let bounded=try unwrap(model.currentModel).attachmentRequest(messages:imageHistory,system:"synthetic",stream:true,allowLoopback:true)
        let boundedBody=try unwrap(JSONSerialization.jsonObject(with:unwrap(bounded.httpBody)) as? [String:Any])
        let boundedMessages=try unwrap(boundedBody["messages"] as? [[String:Any]])
        let boundedParts=boundedMessages.flatMap {$0["content"] as? [[String:Any]] ?? []}
        try require(boundedParts.filter {$0["type"] as? String == "image_url"}.count == 4,"whole request image cap across history")
        try require(boundedParts.compactMap {$0["text"] as? String}.filter {$0.contains("合成资料")}.reduce(0) {$0+$1.utf16.count} < 32500,"whole request file text budget across history")
        var thread=PhoneChatThread(),message=PhoneChatMessage(role:"user",text:"我喜欢茶")
        message.attachments=[image,file];thread.messages=[message]
        try require(PhoneAttachment.prefix("a😀b",units:2) == "a","UTF16 cutoff preserves Unicode boundary")
        try failure(.textLimit) { _=try PhoneAttachmentInput.file(Data("文件文字".utf8),name:"cap.txt",remainingText:0) }
        var state=restore.state;state.threads=[thread];let turns=state.prepareMigration(host:"synthetic",generation:1)
        let firstTurn=try unwrap(turns.first),firstMessage=try unwrap(firstTurn.messages.first)
        try require(firstMessage.text.contains("原件在手机上") && !firstMessage.text.contains(fileText) && !firstMessage.text.contains(image.data.base64EncodedString()),"text-only handoff placeholders")
        let frozen=firstMessage.text;state.threads[0].messages[0].attachments=[]
        try require(unwrap(unwrap(state.prepareMigration(host:"synthetic",generation:1).first).messages.first).text == frozen,"handoff body frozen")
        func scanFiles() throws -> Int {
        var hits=0
        for case let url as URL in try unwrap(FileManager.default.enumerator(at:root,includingPropertiesForKeys:[.isRegularFileKey])) where (try url.resourceValues(forKeys:[.isRegularFileKey])).isRegularFile == true {
            let bytes=try Data(contentsOf:url)
            for marker in [image.data,Data(fileText.utf8),Data("保留我的草稿".utf8)] { if bytes.range(of:marker) != nil { hits+=1 } }
        }
        return hits
        }
        let hits=try scanFiles()
        try require(hits == 0,"no plaintext attachment/draft files")
        model.clearLocalData();let cleared=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);cleared.activate(app:app)
        try require(cleared.messages.isEmpty && cleared.attachments.isEmpty && cleared.models.isEmpty,"clear removes bytes and keys")
        print("PASS PhoneAttachmentModelChecks: \(count) assertions; real local HTTP/SSE; plaintext hits \(hits); no cloud, GUI or simulator")
    }
}
