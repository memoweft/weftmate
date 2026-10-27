// Seeds the real chat controller; only the model HTTP/SSE is controlled.
#if DEBUG && os(iOS) && targetEnvironment(simulator)
import Foundation
import WeftMateCore

@MainActor enum PhoneWindowUIFixture {
    static func configure(app: AppleAppModel) {
        let args = ProcessInfo.processInfo.arguments
        guard Bundle.main.bundleIdentifier == AppleStorageProfile.windowBundleID,
              args.contains("--ui-testing"), args.contains("--phone-window-chat-fixture"),
              let value = ProcessInfo.processInfo.environment["WEFTMATE_PHONE_WINDOW_MODEL_URL"],
              let url = URL(string: value), url.scheme == "http", url.host == "127.0.0.1",
              let port = url.port, (1024...65535).contains(port) else { return }
        app.phoneChat.activate(app: app)
        do {
            try app.phoneChat.saveModel(PhoneModelConfiguration(id: "window-synthetic-model", name: "合成聊天模型",
                baseURL: url.absoluteString, model: "synthetic-stream", apiKey: "synthetic-state-key"))
            record(models: app.phoneChat.models.count, error: nil)
        } catch {
            record(models: app.phoneChat.models.count, error: String(describing: error))
            app.phoneChat.notice = "测试模型没能保存，请查看本次测试记录。"
        }
    }
    private static func record(models: Int, error: String?) {
        let payload: [String: Any] = ["models": models, "error": error ?? ""]
        guard let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("window-fixture.json") else { return }
        try? JSONSerialization.data(withJSONObject: payload).write(to: file, options: .atomic)
    }
}
#endif
