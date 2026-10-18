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
#include "installer-directory.h"
#undef small

struct Palette { COLORREF canvas, ink, secondary, line, brand; };
#include "palette.h"
static HINSTANCE module;
static HICON mark;
static std::vector<std::pair<DWORD,HHOOK>> messageHooks;
static bool errorShown;
static bool english, dark;
static HWND installParent;
static std::wstring selectedDirectory, locationExecutable, locationData;
static unsigned int locationKilobytes;
static std::wstring dataPath(const wchar_t*,const wchar_t*);
struct Surface;
static LRESULT CALLBACK frameProc(HWND,UINT,WPARAM,LPARAM,UINT_PTR,DWORD_PTR);
static void layout(Surface*);
static LRESULT CALLBACK hiddenProc(HWND,UINT,WPARAM,LPARAM,UINT_PTR,DWORD_PTR);
static BOOL CALLBACK findProgress(HWND,LPARAM);
static const wchar_t* tr(const wchar_t* zh, const wchar_t* en) { return english ? en : zh; }
static const Palette& palette() { return dark ? DARK : LIGHT; }

struct Surface {
  HWND window{}, progress{}, primary{}, secondary{}, headingLabel{}, bodyLabel{}, close{}, change{}, pathLabel{};
  std::wstring title, body;
  int result{}, operation{}, percent{}, focus{};
  bool prompt{}, message{}, ready{}, hoverPrimary{}, hoverSecondary{}, hoverClose{}, fullPathHover{};
  UINT dpi{96};
  HBRUSH background{};
  HFONT heading{}, text{}, small{};
  int px(int x) const { return MulDiv(x, static_cast<int>(dpi), 96); }
};
// Reveal the full location in the existing explanatory area: same palette,
// no native tooltip, extra popup or clipped text over the action buttons.
static LRESULT CALLBACK pathProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp,UINT_PTR,DWORD_PTR ref) {
  auto s=reinterpret_cast<Surface*>(ref);
  if(msg==WM_MOUSEMOVE) {
    s->fullPathHover=true;
#ifdef WEFT_QA
    wchar_t forced[8]{};bool syntheticHover=GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_HOVER",forced,8)>0;
    if(!syntheticHover) {
#endif
    TRACKMOUSEEVENT tracking{sizeof(TRACKMOUSEEVENT),TME_LEAVE,hwnd,0};TrackMouseEvent(&tracking);
#ifdef WEFT_QA
    }
#endif
    SetWindowText(s->bodyLabel,selectedDirectory.c_str());
  } else if(msg==WM_MOUSELEAVE){s->fullPathHover=false;SetWindowText(s->bodyLabel,s->body.c_str());}
  return DefSubclassProc(hwnd,msg,wp,lp);
}
static Surface* progressSurface;
static UINT surfaceDpi(HWND hwnd) {
  UINT dpi=GetDpiForWindow(hwnd);
#ifdef WEFT_QA
  wchar_t test[16]{};GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_DPI",test,16);if(test[0])dpi=static_cast<UINT>(_wtoi(test));
#endif
  return dpi;
}
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
  auto edge=CreatePen(PS_SOLID,1,palette().line);auto oldPen=SelectObject(dc,edge);auto oldBrush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));RoundRect(dc,0,0,rect.right,rect.bottom,s->px(8),s->px(8));SelectObject(dc,oldPen);SelectObject(dc,oldBrush);DeleteObject(edge);
  DrawIconEx(dc,s->px(32),s->px(28),mark,s->px(36),s->px(36),0,nullptr,DI_NORMAL);
  text(dc,s,L"WeftMate",80,31,340,30,s->heading,palette().ink);
  text(dc,s,tr(L"同一个助手，陪你把事情做完。",L"One companion. From thought to done."),32,80,416,28,s->small,palette().secondary);
  text(dc,s,s->title,32,132,416,36,s->heading,palette().ink);
  text(dc,s,s->body,32,178,416,s->prompt?122:52,s->text,palette().secondary);
  if(s->ready) {
    text(dc,s,tr(L"安装位置",L"Install location"),32,232,320,22,s->small,palette().secondary);
  } else if(!s->prompt) {
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
    bool heading=item->hwndItem==s->headingLabel, path=item->hwndItem==s->pathLabel;
    auto old=SelectObject(item->hDC,heading?s->heading:s->text);
    SetTextColor(item->hDC,heading?palette().ink:palette().secondary);SetBkMode(item->hDC,TRANSPARENT);
    RECT r=item->rcItem;std::wstring caption=heading?s->title:s->fullPathHover?selectedDirectory:s->body;
    if(path){wchar_t value[32768]{};GetWindowText(s->pathLabel,value,32768);caption=value;}
    DrawText(item->hDC,caption.c_str(),-1,&r,path?DT_LEFT|DT_SINGLELINE|DT_PATH_ELLIPSIS|DT_NOPREFIX:DT_LEFT|DT_WORDBREAK|DT_NOPREFIX);SelectObject(item->hDC,old);return;
  }
  if(item->hwndItem==s->close) {
    fill(item->hDC,item->rcItem,((item->itemState&ODS_SELECTED)||(!(item->itemState&ODS_DISABLED)&&s->hoverClose))?palette().line:palette().canvas);
    auto pen=CreatePen(PS_SOLID,s->px(2),(item->itemState&ODS_DISABLED)?palette().line:palette().ink);auto previous=SelectObject(item->hDC,pen);
    int middle=(item->rcItem.right-item->rcItem.left)/2, half=s->px(5);
    MoveToEx(item->hDC,middle-half,middle-half,nullptr);LineTo(item->hDC,middle+half,middle+half);
    MoveToEx(item->hDC,middle+half,middle-half,nullptr);LineTo(item->hDC,middle-half,middle+half);
    SelectObject(item->hDC,previous);DeleteObject(pen);
    if(item->itemState&ODS_FOCUS){RECT r=item->rcItem;InflateRect(&r,-s->px(3),-s->px(3));auto ring=CreatePen(PS_SOLID,s->px(2),palette().brand);auto oldPen=SelectObject(item->hDC,ring);auto oldBrush=SelectObject(item->hDC,GetStockObject(HOLLOW_BRUSH));RoundRect(item->hDC,r.left,r.top,r.right,r.bottom,s->px(8),s->px(8));SelectObject(item->hDC,oldPen);SelectObject(item->hDC,oldBrush);DeleteObject(ring);}return;
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
    if(hwnd==s->close)s->hoverClose=entered;else if(hwnd==s->primary)s->hoverPrimary=entered;else s->hoverSecondary=entered;
    if(entered) { TRACKMOUSEEVENT event{sizeof(event),TME_LEAVE,hwnd,0};TrackMouseEvent(&event); }
    InvalidateRect(hwnd,nullptr,FALSE);
  }
  return DefSubclassProc(hwnd,msg,wp,lp);
}
static void initSurface(Surface* s, HWND hwnd,UINT dpi=0) {
  s->window=hwnd; s->dpi=dpi?dpi:surfaceDpi(hwnd);
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
    case WM_NCHITTEST:if(!s->prompt)return HTTRANSPARENT;break;
    case WM_ERASEBKGND:return 1;
    case WM_PAINT: { PAINTSTRUCT ps;HDC dc=BeginPaint(hwnd,&ps);draw(s,dc);EndPaint(hwnd,&ps);return 0; }
    case WM_PRINTCLIENT:draw(s,reinterpret_cast<HDC>(wp));return 0;
    case WM_DRAWITEM:drawButton(s,reinterpret_cast<DRAWITEMSTRUCT*>(lp));return TRUE;
    case WM_COMMAND: if(HIWORD(wp)==BN_CLICKED) {
      int id=LOWORD(wp);
      if(id==90){SendMessage(s->prompt?hwnd:GetParent(hwnd),WM_CLOSE,0,0);return 0;}
      if(s->ready) {
        if(id==81){auto folder=chooseInstallFolder(GetParent(hwnd),selectedDirectory);if(!folder.empty()){auto target=resolveInstallFolder(folder,locationExecutable);auto error=validateInstallFolder(target,locationExecutable,locationData,locationKilobytes,english);if(error.empty()){selectedDirectory=target;SetWindowText(s->pathLabel,target.c_str());s->body=tr(L"准备好后，点“安装”即可。",L"Choose Install when you are ready.");}else s->body=error;SetWindowText(s->bodyLabel,s->body.c_str());InvalidateRect(hwnd,nullptr,TRUE);}}
        if(id==80)PostMessage(GetParent(hwnd),WM_COMMAND,IDOK,0);
        return 0;
      }
      s->result=id;DestroyWindow(hwnd);PostThreadMessage(GetCurrentThreadId(),WM_NULL,0,0);
    }return 0;
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
  RECT work{};SystemParametersInfo(SPI_GETWORKAREA,0,&work,0);
  SetWindowPos(hwnd,nullptr,work.left+(work.right-work.left-(r.right-r.left))/2,work.top+(work.bottom-work.top-(r.bottom-r.top))/2,r.right-r.left,r.bottom-r.top,SWP_NOZORDER|SWP_NOACTIVATE);
}
static void frame(HWND hwnd,Surface* s) {
  auto style=GetWindowLongPtr(hwnd,GWL_STYLE);
  SetWindowLongPtr(hwnd,GWL_STYLE,(style&~(WS_CAPTION|WS_MAXIMIZEBOX|DS_MODALFRAME))|WS_POPUP|WS_SYSMENU|WS_MINIMIZEBOX|WS_THICKFRAME);
  SetWindowLongPtr(hwnd,GWL_EXSTYLE,(GetWindowLongPtr(hwnd,GWL_EXSTYLE)&~WS_EX_DLGMODALFRAME)|WS_EX_APPWINDOW);
  SetWindowSubclass(hwnd,frameProc,2,reinterpret_cast<DWORD_PTR>(s));
  MARGINS margins{1,1,1,1};DwmExtendFrameIntoClientArea(hwnd,&margins);
  DWORD round=2;DwmSetWindowAttribute(hwnd,33,&round,sizeof(round));
  BOOL theme=dark;DwmSetWindowAttribute(hwnd,20,&theme,sizeof(theme));
  SetWindowPos(hwnd,nullptr,0,0,0,0,SWP_FRAMECHANGED|SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE);
}
static void closeControl(Surface* s,bool enabled) {
  s->close=CreateWindow(L"BUTTON",tr(L"关闭",L"Close"),WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,s->px(428),s->px(16),s->px(36),s->px(36),s->window,reinterpret_cast<HMENU>(90),module,nullptr);
  EnableWindow(s->close,enabled);
  SetWindowSubclass(s->close,buttonProc,1,reinterpret_cast<DWORD_PTR>(s));
}
static void layout(Surface* s) {
  SetWindowPos(s->close,nullptr,s->px(428),s->px(16),s->px(36),s->px(36),SWP_NOZORDER);
  SetWindowPos(s->headingLabel,nullptr,s->px(32),s->px(132),s->px(416),s->px(36),SWP_NOZORDER);
  SetWindowPos(s->bodyLabel,nullptr,s->px(32),s->px(178),s->px(416),s->px(s->prompt?122:52),SWP_NOZORDER);
  if(s->ready){SetWindowPos(s->pathLabel,nullptr,s->px(32),s->px(264),s->px(300),s->px(26),SWP_NOZORDER);SetWindowPos(s->change,nullptr,s->px(352),s->px(252),s->px(96),s->px(40),SWP_NOZORDER);}
  if(s->primary)SetWindowPos(s->primary,nullptr,s->px(320),s->px(320),s->px(128),s->px(40),SWP_NOZORDER);
  if(s->secondary)SetWindowPos(s->secondary,nullptr,s->px(208),s->px(320),s->px(96),s->px(40),SWP_NOZORDER);
}
static LRESULT CALLBACK frameProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp,UINT_PTR,DWORD_PTR data) {
  auto s=reinterpret_cast<Surface*>(data);
  if(msg==WM_NCCALCSIZE)return 0;
  if(msg==WM_NCHITTEST){POINT p{GET_X_LPARAM(lp),GET_Y_LPARAM(lp)};ScreenToClient(hwnd,&p);if(p.y<s->px(112)&&p.x<s->px(420))return HTCAPTION;return HTCLIENT;}
  if(msg==WM_SYSCOMMAND&&(wp&0xfff0)==SC_MAXIMIZE)return 0;
  if((msg==WM_CLOSE||(msg==WM_COMMAND&&LOWORD(wp)==IDCANCEL))&&!s->prompt&&!s->ready&&!IsWindowEnabled(GetDlgItem(hwnd,IDCANCEL)))return 0;
  if(msg==WM_SIZE&&!s->prompt&&IsWindow(s->window)){RECT r;GetClientRect(hwnd,&r);SetWindowPos(s->window,nullptr,0,0,r.right,r.bottom,SWP_NOZORDER|SWP_NOACTIVATE);}
  if(msg==WM_DPICHANGED){
    DeleteObject(s->heading);DeleteObject(s->text);DeleteObject(s->small);DeleteObject(s->background);
    initSurface(s,s->window,HIWORD(wp));
    auto r=reinterpret_cast<RECT*>(lp);SetWindowPos(hwnd,nullptr,r->left,r->top,r->right-r->left,r->bottom-r->top,SWP_NOZORDER|SWP_NOACTIVATE);layout(s);InvalidateRect(s->window,nullptr,TRUE);return 0;
  }
  return DefSubclassProc(hwnd,msg,wp,lp);
}
static void styleButton(HWND button, Surface* s, int x, int width) {
  SetWindowLongPtr(button,GWL_STYLE,(GetWindowLongPtr(button,GWL_STYLE)&~BS_TYPEMASK)|BS_OWNERDRAW|WS_TABSTOP);
  SetWindowPos(button,nullptr,s->px(x),s->px(320),s->px(width),s->px(40),SWP_NOZORDER);
  SetWindowSubclass(button,buttonProc,1,reinterpret_cast<DWORD_PTR>(s));
}
static int prompt(const std::wstring& title,const std::wstring& body,bool retry=false,bool cancel=true) {
  Surface s;s.prompt=true;s.title=title;s.body=body;
  HWND hwnd=CreateWindowEx(WS_EX_APPWINDOW|WS_EX_CONTROLPARENT,L"WeftMateInstallerPrompt",L"WeftMate",WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU,0,0,480,400,installParent,nullptr,module,&s);
  frame(hwnd,&s);
  resizeWindow(hwnd,&s,392);
  createLabels(&s);
  s.primary=CreateWindow(L"BUTTON",retry?tr(L"重试",L"Retry"):tr(L"卸载程序",L"Uninstall"),WS_CHILD|WS_VISIBLE|WS_TABSTOP,0,0,0,0,hwnd,reinterpret_cast<HMENU>(retry?IDRETRY:IDOK),module,nullptr);
  if(!cancel)SetWindowText(s.primary,tr(L"知道了",L"OK"));
  styleButton(s.primary,&s,320,128);
  if(cancel) { s.secondary=CreateWindow(L"BUTTON",tr(L"取消",L"Cancel"),WS_CHILD|WS_VISIBLE|WS_TABSTOP,0,0,0,0,hwnd,reinterpret_cast<HMENU>(IDCANCEL),module,nullptr);styleButton(s.secondary,&s,208,96); }
  closeControl(&s,true);
  if(installParent)EnableWindow(installParent,FALSE);
  ShowWindow(hwnd,SW_SHOWNOACTIVATE);SetFocus(cancel?s.secondary:s.primary);
  MSG msg;while(IsWindow(hwnd)&&GetMessage(&msg,nullptr,0,0)>0) {
    if(msg.message==WM_KEYDOWN&&msg.wParam==VK_ESCAPE) { SendMessage(hwnd,WM_CLOSE,0,0);continue; }
    if(msg.message==WM_KEYDOWN&&msg.wParam==VK_RETURN) {SendMessage(hwnd,WM_COMMAND,GetDlgCtrlID(GetFocus()),0);continue;}
    if(!IsDialogMessage(hwnd,&msg)) { TranslateMessage(&msg);DispatchMessage(&msg); }
  }
  if(installParent)EnableWindow(installParent,TRUE);
  return s.result;
}
// Skin the original NSIS message box, retaining its buttons/return IDs and all
// engine retry/cancel decisions. Never intercept silent installations.
static LRESULT CALLBACK errorProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp,UINT_PTR,DWORD_PTR data) {
  auto s=reinterpret_cast<Surface*>(data);
  if(msg==WM_COMMAND&&LOWORD(wp)==90){PostMessage(hwnd,WM_CLOSE,0,0);return 0;}
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
  if(code==HCBT_ACTIVATE&&!choosingInstallFolder()) {
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
        initSurface(s,hwnd);frame(hwnd,s);resizeWindow(hwnd,s,392);SetWindowText(hwnd,L"WeftMate");
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
        closeControl(s,true);
      }
    }
  }
  return CallNextHookEx(nullptr,code,wp,lp);
}
extern "C" void __stdcall Work() {
  SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
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
  SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  installParent=parent;
  DWORD light=1,bytes=sizeof(light);RegGetValue(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",L"AppsUseLightTheme",RRF_RT_REG_DWORD,nullptr,&light,&bytes);dark=light==0;
  english=PRIMARYLANGID(GetUserDefaultUILanguage())!=LANG_CHINESE;
#ifdef WEFT_QA
  wchar_t theme[16]{};GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_THEME",theme,16);if(wcscmp(theme,L"dark")==0)dark=true;if(wcscmp(theme,L"light")==0)dark=false;
#endif
  mark=static_cast<HICON>(LoadImage(nullptr,icon,IMAGE_ICON,256,256,LR_LOADFROMFILE));
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
  if(progressSurface){RemoveWindowSubclass(parent,frameProc,2);if(IsWindow(progressSurface->window))DestroyWindow(progressSurface->window);delete progressSurface;progressSurface=nullptr;}
  installParent=parent;
  Work();
  auto s=new Surface;s->operation=operation;
  s->title=operation==2?tr(L"正在卸载",L"Uninstalling"):operation==1?tr(L"正在更新",L"Updating"):tr(L"正在安装",L"Installing");
  s->body=operation==2?tr(L"只移除程序，对话、记忆和设置都会保留。",L"Removing the app. Conversations, memories and settings stay."):operation==1?tr(L"为你准备新版 WeftMate，原有数据会保留。",L"Preparing the new WeftMate. Your existing data stays."):tr(L"正在把 WeftMate 安装到这台电脑，无需其他操作。",L"Setting up WeftMate on this computer. Nothing else to do.");
  EnumChildWindows(parent,findProgress,reinterpret_cast<LPARAM>(&s->progress));
  HWND child=GetWindow(parent,GW_CHILD);while(child) { SetWindowSubclass(child,hiddenProc,1,0);ShowWindow(child,SW_HIDE);child=GetWindow(child,GW_HWNDNEXT); }
  SetWindowText(parent,L"WeftMate");s->dpi=surfaceDpi(parent);frame(parent,s);resizeWindow(parent,s,326);
  HWND overlay=CreateWindowEx(WS_EX_CONTROLPARENT,L"WeftMateInstallerSurface",s->title.c_str(),WS_CHILD|WS_VISIBLE,0,0,s->px(480),s->px(326),parent,nullptr,module,s);
  progressSurface=s;createLabels(s);
  closeControl(s,false);
  SetWindowPos(overlay,HWND_TOP,0,0,0,0,SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE);SetTimer(overlay,1,120,nullptr);
}
extern "C" const wchar_t* __stdcall DefaultDirectory(const wchar_t* directory) {
  selectedDirectory=defaultInstallFolder(directory);return selectedDirectory.c_str();
}
extern "C" void __stdcall Ready(HWND parent,const wchar_t* directory,unsigned int kilobytes,const wchar_t* executable,const wchar_t* config,const wchar_t* fallback) {
  Attach(parent,0);auto s=progressSurface;KillTimer(s->window,1);s->ready=true;
  s->title=tr(L"准备安装 WeftMate",L"Install WeftMate");s->body=tr(L"选择安装位置，准备好后即可开始。",L"Choose where to install, then start when you are ready.");
  selectedDirectory=directory;locationExecutable=executable;locationKilobytes=kilobytes;
  wchar_t data[32768]{};ExpandEnvironmentStrings(dataPath(config,fallback).c_str(),data,32768);locationData=data;
  SetWindowText(s->window,s->title.c_str());SetWindowText(s->headingLabel,s->title.c_str());SetWindowText(s->bodyLabel,s->body.c_str());
  std::wstring display=directory;
#ifdef WEFT_QA
  wchar_t local[32768]{};GetEnvironmentVariable(L"LOCALAPPDATA",local,32768);if(_wcsnicmp(display.c_str(),local,wcslen(local))==0)display=L"%LOCALAPPDATA%"+display.substr(wcslen(local));
#endif
  s->pathLabel=CreateWindow(L"STATIC",display.c_str(),WS_CHILD|WS_VISIBLE|SS_OWNERDRAW|SS_NOTIFY,0,0,0,0,s->window,nullptr,module,nullptr);
  SetWindowSubclass(s->pathLabel,pathProc,1,reinterpret_cast<DWORD_PTR>(s));
  s->change=CreateWindow(L"BUTTON",tr(L"更改",L"Change"),WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,s->window,reinterpret_cast<HMENU>(81),module,nullptr);
  s->primary=CreateWindow(L"BUTTON",tr(L"安装",L"Install"),WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,s->window,reinterpret_cast<HMENU>(80),module,nullptr);
  SetWindowSubclass(s->primary,buttonProc,1,reinterpret_cast<DWORD_PTR>(s));
  SetWindowSubclass(s->change,buttonProc,1,reinterpret_cast<DWORD_PTR>(s));
  EnableWindow(s->close,TRUE);resizeWindow(parent,s,392);SetWindowPos(s->window,nullptr,0,0,s->px(480),s->px(392),SWP_NOZORDER);layout(s);InvalidateRect(s->window,nullptr,TRUE);SetFocus(s->primary);
}
extern "C" int __stdcall Validate() {
  auto error=validateInstallFolder(selectedDirectory,locationExecutable,locationData,locationKilobytes,english);
  if(error.empty())return 1;
  auto s=progressSurface;s->body=error;SetWindowText(s->bodyLabel,error.c_str());InvalidateRect(s->window,nullptr,TRUE);return 0;
}
extern "C" const wchar_t* __stdcall Directory(){return selectedDirectory.c_str();}
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
extern "C" int __stdcall QuitApp(const wchar_t* directory,const wchar_t* executable,int) {
  if(!runningIn(directory))return 1;
  // Older versions do not understand --quit; launching them would show a window.
  if(GetFileAttributes((std::wstring(directory)+L"\\resources\\weftmate-install.json").c_str())==INVALID_FILE_ATTRIBUTES)return 0;
  std::wstring file=std::wstring(directory)+L"\\"+executable;
  std::wstring command=L"\""+file+L"\" --quit";
  STARTUPINFO startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESHOWWINDOW;startup.wShowWindow=SW_HIDE;
  PROCESS_INFORMATION process{};
  if(!CreateProcess(file.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&process))return 0;
  CloseHandle(process.hThread);
  DWORD waited=WaitForSingleObject(process.hProcess,21000),code=1;
  if(waited==WAIT_OBJECT_0)GetExitCodeProcess(process.hProcess,&code);
  CloseHandle(process.hProcess);
  if(code!=0)return 0;
  // Electron's auxiliary processes can finish just after the durable reply.
  for(int i=0;i<20&&runningIn(directory);i++)Sleep(100);
  return runningIn(directory)?0:1;
}
extern "C" void __stdcall CleanupWarning() {
  prompt(tr(L"程序清理未完成",L"App cleanup could not finish"),tr(L"你的数据已保留。请关闭 WeftMate 后重新安装，再尝试卸载；也可以在设置里关闭开机自启。",L"Your data is kept. Close WeftMate, reinstall and retry uninstalling. You can also disable launch at login in Settings."),false,false);
}
extern "C" void __stdcall AdminRequired() {
  prompt(tr(L"请重新打开安装包",L"Reopen the installer"),tr(L"请右键安装包，选择“以管理员身份运行”，再继续更新。原有程序和数据会保留。",L"Right-click the installer and choose Run as administrator to continue updating. Your current app and data are kept."),false,false);
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
  if(IsWindow(installParent)) {RemoveWindowSubclass(installParent,frameProc,2); HWND child=GetWindow(installParent,GW_CHILD);while(child) { RemoveWindowSubclass(child,hiddenProc,1);child=GetWindow(child,GW_HWNDNEXT); } }
  UnregisterClass(L"WeftMateInstallerSurface",module);UnregisterClass(L"WeftMateInstallerPrompt",module);
  if(mark) { DestroyIcon(mark);mark=nullptr; }
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID) { if(reason==DLL_PROCESS_ATTACH)module=instance;return TRUE; }
