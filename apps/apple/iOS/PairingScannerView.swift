#if os(iOS)
import SwiftUI
import VisionKit
import Vision
import CoreImage
import PhotosUI

struct PairingScannerView: View {
    let receive: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var image: PhotosPickerItem?
    @State private var error: String?
    var body: some View {
        NavigationStack {
            VStack(spacing: AppleTokens.Space.p18) {
                Text("扫描电脑上刚生成的 WeftMate 配对二维码").padding()
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    CameraScanner(receive: receive)
                } else {
                    EmptyState(symbol: "camera", title: "相机扫描暂不可用", message: "可选择二维码图片，或返回输入配对码。")
                }
                PhotosPicker("选择二维码图片", selection: $image, matching: .images).accessibilityIdentifier("pairingImagePicker")
                if let error { Text(error).foregroundStyle(AppleTokens.Colors.red) }
            }
            .navigationTitle("扫码配对")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
            .onChange(of: image) { _, value in
                Task {
                    do {
                        guard let bytes = try await value?.loadTransferable(type: Data.self) else { return }
                        receive(try PairingQRDecoder.decode(bytes))
                    } catch { self.error = "没有找到有效的配对二维码，请重新选择。" }
                }
            }
        }
    }
}

/// Shared by image picker and simulator synthetic-image acceptance.
enum PairingQRDecoder {
    static func decode(_ bytes: Data) throws -> Data {
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
    func makeCoordinator() -> Coordinator { Coordinator(receive: receive) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
            recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true,
            isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }
    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}
    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) { scanner.stopScanning() }
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let receive: (Data) -> Void
        private var handled = false
        init(receive: @escaping (Data) -> Void) { self.receive = receive }
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
