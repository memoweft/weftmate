import Testing
@testable import WeftMateCore

@Test func apple5FixFooterReservationTracksComposerNavigationAndKeyboard() {
    #expect(PhoneChatViewport.reservedBottom(composer:76,navigation:68,gap:12)==156)
    #expect(PhoneChatViewport.reservedBottom(composer:148,navigation:68,gap:12)==228)
    #expect(PhoneChatViewport.reservedBottom(composer:280,navigation:0,gap:12)==292)
}
@Test func apple5FixDecisionNoticeOnlyWhenCardIsOutsideViewport() {
    #expect(!PhoneChatViewport.showsDecisionNotice(pending:true,top:100,bottom:400,height:440))
    #expect(!PhoneChatViewport.showsDecisionNotice(pending:true,top:-100,bottom:200,height:440))
    #expect(PhoneChatViewport.showsDecisionNotice(pending:true,top:440,bottom:700,height:440))
    #expect(PhoneChatViewport.showsDecisionNotice(pending:true,top:-400,bottom:0,height:440))
    #expect(!PhoneChatViewport.showsDecisionNotice(pending:false,top:nil,bottom:nil,height:440))
}
@Test func apple5FixBottomRequiresVisibleEndAndCompleteLastCard() {
    #expect(PhoneChatViewport.atBottom(lastTop:50,lastBottom:420,endTop:430,endBottom:431,height:440))
    #expect(PhoneChatViewport.atBottom(lastTop:50,lastBottom:440,endTop:455,endBottom:456,height:440))
    #expect(!PhoneChatViewport.atBottom(lastTop:50,lastBottom:470,endTop:480,endBottom:481,height:440))
    #expect(!PhoneChatViewport.atBottom(lastTop:-10,lastBottom:320,endTop:430,endBottom:431,height:440))
    #expect(PhoneChatViewport.atBottom(lastTop:-500,lastBottom:420,endTop:430,endBottom:431,height:440))
}
