import Foundation
import SwiftUI
import WeftMateCore

@MainActor
final class MacUpdateModel: ObservableObject {
    enum Phase {
        case idle
        case checking
        case updateAvailable(PublicMacRelease)
        case upToDate(PublicMacRelease)
        case localIsNewer(PublicMacRelease)
        case noCompatibleRelease
        case failure(String)
    }

    @Published private(set) var phase: Phase = .idle
    let architecture = PublicUpdateArchitecture.current
    private let version: String?
    private let build: String?
    private let client = PublicUpdateClient()
    private var checkTask: Task<Void, Never>?
    private var generation: UInt64 = 0

    init() {
        version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
    }

    var installedVersionDisplay: String {
        guard let version, !version.isEmpty, let build, !build.isEmpty else {
            return "无法读取本机版本"
        }
        return "\(version) / \(build)"
    }

    var checking: Bool {
        if case .checking = phase { return true }
        return false
    }

    var release: PublicMacRelease? {
        switch phase {
        case .updateAvailable(let release), .upToDate(let release), .localIsNewer(let release):
            return release
        default:
            return nil
        }
    }

    var downloadURL: URL {
        if case .updateAvailable(let release) = phase { return release.downloadURL }
        return PublicUpdateClient.macLandingURL
    }

    var downloadLabel: String {
        if case .updateAvailable = phase { return "下载新版 DMG" }
        return "查看 Mac 下载页"
    }

    var otherDevicesURL: URL { PublicUpdateClient.downloadsURL }

    func check() {
        guard checkTask == nil else { return }
        generation &+= 1
        let request = generation
        phase = .checking
        checkTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == request { self.checkTask = nil } }
            do {
                let installed = try PublicInstalledVersion(version: self.version, build: self.build)
                let result = try await self.client.check(installed: installed, architecture: self.architecture)
                guard self.generation == request, !Task.isCancelled else { return }
                switch result {
                case .updateAvailable(let release): self.phase = .updateAvailable(release)
                case .upToDate(let release): self.phase = .upToDate(release)
                case .localIsNewer(let release): self.phase = .localIsNewer(release)
                case .noCompatibleRelease: self.phase = .noCompatibleRelease
                }
            } catch {
                guard self.generation == request, !Task.isCancelled else { return }
                self.phase = .failure(Self.message(for: error))
            }
        }
    }

    func cancelCheck() {
        generation &+= 1
        checkTask?.cancel()
        checkTask = nil
        if checking { phase = .idle }
    }

    private static func message(for error: Error) -> String {
        guard let failure = error as? PublicUpdateFailure else {
            return "暂时无法检查更新，请稍后重试。"
        }
        switch failure {
        case .invalidInstalledVersion:
            return "无法读取本机版本，暂时不能比较更新。"
        case .network, .timeout:
            return "暂时无法连接官网，请稍后重试。"
        case .certificate:
            return "无法验证官网连接，请稍后重试。"
        case .cancelled:
            return "检查已取消，可以重新检查。"
        case .httpStatus:
            return "官网暂时无法响应，请稍后重试。"
        case .invalidManifest, .unsupportedSchema, .unsafeLink, .responseTooLarge, .redirect:
            return "官网更新信息暂时无法使用，请稍后重试。"
        }
    }
}
