#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "installer-directory.h"
#include "installer-payload.h"
#include <shobjidl.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <vector>
static thread_local bool pickerOpen=false;
bool choosingInstallFolder(){return pickerOpen;}
std::wstring defaultInstallFolder(const std::wstring& directory) {
  if(directory.size()+WEFT_INSTALL_MAX_SUFFIX<260||GetFileAttributes(directory.c_str())!=INVALID_FILE_ATTRIBUTES)return directory;
  // Only shorten the auto-generated per-user candidate name. Normal WeftMate
  // already fits; existing locations and custom paths stay authoritative.
  wchar_t local[32768]{};GetEnvironmentVariable(L"LOCALAPPDATA",local,32768);
  const std::wstring prefix=std::wstring(local)+L"\\Programs\\WeftMate";
  if(directory.compare(0,prefix.size(),prefix)!=0)return directory;
  if(directory.size()<=prefix.size()||(directory[prefix.size()]!=L' '&&directory[prefix.size()]!=L'-'))return directory;
  const auto identity=directory.substr(prefix.size()+1);
  if(identity.empty()||identity.find_first_not_of(L"abcdefghijklmnopqrstuvwxyz0123456789")!=std::wstring::npos)return directory;
  return std::wstring(local)+L"\\Programs\\WM-"+identity;
}

static bool within(const std::wstring& path,const std::wstring& root) {
  if(root.empty()||path.size()<root.size()||_wcsnicmp(path.c_str(),root.c_str(),root.size())!=0)return false;
  return path.size()==root.size()||path[root.size()]==L'\\';
}
static std::wstring environment(const wchar_t* name) {wchar_t value[32768]{};GetEnvironmentVariable(name,value,32768);return value;}
static std::wstring physicalDataPath(const std::wstring& path) {
  if(path.empty())return path;
  wchar_t full[32768]{};std::wstring result=GetFullPathName(path.c_str(),32768,full,nullptr)?full:path;
  auto handle=CreateFile(result.c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,nullptr);
  if(handle!=INVALID_HANDLE_VALUE){DWORD length=GetFinalPathNameByHandle(handle,full,32768,FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);CloseHandle(handle);if(length&&length<32768){result=full;if(result.compare(0,8,L"\\\\?\\UNC\\")==0)result=L"\\\\"+result.substr(8);else if(result.compare(0,4,L"\\\\?\\")==0)result=result.substr(4);}}
  while(result.size()>3&&result.back()==L'\\')result.pop_back();return result;
}
static bool oldOrEmpty(const std::wstring& folder,const std::wstring& executable) {
  if(GetFileAttributes((folder+L"\\"+executable).c_str())!=INVALID_FILE_ATTRIBUTES)return true;
  WIN32_FIND_DATA data{};auto search=FindFirstFile((folder+L"\\*").c_str(),&data);
  if(search==INVALID_HANDLE_VALUE)return true;bool empty=true;
  do{if(wcscmp(data.cFileName,L".")&&wcscmp(data.cFileName,L"..")){empty=false;break;}}while(FindNextFile(search,&data));
  FindClose(search);return empty;
}
std::wstring resolveInstallFolder(const std::wstring& folder,const std::wstring& executable) {
  wchar_t full[32768]{};if(!GetFullPathName(folder.c_str(),32768,full,nullptr))return {};
  std::wstring result=full;while(result.size()>3&&result.back()==L'\\')result.pop_back();
  if(_wcsicmp(PathFindFileName(result.c_str()),L"WeftMate")==0&&oldOrEmpty(result,executable))return result;
  return result+L"\\WeftMate";
}
std::wstring validateInstallFolder(const std::wstring& path,const std::wstring& executable,const std::wstring& dataDirectory,unsigned int kilobytes,bool english) {
  auto tr=[english](const wchar_t* zh,const wchar_t* en){return std::wstring(english?en:zh);};
  wchar_t windows[32768]{};GetWindowsDirectory(windows,32768);
  auto local=environment(L"LOCALAPPDATA");
  auto physicalData=physicalDataPath(dataDirectory);
  bool protectedProgram=within(path,environment(L"ProgramFiles"))||within(path,environment(L"ProgramFiles(x86)"))||within(path,environment(L"ProgramW6432"));
  if(within(path,windows)||(protectedProgram&&!IsUserAnAdmin())||within(path,environment(L"ProgramData"))||within(path,environment(L"APPDATA"))||(within(path,local)&&!within(path,local+L"\\Programs"))||within(path,physicalData)||(!physicalData.empty()&&within(physicalData,path)))
    return tr(L"这里是系统或数据目录。请选择其他文件夹。",L"This is a system or data folder. Choose another folder.");
  if(path.empty()||path.size()+WEFT_INSTALL_MAX_SUFFIX>=260)
    return tr(L"这个位置的路径太长。请选择更靠近磁盘根目录的文件夹。",L"This path is too long for the app files. Choose a folder closer to the drive root.");
  if(PathIsRelative(path.c_str()))return tr(L"请选择一个完整的文件夹路径。",L"Choose an absolute folder path.");
  if(GetFileAttributes(path.c_str())!=INVALID_FILE_ATTRIBUTES&&!oldOrEmpty(path,executable))
    return tr(L"这个程序文件夹已经有其他内容。请选择另一个位置。",L"This app folder already contains other files. Choose another location.");
  std::wstring parent=path;while(GetFileAttributes(parent.c_str())==INVALID_FILE_ATTRIBUTES) {std::vector<wchar_t> value(parent.begin(),parent.end());value.push_back(0);if(!PathRemoveFileSpec(value.data()))break;parent=value.data();}
  // An alias must not bypass the system/data boundary or make uninstall follow
  // a junction into another tree. Require a physical folder for program files.
  for(std::wstring ancestor=parent;;) {
    if(GetFileAttributes(ancestor.c_str())&FILE_ATTRIBUTE_REPARSE_POINT)
      return tr(L"这个位置经过了文件夹链接。请选择一个实际的文件夹。",L"This location uses a folder link. Choose a physical folder.");
    std::vector<wchar_t> value(ancestor.begin(),ancestor.end());value.push_back(0);
    if(!PathRemoveFileSpec(value.data())||ancestor==value.data())break;ancestor=value.data();
  }
  ULARGE_INTEGER free{};if(!GetDiskFreeSpaceEx(parent.c_str(),&free,nullptr,nullptr)||free.QuadPart<static_cast<ULONGLONG>(kilobytes)*1024+32*1024*1024)
    return tr(L"这个磁盘的可用空间不够。请释放空间，或选择另一个磁盘。",L"There is not enough free space. Free space or choose another drive.");
  wchar_t probe[MAX_PATH]{};if(!GetTempFileName(parent.c_str(),L"wfi",0,probe))
    return tr(L"这个位置无法写入。请选择你有写入权限的文件夹；安装不会申请管理员权限。",L"This location is not writable. Choose a folder you can write to; setup will not request administrator access.");
  DeleteFile(probe);
  if(!CreateDirectory(probe,nullptr))
    return tr(L"这个位置无法创建程序文件夹。请选择你有写入权限的其他位置。",L"This location cannot create the app folder. Choose another writable location.");
  RemoveDirectory(probe);return {};
}
std::wstring chooseInstallFolder(HWND owner,const std::wstring& initial) {
#ifdef WEFT_QA
  wchar_t test[32768]{};if(GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_PICK_FOLDER",test,32768)) {
    if(test[0]!=L'@')return test;
    auto file=CreateFile(test+1,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(file==INVALID_HANDLE_VALUE)return {};
    wchar_t value[32768]{};DWORD read=0;ReadFile(file,value,sizeof(value)-sizeof(wchar_t),&read,nullptr);CloseHandle(file);
    std::wstring result=value[0]==0xfeff?value+1:value;while(!result.empty()&&(result.back()==L'\r'||result.back()==L'\n'))result.pop_back();return result;
  }
#endif
  HRESULT init=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED|COINIT_DISABLE_OLE1DDE);
  IFileOpenDialog* dialog=nullptr;std::wstring result;
  if(SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&dialog)))) {
    DWORD options=0;dialog->GetOptions(&options);
#ifdef WEFT_QA
    // Keep real Shell pinned locations out of synthetic public screenshots,
    // and do not add the disposable fixture to the user's recent locations.
    wchar_t navigationRoot[32768]{};
    bool privateNavigation=GetEnvironmentVariable(L"WEFTMATE_INSTALLER_TEST_PICK_ROOT",navigationRoot,32768)>0;
    if(privateNavigation)options|=FOS_HIDEPINNEDPLACES|FOS_DONTADDTORECENT;
#endif
    dialog->SetOptions(options|FOS_PICKFOLDERS|FOS_FORCEFILESYSTEM|FOS_PATHMUSTEXIST);
    IShellItem* folder=nullptr;if(SUCCEEDED(SHCreateItemFromParsingName(initial.c_str(),nullptr,IID_PPV_ARGS(&folder)))){dialog->SetFolder(folder);folder->Release();}
#ifdef WEFT_QA
    if(privateNavigation){IShellItem* root=nullptr;IFileDialog2* isolated=nullptr;if(SUCCEEDED(SHCreateItemFromParsingName(navigationRoot,nullptr,IID_PPV_ARGS(&root)))){if(SUCCEEDED(dialog->QueryInterface(IID_PPV_ARGS(&isolated)))){isolated->SetNavigationRoot(root);isolated->Release();}root->Release();}}
#endif
    pickerOpen=true;auto selected=dialog->Show(owner);pickerOpen=false;
    if(SUCCEEDED(selected)){IShellItem* item=nullptr;if(SUCCEEDED(dialog->GetResult(&item))){PWSTR name=nullptr;if(SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH,&name))){result=name;CoTaskMemFree(name);}item->Release();}}
    dialog->Release();
  }
  if(SUCCEEDED(init))CoUninitialize();return result;
}
