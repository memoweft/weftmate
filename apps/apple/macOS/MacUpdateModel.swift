import Foundation
import SwiftUI
import WeftMateCore

@MainActor final class MacUpdateModel: ObservableObject {
    @Published private(set) var statusText = "未配置更新源"
    @Published private(set) var checking = false
    @Published private(set) var release: NativeMacRelease?
    let architecture = PublicUpdateArchitecture.current
    private var checkTask: Task<Void, Never>?
    private let configuration: NativeUpdateConfiguration?
    private let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "未知"
    private let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "未知"
    init() {
        var info = Bundle.main.infoDictionary ?? [:]
        var loopback = false
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), let i = args.firstIndex(of: "--upd2-feed"), args.indices.contains(i + 1),
           let url = URL(string: args[i + 1]), url.scheme == "http", ["127.0.0.1", "localhost"].contains(url.host),
           let k = args.firstIndex(of: "--upd2-public-key"), args.indices.contains(k + 1) {
            info["WeftMateMacUpdateFeed"] = args[i + 1]
            info["WeftMateMacUpdatePublicKey"] = args[k + 1]
            loopback = true
        }
        #endif
        configuration = try? NativeUpdateConfiguration(feed: info["WeftMateMacUpdateFeed"] as? String,
            publicKey: info["WeftMateMacUpdatePublicKey"] as? String, channel: info["WeftMateMacUpdateChannel"] as? String ?? "stable", allowsLoopback: loopback)
        statusText = configuration?.statusText ?? "更新源配置无效"
    }
    var installedVersionDisplay: String { "\(version) / \(build)" }
    func check() {
        guard !checking else { return }
        release = nil
        guard let configuration else { statusText = "更新源配置无效"; return }
        guard configuration.feed != nil else { statusText = "未配置更新源"; return }
        guard configuration.publicKey?.count == 32 else { statusText = "更新源公钥未配置"; return }
        checking = true; statusText = "检查中"
        checkTask = Task { [weak self] in
            guard let self else { return }
            defer { self.checking = false; self.checkTask = nil }
            do {
                let data = try await NativeUpdateFetcher().fetch(configuration)
                let result = try SignedNativeUpdate.evaluate(data, configuration: configuration)
                try Task.checkCancellation()
                if try result.isNewer(than: self.version, build: self.build) {
                    self.release = result; self.statusText = "有新版本 \(result.version) / \(result.build)，请打开下载页"
                } else { self.statusText = "已是最新版本" }
            } catch {
                guard !Task.isCancelled else { self.statusText = configuration.statusText; return }
                self.statusText = error as? NativeUpdateFailure == .signature
                    ? "更新包签名校验未通过。请保留当前版本并联系维护者。" : "更新失败，请稍后重试。"
            }
        }
    }
    func cancelCheck() { checkTask?.cancel() }
}
