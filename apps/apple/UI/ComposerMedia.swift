import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit

@MainActor enum ComposerMedia {
    private static var screenshotProcess: Process?
    static func cancelScreenshot() { if let process = screenshotProcess, process.isRunning { process.terminate() } }
    static func clipboardImage() throws -> URL? {
        #if DEBUG
        if let file = syntheticFile { return file }
        #endif
        guard let image = NSImage(pasteboard: .general), let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .png, properties: [:]) else { return nil }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("clipboard-" + UUID().uuidString + ".png")
        try data.write(to: file); return file
    }
    static func screenshot() async throws -> URL? {
        #if DEBUG
        if let file = syntheticFile { return file }
        #endif
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("screenshot-" + UUID().uuidString + ".png")
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-i", "-s", "-x", file.path]
        screenshotProcess = process
        defer { if screenshotProcess === process { screenshotProcess = nil } }
        do {
            try process.run()
            while process.isRunning { try await Task.sleep(for: .milliseconds(100)) }
            guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: file.path) else { try? FileManager.default.removeItem(at: file); return nil }
            return file
        } catch { if process.isRunning { process.terminate() }; try? FileManager.default.removeItem(at: file); throw error }
    }
    #if DEBUG
    private static var syntheticFile: URL? {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), args.contains("--a15-synthetic-media") {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
            let data = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")!
            try? data.write(to: file); return file
        }
        guard args.contains("--ui-testing"), let i = args.firstIndex(of: "--a15-media"), args.indices.contains(i+1) else { return nil }
        let original = URL(fileURLWithPath: args[i+1])
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
        try? FileManager.default.copyItem(at: original, to: file); return file
    }
    #endif
}
#elseif os(iOS)
import UIKit
struct ComposerCamera: UIViewControllerRepresentable {
    let complete: (URL?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(complete: complete) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController(); picker.sourceType = .camera
        picker.mediaTypes = ["public.image"]; picker.delegate = context.coordinator; return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let complete: (URL?) -> Void
        init(complete: @escaping (URL?) -> Void) { self.complete = complete }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { complete(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let data = (info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.9) else { complete(nil); return }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("camera-" + UUID().uuidString + ".jpg")
            do { try data.write(to: file); complete(file) } catch { complete(nil) }
        }
    }
}
#endif
