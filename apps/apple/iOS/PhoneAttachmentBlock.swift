import SwiftUI

/// Shared shape for the draft and the sent message; it does not own upload/preview state.
struct PhoneAttachmentBlock: View {
    var name: String
    var image: URL?
    var isImage: Bool
    var status: String? = nil
    var remove: (() -> Void)?
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
            if isImage, let image, let content=UIImage(contentsOfFile:image.path) {
                Image(uiImage:content).resizable().scaledToFill().frame(width:AppleTokens.Space.p32*5,height:AppleTokens.Space.p64+AppleTokens.Space.p32).clipped()
            } else {
                WeftIcon(isImage ? "image" : "file",size:AppleTokens.Space.p32).frame(maxWidth:.infinity,minHeight:AppleTokens.Space.p64)
            }
            Text(name).font(AppleTokens.Fonts.caption).lineLimit(1).truncationMode(.middle).padding(.horizontal,AppleTokens.Space.p8)
            if let status { Text(status).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p8) }
        }.padding(.bottom,AppleTokens.Space.p8).frame(width:AppleTokens.Space.p32*5,alignment:.leading)
            .background(Weave.surface,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r16))
            .overlay(RoundedRectangle(cornerRadius:AppleTokens.Radius.r16).strokeBorder(Weave.line))
            .clipShape(RoundedRectangle(cornerRadius:AppleTokens.Radius.r16))
            .overlay(alignment:.topTrailing) {
                if let remove { Button(action:remove) { WeftIcon("deny",size:AppleTokens.Space.p16) }.buttonStyle(PhoneIconStyle(onCard:true)).accessibilityLabel("移除 "+name).accessibilityIdentifier("attachment.remove."+name) }
            }
    }
}
