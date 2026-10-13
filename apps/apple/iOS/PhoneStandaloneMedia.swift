import SwiftUI
import PhotosUI
import AVFoundation
import WeftMateCore

struct PhoneStandaloneCamera: UIViewControllerRepresentable {
    let complete: (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(complete:complete) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker=UIImagePickerController();picker.sourceType = .camera;picker.mediaTypes=["public.image"];picker.delegate=context.coordinator;return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    @MainActor final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let complete: (Data?) -> Void
        init(complete: @escaping (Data?) -> Void) { self.complete=complete }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { complete(nil) }
        func imagePickerController(_ picker: UIImagePickerController,didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey:Any]) { complete((info[.originalImage] as? UIImage)?.jpegData(compressionQuality:0.9)) }
    }
}
struct PhoneStandaloneAttachmentPreview: View {
    let attachment: PhoneAttachment
    let close: () -> Void
    var body: some View {
        // Reuse the full-screen viewer shell; the decrypted content stays in memory.
        ConversationAttachmentPreview(file:nil,name:attachment.name,contentType:attachment.contentType,loading:false,error:nil,close:close,memoryData:attachment.data,memoryText:attachment.text)
    }
}
