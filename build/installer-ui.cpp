// UI only: NSIS remains responsible for files, registration and update behavior.
// Built as x86 because electron-builder's Unicode NSIS process is x86.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <tlhelp32.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cwctype>
#undef small

struct Palette { COLORREF canvas, ink, secondary, line, brand; };
#include "palette.h"
static HINSTANCE module;
static HICON mark;
static std::vector<std::pair<DWORD,HHOOK>> messageHooks;
static bool errorShown;
static bool english, dark;
static HWND installParent;
static LRESULT CALLBACK hiddenProc(HWND,UINT,WPARAM,LPARAM,UINT_PTR,DWORD_PTR);
static BOOL CALLBACK findProgress(HWND,LPARAM);
static const wchar_t* tr(const wchar_t* zh, const wchar_t* en) { return english ? en : zh; }
static const Palette& palette() { return dark ? DARK : LIGHT; }

struct Surface {
  HWND window{}, progress{}, primary{}, secondary{}, headingLabel{}, bodyLabel{};
  std::wstring title, body;
  int result{}, operation{}, percent{}, focus{};
  bool prompt{}, message{}, hoverPrimary{}, hoverSecondary{};
  UINT dpi{96};
  HBRUSH background{};
  HFONT heading{}, text{}, small{};
  int px(int x) const { return MulDiv(x, static_cast<int>(dpi), 96); }
};
static Surface* progressSurface;
static Surface* state(HWND h) { return reinterpret_cast<Surface*>(GetWindowLongPtr(h,GWLP_USERDATA)); }
static void text(HDC dc, Surface* s, const std::wstring& value, int x,int y,int w,int h, HFONT font,COLORREF color, UINT flags=DT_LEFT|DT_WORDBREAK|DT_NOPREFIX) {
  RECT rect{s->px(x),s->px(y),s->px(x+w),s->px(y+h)};
  auto old=SelectObject(dc,font); SetTextColor(dc,color); SetBkMode(dc,TRANSPARENT);
  DrawText(dc,value.c_str(),-1,&rect,flags); SelectObject(dc,old);
}
static void fill(HDC dc, const RECT& rect, COLORREF color) {
  HBRUSH brush=CreateSolidBrush(color); FillRect(dc,&rect,brush); DeleteObject(brush);
}
static void draw(Surface* s, HDC dc) {
  RECT rect; GetClientRect(s->window,&rect); fill(dc,rect,palette().canvas);
  DrawIconEx(dc,s->px(32),s->px(28),mark,s->px(36),s->px(36),0,nullptr,DI_NORMAL);
  text(dc,s,L"WeftMate",80,31,340,30,s->heading,palette().ink);
  text(dc,s,tr(L"同一个助手，陪你把事情做完。",L"One companion. From thought to done."),32,80,416,28,s->small,palette().secondary);
  text(dc,s,s->title,32,132,416,36,s->heading,palette().ink);
  text(dc,s,s->body,32,178,416,s->prompt?122:52,s->text,palette().secondary);
  if(!s->prompt) {
    RECT rail{s->px(32),s->px(250),s->px(448),s->px(256)};
    fill(dc,rail,palette().line);
    RECT bar=rail; bar.right=bar.left+MulDiv(rail.right-rail.left,std::max(2,s->percent),100); fill(dc,bar,palette().brand);
    text(dc,s,s->operation==2?tr(L"你的数据会保留，不会被删除",L"Your data stays on this computer"):tr(L"完成后会自动打开程序",L"The app will open when ready"),32,275,350,26,s->small,palette().secondary);
    text(dc,s,std::to_wstring(s->percent)+L"%",394,275,54,26,s->small,palette().secondary,DT_RIGHT|DT_NOPREFIX);
  }
}
static void drawButton(Surface* s, const DRAWITEMSTRUCT* item) {
  if(item->CtlType==ODT_STATIC) {
    fill(item->hDC,item->rcItem,palette().canvas);
    bool heading=item->hwndItem==s->headingLabel;
    auto old=SelectObject(item->hDC,heading?s->heading:s->text);
    SetTextColor(item->hDC,heading?palette().ink:palette().secondary);SetBkMode(item->hDC,TRANSPARENT);
    RECT r=item->rcItem;auto& caption=heading?s->title:s->body;
    DrawText(item->hDC,caption.c_str(),-1,&r,DT_LEFT|DT_WORDBREAK|DT_NOPREFIX);SelectObject(item->hDC,old);return;
  }
  bool primary=item->hwndItem==s->primary;
  bool hover=primary?s->hoverPrimary:s->hoverSecondary;
  bool disabled=(item->itemState&ODS_DISABLED)!=0, pressed=(item->itemState&ODS_SELECTED)!=0;
  auto p=palette(); COLORREF color=primary?p.ink:p.canvas;
  fill(item->hDC,item->rcItem,p.canvas);
  if(hover)color=primary?p.secondary:p.line;
  if(pressed)color=p.brand;
  if(disabled)color=p.line;
  auto brush=CreateSolidBrush(color); auto pen=CreatePen(PS_SOLID,s->px(1),primary?color:p.line);
  auto oldBrush=SelectObject(item->hDC,brush),oldPen=SelectObject(item->hDC,pen);
  RoundRect(item->hDC,item->rcItem.left,item->rcItem.top,item->rcItem.right,item->rcItem.bottom,s->px(16),s->px(16));
  SelectObject(item->hDC,oldBrush);SelectObject(item->hDC,oldPen);DeleteObject(brush);DeleteObject(pen);
  wchar_t caption[128]{};GetWindowText(item->hwndItem,caption,128);
  auto font=SelectObject(item->hDC,s->text);SetBkMode(item->hDC,TRANSPARENT);SetTextColor(item->hDC,primary?p.canvas:p.ink);
  RECT r=item->rcItem;DrawText(item->hDC,caption,-1,&r,DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX);SelectObject(item->hDC,font);
  if(item->itemState&ODS_FOCUS) {
    RECT focus=item->rcItem;InflateRect(&focus,-s->px(4),-s->px(4));
    auto ring=CreatePen(PS_SOLID,s->px(2),p.brand);auto old=SelectObject(item->hDC,ring);auto hollow=SelectObject(item->hDC,GetStockObject(HOLLOW_BRUSH));
    RoundRect(item->hDC,focus.left,focus.top,focus.right,focus.bottom,s->px(10),s->px(10));SelectObject(item->hDC,hollow);SelectObject(item->hDC,old);DeleteObject(ring);
  }
}
static void createLabels(Surface* s) {
  // Standard Static semantics expose all copy to screen readers. Owner drawing
  // keeps the same fonts/colors as the surrounding GDI surface.
  s->headingLabel=CreateWindow(L"STATIC",s->title.c_str(),WS_CHILD|WS_VISIBLE|SS_OWNERDRAW,s->px(32),s->px(132),s->px(416),s->px(36),s->window,nullptr,module,nullptr);
  s->bodyLabel=CreateWindow(L"STATIC",s->body.c_str(),WS_CHILD|WS_VISIBLE|SS_OWNERDRAW,s->px(32),s->px(178),s->px(416),s->px(s->prompt?122:52),s->window,nullptr,module,nullptr);
}
static LRESULT CALLBACK buttonProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR data) {
  auto s=reinterpret_cast<Surface*>(data);
  if(msg==WM_MOUSEMOVE||msg==WM_MOUSELEAVE) {
    bool entered=msg==WM_MOUSEMOVE;
    if(hwnd==s->primary)s->hoverPrimary=entered;else s->hoverSecondary=entered;
    if(entered) { TRACKMOUSEEVENT event{sizeof(event),TME_LEAVE,hwnd,0};TrackMouseEvent(&event); }
    InvalidateRect(hwnd,nullptr,FALSE);
  }
  return DefSubclassProc(hwnd,msg,wp,lp);
}
static void initSurface(Surface* s, HWND hwnd) {
  s->window=hwnd; s->dpi=GetDpiForWindow(hwnd);
  s->background=CreateSolidBrush(palette().canvas);
  s->heading=CreateFont(-s->px(22),0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Microsoft YaHei UI");
  s->text=CreateFont(-s->px(14),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Microsoft YaHei UI");
  s->small=CreateFont(-s->px(13),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Microsoft YaHei UI");
  BOOL value=dark;DwmSetWindowAttribute(hwnd,20,&value,sizeof(value));
  SendMessage(hwnd,WM_SETICON,ICON_SMALL,reinterpret_cast<LPARAM>(mark));SendMessage(hwnd,WM_SETICON,ICON_BIG,reinterpret_cast<LPARAM>(mark));
}
static void destroySurface(Surface* s) {
  DeleteObject(s->background);DeleteObject(s->heading);DeleteObject(s->text);DeleteObject(s->small);
}
static LRESULT CALLBACK surfaceProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  auto s=state(hwnd);
  if(msg==WM_NCCREATE) { s=static_cast<Surface*>(reinterpret_cast<CREATESTRUCT*>(lp)->lpCreateParams);SetWindowLongPtr(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(s));initSurface(s,hwnd); }
  if(!s)return DefWindowProc(hwnd,msg,wp,lp);
  switch(msg) {
    case WM_ERASEBKGND:return 1;
    case WM_PAINT: { PAINTSTRUCT ps;HDC dc=BeginPaint(hwnd,&ps);draw(s,dc);EndPaint(hwnd,&ps);return 0; }
    case WM_PRINTCLIENT:draw(s,reinterpret_cast<HDC>(wp));return 0;
    case WM_DRAWITEM:drawButton(s,reinterpret_cast<DRAWITEMSTRUCT*>(lp));return TRUE;
    case WM_COMMAND: if(HIWORD(wp)==BN_CLICKED) { s->result=LOWORD(wp);DestroyWindow(hwnd);PostThreadMessage(GetCurrentThreadId(),WM_NULL,0,0); }return 0;
    case WM_CLOSE:s->result=IDCANCEL;DestroyWindow(hwnd);PostThreadMessage(GetCurrentThreadId(),WM_NULL,0,0);return 0;
    case WM_TIMER: {
      HWND parent=GetParent(hwnd);
      if(parent) {
        // NSIS disables Cancel throughout instfiles, then enables it when a
        // section aborts. Route that completed failure through its own callback;
        // a hidden native Close page must never keep showing active progress.
        if(IsWindowEnabled(GetDlgItem(parent,IDCANCEL))) {
          KillTimer(hwnd,1);PostMessage(parent,WM_COMMAND,IDCANCEL,0);return 0;
        }
        EnumChildWindows(parent,findProgress,reinterpret_cast<LPARAM>(&s->progress));
        HWND child=GetWindow(parent,GW_CHILD);
        while(child) { if(child!=hwnd) { SetWindowSubclass(child,hiddenProc,1,0);ShowWindow(child,SW_HIDE); }child=GetWindow(child,GW_HWNDNEXT); }
        SetWindowPos(hwnd,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
      }
      if(s->progress) {
        auto range=SendMessage(s->progress,PBM_GETRANGE,FALSE,0);
        auto position=SendMessage(s->progress,PBM_GETPOS,0,0);
        int percent=range?static_cast<int>(position*100/range):0;
        if(percent!=s->percent) { s->percent=std::clamp(percent,0,100);InvalidateRect(hwnd,nullptr,FALSE); }
      }
      return 0;
    }
    case WM_DESTROY:KillTimer(hwnd,1);destroySurface(s);return 0;
  }
  return DefWindowProc(hwnd,msg,wp,lp);
}
static void resizeWindow(HWND hwnd, Surface* s, int height) {
  RECT r{0,0,s->px(480),s->px(height)};
  AdjustWindowRectExForDpi(&r,static_cast<DWORD>(GetWindowLongPtr(hwnd,GWL_STYLE)),FALSE,static_cast<DWORD>(GetWindowLongPtr(hwnd,GWL_EXSTYLE)),s->dpi);
  RECT work{};SystemParametersInfo(SPI_GETWORKAREA,0,&work,0);
  SetWindowPos(hwnd,nullptr,work.left+(work.right-work.left-(r.right-r.left))/2,work.top+(work.bottom-work.top-(r.bottom-r.top))/2,r.right-r.left,r.bottom-r.top,SWP_NOZORDER|SWP_NOACTIVATE);
}
static void styleButton(HWND button, Surface* s, int x, int width) {
  SetWindowLongPtr(button,GWL_STYLE,(GetWindowLongPtr(button,GWL_STYLE)&~BS_TYPEMASK)|BS_OWNERDRAW|WS_TABSTOP);
  SetWindowPos(button,nullptr,s->px(x),s->px(320),s->px(width),s->px(40),SWP_NOZORDER);
  SetWindowSubclass(button,buttonProc,1,reinterpret_cast<DWORD_PTR>(s));
}
static int prompt(const std::wstring& title,const std::wstring& body,bool retry=false,bool cancel=true) {
  Surface s;s.prompt=true;s.title=title;s.body=body;
  HWND hwnd=CreateWindowEx(WS_EX_APPWINDOW|WS_EX_CONTROLPARENT,L"WeftMateInstallerPrompt",L"WeftMate",WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU,0,0,480,400,installParent,nullptr,module,&s);
  resizeWindow(hwnd,&s,392);
  createLabels(&s);
  s.primary=CreateWindow(L"BUTTON",retry?tr(L"重试",L"Retry"):tr(L"卸载程序",L"Uninstall"),WS_CHILD|WS_VISIBLE|WS_TABSTOP,0,0,0,0,hwnd,reinterpret_cast<HMENU>(retry?IDRETRY:IDOK),module,nullptr);
  if(!cancel)SetWindowText(s.primary,tr(L"知道了",L"OK"));
  styleButton(s.primary,&s,320,128);
  if(cancel) { s.secondary=CreateWindow(L"BUTTON",tr(L"取消",L"Cancel"),WS_CHILD|WS_VISIBLE|WS_TABSTOP,0,0,0,0,hwnd,reinterpret_cast<HMENU>(IDCANCEL),module,nullptr);styleButton(s.secondary,&s,208,96); }
  if(installParent)EnableWindow(installParent,FALSE);
  ShowWindow(hwnd,SW_SHOWNOACTIVATE);SetFocus(cancel?s.secondary:s.primary);
  MSG msg;while(IsWindow(hwnd)&&GetMessage(&msg,nullptr,0,0)>0) {
    if(msg.message==WM_KEYDOWN&&msg.wParam==VK_ESCAPE) { SendMessage(hwnd,WM_CLOSE,0,0);continue; }
    if(msg.message==WM_KEYDOWN&&msg.wParam==VK_RETURN) { auto focus=GetFocus();SendMessage(hwnd,WM_COMMAND,GetDlgCtrlID(focus==s.primary?s.primary:s.secondary),0);continue; }
    if(!IsDialogMessage(hwnd,&msg)) { TranslateMessage(&msg);DispatchMessage(&msg); }
  }
  if(installParent)EnableWindow(installParent,TRUE);
  return s.result;
}
// Skin the original NSIS message box, retaining its buttons/return IDs and all
// engine retry/cancel decisions. Never intercept silent installations.
static LRESULT CALLBACK errorProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp,UINT_PTR,DWORD_PTR data) {
  auto s=reinterpret_cast<Surface*>(data);
  if(s->secondary&&GetDlgCtrlID(s->secondary)==IDABORT &&
      (msg==WM_CLOSE||(msg==WM_COMMAND&&LOWORD(wp)==IDCANCEL)||(msg==WM_KEYDOWN&&wp==VK_ESCAPE)))
    return DefSubclassProc(hwnd,WM_COMMAND,IDABORT,0);
  if(msg==WM_PAINT) { PAINTSTRUCT ps;auto dc=BeginPaint(hwnd,&ps);draw(s,dc);EndPaint(hwnd,&ps);return 0; }
  if(msg==WM_PRINTCLIENT) { draw(s,reinterpret_cast<HDC>(wp));return 0; }
  if(msg==WM_ERASEBKGND)return 1;
  if(msg==WM_DRAWITEM) { drawButton(s,reinterpret_cast<DRAWITEMSTRUCT*>(lp));return TRUE; }
  if(msg==WM_NCDESTROY) { RemoveWindowSubclass(hwnd,errorProc,1);destroySurface(s);delete s; }
  return DefSubclassProc(hwnd,msg,wp,lp);
}
static LRESULT CALLBACK hookProc(int code,WPARAM wp,LPARAM lp) {
  if(code==HCBT_ACTIVATE) {
    HWND hwnd=reinterpret_cast<HWND>(wp);wchar_t cls[64]{};GetClassName(hwnd,cls,64);
    if(hwnd!=installParent && wcscmp(cls,L"#32770")==0 && (GetDlgItem(hwnd,IDOK)||GetDlgItem(hwnd,IDRETRY))) {
      if(!GetProp(hwnd,L"WeftStyled")) {
        errorShown=true;
        SetProp(hwnd,L"WeftStyled",reinterpret_cast<HANDLE>(1));
        auto s=new Surface;s->prompt=true;s->message=true;
        s->title=progressSurface&&progressSurface->operation==2?tr(L"暂时无法完成卸载",L"Uninstall could not finish"):tr(L"暂时无法完成安装",L"Setup could not finish");
        s->body=tr(L"请检查磁盘是否有足够空间，并关闭正在运行的 WeftMate 后重试。\n如果安全软件拦截了文件，请先核对安装包来源，再查看它的提示。你的数据不会被删除。",L"Check free disk space and close WeftMate, then retry.\nIf security software blocked a file, verify the download source and review its alert. Your data is kept.");
        wchar_t original[2048]{};GetDlgItemText(hwnd,65535,original,2048);std::wstring reason=original;
#ifdef WEFT_QA
        wchar_t reportFile[32768]{};GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_ERROR_LOG",reportFile,32768);
        if(reportFile[0]) { HANDLE file=CreateFile(reportFile,GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);if(file!=INVALID_HANDLE_VALUE) { DWORD written=0;wchar_t bom=0xfeff;WriteFile(file,&bom,sizeof(bom),&written,nullptr);WriteFile(file,original,static_cast<DWORD>(wcslen(original)*sizeof(wchar_t)),&written,nullptr);CloseHandle(file); } }
#endif
        std::transform(reason.begin(),reason.end(),reason.begin(),[](wchar_t ch){return static_cast<wchar_t>(towlower(ch));});
        if(reason.find(L"space")!=std::wstring::npos||reason.find(L"空间")!=std::wstring::npos||reason.find(L"112")!=std::wstring::npos)
          s->body=tr(L"磁盘剩余空间不足，程序文件没有全部写入。请释放一些空间后重试。你的对话、记忆和设置不会被删除。",L"There is not enough free disk space to write the app files. Free some space and retry. Your conversations, memories and settings are kept.");
        else if(reason.find(L"closed")!=std::wstring::npos||reason.find(L"关闭")!=std::wstring::npos||reason.find(L"rename")!=std::wstring::npos||reason.find(L"占用")!=std::wstring::npos)
          s->body=tr(L"程序文件正在被使用，暂时无法替换或移除。请关闭 WeftMate 后重试；如果已经关闭，请稍等片刻再试。你的数据会保留。",L"The app files are in use and cannot be replaced or removed yet. Close WeftMate and retry. If it is already closed, wait a moment and try again. Your data is kept.");
        else if(reason.find(L"denied")!=std::wstring::npos||reason.find(L"拒绝")!=std::wstring::npos)
          s->body=tr(L"Windows 暂时不允许写入程序文件。请查看安全软件是否拦截了安装包，核对下载来源后再重试。你的数据会保留。",L"Windows did not allow the app files to be written. Check whether security software blocked the installer, verify the download source and retry. Your data is kept.");
        initSurface(s,hwnd);resizeWindow(hwnd,s,392);SetWindowText(hwnd,L"WeftMate");
        HWND child=GetWindow(hwnd,GW_CHILD);
        while(child) { auto next=GetWindow(child,GW_HWNDNEXT);wchar_t name[64]{};GetClassName(child,name,64);if(wcscmp(name,L"Button")!=0)ShowWindow(child,SW_HIDE);child=next; }
        s->primary=GetDlgItem(hwnd,IDRETRY);if(!s->primary)s->primary=GetDlgItem(hwnd,IDOK);
        s->secondary=GetDlgItem(hwnd,IDCANCEL);
        if(!s->secondary)s->secondary=GetDlgItem(hwnd,IDABORT);
        if(s->secondary&&GetDlgCtrlID(s->secondary)==IDABORT)
          EnableMenuItem(GetSystemMenu(hwnd,FALSE),SC_CLOSE,MF_BYCOMMAND|MF_ENABLED);
        // An incomplete program must not continue by ignoring a failed file.
        if(auto ignore=GetDlgItem(hwnd,IDIGNORE))ShowWindow(ignore,SW_HIDE);
        if(s->primary) { SetWindowText(s->primary,GetDlgCtrlID(s->primary)==IDRETRY?tr(L"重试",L"Retry"):tr(L"知道了",L"OK"));styleButton(s->primary,s,320,128); }
        if(s->secondary) { SetWindowText(s->secondary,tr(L"取消",L"Cancel"));styleButton(s->secondary,s,208,96); }
        if(s->primary)SendMessage(hwnd,DM_SETDEFID,GetDlgCtrlID(s->primary),0);
        SetWindowSubclass(hwnd,errorProc,1,reinterpret_cast<DWORD_PTR>(s));
        createLabels(s);
      }
    }
  }
  return CallNextHookEx(nullptr,code,wp,lp);
}
extern "C" void __stdcall Work() {
  DWORD thread=GetCurrentThreadId();
  for(const auto& hook:messageHooks)if(hook.first==thread)return;
  messageHooks.emplace_back(thread,SetWindowsHookEx(WH_CBT,hookProc,nullptr,thread));
}
extern "C" void __stdcall Failed() {
  if(errorShown)return;
  if(progressSurface&&progressSurface->operation==2)
    prompt(tr(L"卸载暂时未能完成",L"Uninstall could not finish"),tr(L"部分程序文件仍在使用中。请关闭 WeftMate，再从 Windows 应用列表重试卸载。你的对话、记忆和设置会保留。",L"Some app files are still in use. Close WeftMate and retry from Windows Apps. Your conversations, memories and settings are kept."),false,false);
  else prompt(tr(L"安装暂时未能完成",L"Setup could not finish"),tr(L"程序文件没有全部写入。请关闭 WeftMate，检查磁盘空间及安全软件提示，再重新打开安装包重试。原有数据会保留。",L"The app files could not all be written. Close WeftMate, check free disk space and security software alerts, then run the installer again. Your existing data is kept."),false,false);
}
extern "C" void __stdcall Initialize(HWND parent,const wchar_t* icon) {
  installParent=parent;
  DWORD light=1,bytes=sizeof(light);RegGetValue(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",L"AppsUseLightTheme",RRF_RT_REG_DWORD,nullptr,&light,&bytes);dark=light==0;
  english=PRIMARYLANGID(GetUserDefaultUILanguage())!=LANG_CHINESE;
#ifdef WEFT_QA
  wchar_t theme[16]{};GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_THEME",theme,16);if(wcscmp(theme,L"dark")==0)dark=true;if(wcscmp(theme,L"light")==0)dark=false;
#endif
  mark=static_cast<HICON>(LoadImage(nullptr,icon,IMAGE_ICON,64,64,LR_LOADFROMFILE));
  WNDCLASS cls{};cls.hInstance=module;cls.lpfnWndProc=surfaceProc;cls.lpszClassName=L"WeftMateInstallerPrompt";cls.hCursor=LoadCursor(nullptr,IDC_ARROW);RegisterClass(&cls);
  cls.lpszClassName=L"WeftMateInstallerSurface";RegisterClass(&cls);
}
static BOOL CALLBACK findProgress(HWND hwnd,LPARAM lp) {
  wchar_t cls[64]{};GetClassName(hwnd,cls,64);if(wcscmp(cls,PROGRESS_CLASS)==0)*reinterpret_cast<HWND*>(lp)=hwnd;return TRUE;
}
static LRESULT CALLBACK hiddenProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp,UINT_PTR,DWORD_PTR) {
  if(msg==WM_WINDOWPOSCHANGING) {
    auto position=reinterpret_cast<WINDOWPOS*>(lp);
    position->flags=(position->flags&~SWP_SHOWWINDOW)|SWP_HIDEWINDOW;
  }
  return DefSubclassProc(hwnd,msg,wp,lp);
}
extern "C" void __stdcall Attach(HWND parent,int operation) {
  installParent=parent;
  Work();
  auto s=new Surface;s->operation=operation;
  s->title=operation==2?tr(L"正在卸载",L"Uninstalling"):operation==1?tr(L"正在更新",L"Updating"):tr(L"正在安装",L"Installing");
  s->body=operation==2?tr(L"只移除程序，对话、记忆和设置都会保留。",L"Removing the app. Conversations, memories and settings stay."):operation==1?tr(L"为你准备新版 WeftMate，原有数据会保留。",L"Preparing the new WeftMate. Your existing data stays."):tr(L"正在把 WeftMate 安装到这台电脑，无需其他操作。",L"Setting up WeftMate on this computer. Nothing else to do.");
  EnumChildWindows(parent,findProgress,reinterpret_cast<LPARAM>(&s->progress));
  HWND child=GetWindow(parent,GW_CHILD);while(child) { SetWindowSubclass(child,hiddenProc,1,0);ShowWindow(child,SW_HIDE);child=GetWindow(child,GW_HWNDNEXT); }
  BOOL theme=dark;DwmSetWindowAttribute(parent,20,&theme,sizeof(theme));
  SetWindowText(parent,L"WeftMate");s->dpi=GetDpiForWindow(parent);resizeWindow(parent,s,326);
  HWND overlay=CreateWindowEx(0,L"WeftMateInstallerSurface",s->title.c_str(),WS_CHILD|WS_VISIBLE,0,0,s->px(480),s->px(326),parent,nullptr,module,s);
  progressSurface=s;createLabels(s);
  SetWindowPos(overlay,HWND_TOP,0,0,0,0,SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE);SetTimer(overlay,1,120,nullptr);
}
// Read only the single dataDirectory string in this identity's configuration.
// A minimal JSON string decoder avoids shipping a parser/runtime in the stub.
static std::wstring dataPath(const wchar_t* config,const wchar_t* fallback) {
  HANDLE file=CreateFile(config,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
  if(file==INVALID_HANDLE_VALUE)return fallback;
  DWORD size=GetFileSize(file,nullptr),read=0;std::string bytes(size,'\0');ReadFile(file,bytes.data(),size,&read,nullptr);CloseHandle(file);
  auto start=bytes.find("\"dataDirectory\"");if(start==std::string::npos)return fallback;
  start=bytes.find(':',start);start=bytes.find('"',start);if(start==std::string::npos)return fallback;
  std::string decoded;bool complete=false;
  for(size_t i=start+1;i<bytes.size();i++) {
    char c=bytes[i];if(c=='"'){complete=true;break;}
    if(c=='\\') { if(++i>=bytes.size())break;c=bytes[i];if(c=='u'&&i+4<bytes.size()) { unsigned int cp=0;bool valid=true;for(int j=0;j<4;j++){char h=bytes[++i];int n=h>='0'&&h<='9'?h-'0':h>='a'&&h<='f'?h-'a'+10:h>='A'&&h<='F'?h-'A'+10:-1;if(n<0){valid=false;break;}cp=cp*16+static_cast<unsigned>(n);}if(!valid)return fallback;wchar_t ch=static_cast<wchar_t>(cp);char utf[8]{};int len=WideCharToMultiByte(CP_UTF8,0,&ch,1,utf,8,nullptr,nullptr);decoded.append(utf,len);continue;}if(c=='n')c='\n';else if(c=='r')c='\r';else if(c=='t')c='\t'; }
    decoded+=c;
  }
  if(!complete)return fallback;
  int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,decoded.data(),static_cast<int>(decoded.size()),nullptr,0);
  if(count<=0)return fallback;std::wstring result(count,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,decoded.data(),static_cast<int>(decoded.size()),result.data(),count);
  // Use a portable environment alias for display; never put a user name in QA.
  wchar_t roaming[32768]{};GetEnvironmentVariable(L"APPDATA",roaming,32768);std::wstring prefix=roaming;
  if(!prefix.empty()&&result.size()>prefix.size()&&_wcsnicmp(result.c_str(),prefix.c_str(),prefix.size())==0&&result[prefix.size()]=='\\')result=L"%APPDATA%"+result.substr(prefix.size());
  return result;
}
extern "C" int __stdcall Confirm(const wchar_t* config,const wchar_t* fallback) {
  auto body=std::wstring(tr(L"只移除 WeftMate 程序。你的对话、记忆和设置会保留在：\n",L"Only the WeftMate app will be removed. Your conversations, memories and settings stay in:\n"))+dataPath(config,fallback)+tr(L"\n不会被删除，重新安装后可以继续使用。",L"\nNothing will be deleted. Reinstall to continue.");
  return prompt(tr(L"卸载 WeftMate？",L"Uninstall WeftMate?"),body)==IDOK;
}
static bool runningIn(const wchar_t* directory) {
  std::wstring prefix=directory;if(prefix.empty())return false;if(prefix.back()!='\\')prefix+=L'\\';
  HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if(snapshot==INVALID_HANDLE_VALUE)return false;
  PROCESSENTRY32 entry{};entry.dwSize=sizeof(entry);bool found=false;
  if(Process32First(snapshot,&entry))do { HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,entry.th32ProcessID);if(!process)continue;wchar_t name[32768]{};DWORD size=32768;if(QueryFullProcessImageName(process,0,name,&size)&&size>prefix.size()&&_wcsnicmp(name,prefix.c_str(),prefix.size())==0)found=true;CloseHandle(process); }while(!found&&Process32Next(snapshot,&entry));
  CloseHandle(snapshot);return found;
}
extern "C" int __stdcall WaitForApp(const wchar_t* directory) {
  while(runningIn(directory)) { if(prompt(tr(L"先关闭正在运行的 WeftMate",L"Close WeftMate to continue"),tr(L"WeftMate 还在使用程序文件。请保存正在做的事情并退出程序，然后点“重试”。对话和数据会保留。",L"WeftMate is still using its program files. Save your work and quit the app, then choose Retry. Conversations and data are kept."),true)!=IDRETRY)return 0; }
  return 1;
}
extern "C" void __stdcall CleanupWarning() {
  prompt(tr(L"程序清理未完成",L"App cleanup could not finish"),tr(L"你的数据已保留。请关闭 WeftMate 后重新安装，再尝试卸载；也可以在设置里关闭开机自启。",L"Your data is kept. Close WeftMate, reinstall and retry uninstalling. You can also disable launch at login in Settings."),false,false);
}
extern "C" int __stdcall Launch(const wchar_t* executable,const wchar_t* args) {
  std::wstring command=L"\""+std::wstring(executable)+L"\" "+args;
  STARTUPINFO startup{};startup.cb=sizeof(startup);PROCESS_INFORMATION process{};
  do {
    // Start as the same user on the same desktop, without installer handles.
    if(CreateProcess(executable,command.data(),nullptr,nullptr,FALSE,0,nullptr,nullptr,&startup,&process)) {
      CloseHandle(process.hThread);CloseHandle(process.hProcess);return 1;
    }
  }while(prompt(tr(L"程序暂时无法打开",L"WeftMate could not open"),tr(L"程序已经安装，但 Windows 暂时没有允许打开它。请查看安全软件的提示，并核对安装包来源，然后重试。你的数据会保留。",L"The app is installed, but Windows did not allow it to open. Check security software alerts, verify the download source and retry. Your data is kept."),true)==IDRETRY);
  return 0;
}
extern "C" void __stdcall Shutdown() {
  for(const auto& hook:messageHooks)if(hook.second)UnhookWindowsHookEx(hook.second);
  messageHooks.clear();
  if(progressSurface) { if(IsWindow(progressSurface->window))DestroyWindow(progressSurface->window);delete progressSurface;progressSurface=nullptr; }
  if(IsWindow(installParent)) { HWND child=GetWindow(installParent,GW_CHILD);while(child) { RemoveWindowSubclass(child,hiddenProc,1);child=GetWindow(child,GW_HWNDNEXT); } }
  UnregisterClass(L"WeftMateInstallerSurface",module);UnregisterClass(L"WeftMateInstallerPrompt",module);
  if(mark) { DestroyIcon(mark);mark=nullptr; }
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID) { if(reason==DLL_PROCESS_ATTACH) { module=instance;DisableThreadLibraryCalls(instance); }return TRUE; }
