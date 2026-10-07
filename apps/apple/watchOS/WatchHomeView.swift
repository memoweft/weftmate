import SwiftUI
import WeftMateCore

struct WatchHomeView: View {
    @State private var identity: DeviceIdentity?
    @State private var identityError = false
    private let accent = Color(red: 0.50, green: 0.65, blue: 1)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Image("WeftMateSpiritMaster")
                        .resizable().scaledToFit()
                        .frame(width: 76, height: 76)
                        .accessibilityHidden(true)
                    Text("话题，随身接续。")
                        .font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    Label("尚未连接账户", systemImage: "person.crop.circle.badge.questionmark")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("手表登录和手机同步尚未接通。当前没有发送任务或接收对话。")
                        .font(.caption).foregroundStyle(.secondary).lineSpacing(3)
                    if identityError {
                        Label("无法保存本机身份，请检查钥匙串访问。", systemImage: "exclamationmark.circle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    NavigationLink {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("这块手表的身份").font(.headline)
                            Text(identity?.identifier ?? "尚未保存")
                                .font(.caption.monospaced())
                            Text("这是这块手表的本机身份，目前尚未登记到服务器。")
                                .font(.caption).foregroundStyle(.secondary)
                        }.padding(12)
                    } label: {
                        Label("本机身份", systemImage: "applewatch")
                    }
                    .disabled(identity == nil)
                    .accessibilityIdentifier("watchIdentityButton")
                }
                .padding(.horizontal, 8).padding(.vertical, 8)
            }
            .navigationTitle("WeftMate")
        }
        .tint(accent)
        .task {
            do { identity = try DeviceIdentity.load(platform: .watchOS) }
            catch { identityError = true }
        }
        .accessibilityIdentifier("watchHome")
    }
}
