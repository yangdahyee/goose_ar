/**
 * WebXR AR with page buttons on top (dom-overlay) is a Chrome feature. Galaxy phones open links in Samsung Internet,
 * and links from chat apps open in the app's own web view; neither can run this page's AR properly.
 * Returns a short Korean tip for those browsers, or null for everything else.
 */
export function browserAdvice(ua: string): string | null {
  if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|\bLine\/|; wv\)/i.test(ua)) {
    return '앱 안에서 열린 화면은 AR이 안 돼요. 메뉴에서 "다른 브라우저로 열기"로 Chrome을 선택해 주세요.';
  }
  if (/SamsungBrowser/i.test(ua)) {
    return '삼성 인터넷에서는 AR 화면의 버튼이 안 보일 수 있어요. Chrome으로 열어 주세요.';
  }
  return null;
}
