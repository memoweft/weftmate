#if os(iOS)
import SwiftUI
import VisionKit
import Vision
import CoreImage
import PhotosUI
import AVFoundation

struct PairingScannerView: View {
    let receive: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var image: PhotosPickerItem?
    @State private var error: String?
    @State private var authorized = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    @State private var checkingPermission = false
    @State private var scannerRevision = UUID()
    var body: some View {
        NavigationStack {
            VStack(spacing: AppleTokens.Space.p18) {
                Text("扫描电脑上刚生成的 WeftMate 二维码").font(AppleTokens.Fonts.headline)
                Text("扫描后先核对电脑身份，确认后才会配对。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                if authorized && DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    CameraScanner(receive: receive, failure: { error = $0 }).id(scannerRevision)
                        .clipShape(RoundedRectangle(cornerRadius: AppleTokens.Phone.groupRadius)).frame(minHeight: 280)
                } else {
                    EmptyState(symbol: "camera", title: "相机扫描暂不可用", message: authorized ? "可选择二维码图片，或返回手动输入配对码。" : "请允许相机访问；也可以选二维码图片或返回手动输入。")
                    Button("允许使用相机") { Task { await requestCamera() } }.disabled(checkingPermission).accessibilityIdentifier("pairing.cameraPermission")
                    if AVCaptureDevice.authorizationStatus(for: .video) == .denied {
                        Link("打开系统设置", destination: URL(string: UIApplication.openSettingsURLString)!)
                    }
                }
                PhotosPicker("选择二维码图片", selection: $image, matching: .images).accessibilityIdentifier("pairingImagePicker")
                if let error { InlineNotice(message: error, isError: true); Button("重试相机") { Task { await requestCamera() } } }
            }
            .padding(AppleTokens.Space.p20).background(Weave.canvas).navigationTitle("扫描二维码")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
            .onChange(of: image) { _, value in
                Task {
                    do {
                        guard let bytes = try await value?.loadTransferable(type: Data.self) else { return }
                        receive(try PairingQRDecoder.decode(bytes))
                    } catch { self.error = "没有找到有效的二维码，请重新选择。" }
                }
            }
        }
    }
    private func requestCamera() async {
        checkingPermission = true
        authorized = await AVCaptureDevice.requestAccess(for: .video)
        checkingPermission = false
        if authorized { scannerRevision = UUID() }
        error = authorized ? nil : "相机权限未开启，可以返回手动输入配对码。"
    }

}

/// Shared by image picker and simulator synthetic-image acceptance.
enum PairingQRDecoder {
    static func decode(_ bytes: Data) throws -> Data {
        #if targetEnvironment(simulator)
        if let image=CIImage(data:bytes),let detector=CIDetector(ofType:CIDetectorTypeQRCode,context:CIContext(options:[.useSoftwareRenderer:true]),options:[CIDetectorAccuracy:CIDetectorAccuracyHigh]),
           let value=(detector.features(in:image).first as? CIQRCodeFeature)?.messageString {return Data(value.utf8)}
        #endif
        let request = VNDetectBarcodesRequest(); request.symbologies = [.qr]
        try? VNImageRequestHandler(data: bytes).perform([request])
        if let value = request.results?.first?.payloadStringValue { return Data(value.utf8) }
        // Some Intel simulator Vision runtimes cannot compile their barcode model. CoreImage can still decode the QR.
        if let image = CIImage(data: bytes),
           let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: CIContext(), options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]),
           let value = (detector.features(in: image).first as? CIQRCodeFeature)?.messageString { return Data(value.utf8) }
        throw CocoaError(.fileReadCorruptFile)
    }
}

private struct CameraScanner: UIViewControllerRepresentable {
    let receive: (Data) -> Void
    let failure: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(receive: receive, failure: failure) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
            recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true,
            isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        do { try scanner.startScanning() }
        catch { Task { @MainActor in failure("相机未能启动，请重试或选择二维码图片。") } }
        return scanner
    }
    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}
    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) { scanner.stopScanning() }
    @MainActor final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let receive: (Data) -> Void
        private var handled = false
        let failure: (String) -> Void
        init(receive: @escaping (Data) -> Void, failure: @escaping (String) -> Void) { self.receive = receive; self.failure = failure }
        func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            failure("相机扫描中断，请重试或选择二维码图片。")
        }
        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !handled else { return }
            for item in addedItems {
                if case .barcode(let code) = item, let value = code.payloadStringValue {
                    handled = true; scanner.stopScanning(); receive(Data(value.utf8)); return
                }
            }
        }
    }
}
#endif
