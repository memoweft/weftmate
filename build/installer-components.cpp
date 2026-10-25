#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <string>

static bool physicalDirectory(const std::wstring& path) {
  const auto flags=GetFileAttributesW(path.c_str());
  return flags!=INVALID_FILE_ATTRIBUTES&&(flags&FILE_ATTRIBUTE_DIRECTORY)&&!(flags&FILE_ATTRIBUTE_REPARSE_POINT);
}
static bool textMatches(const std::wstring& path,const wchar_t* expected) {
  auto file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
  if(file==INVALID_HANDLE_VALUE)return false;
  BY_HANDLE_FILE_INFORMATION info{};
  wchar_t text[256]{};DWORD bytes=0;
  const bool ok=GetFileInformationByHandle(file,&info)&&!(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)&&
    ReadFile(file,text,sizeof(text)-sizeof(wchar_t),&bytes,nullptr)&&bytes==wcslen(expected)*sizeof(wchar_t)&&
    std::wstring(text,bytes/sizeof(wchar_t))==expected;
  CloseHandle(file);return ok;
}
static bool writeText(const std::wstring& path,const wchar_t* text) {
  auto file=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
  if(file==INVALID_HANDLE_VALUE)return false;
  BY_HANDLE_FILE_INFORMATION info{};DWORD bytes=0;
  const DWORD size=static_cast<DWORD>(wcslen(text)*sizeof(wchar_t));
  const bool ok=GetFileInformationByHandle(file,&info)&&!(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)&&
    WriteFile(file,text,size,&bytes,nullptr)&&bytes==size&&FlushFileBuffers(file);
  CloseHandle(file);return ok;
}
extern "C" int __stdcall PrepareComponents(const wchar_t* directory,const wchar_t* owner) {
  const std::wstring root=directory;
  const bool created=CreateDirectoryW(directory,nullptr)!=FALSE;
  if(!created&&GetLastError()!=ERROR_ALREADY_EXISTS)return 0;
  if(!physicalDirectory(root))return 0;
  return created?writeText(root+L"\\.weftmate-components",owner):textMatches(root+L"\\.weftmate-components",owner);
}
extern "C" int __stdcall ComponentReady(const wchar_t* directory,const wchar_t* version) {
  return physicalDirectory(directory)&&textMatches(std::wstring(directory)+L".complete",version);
}
extern "C" int __stdcall PrepareComponent(const wchar_t* directory,const wchar_t* version) {
  const std::wstring target=directory,parent=target.substr(0,target.find_last_of(L'\\'));
  const std::wstring root=parent.substr(0,parent.find_last_of(L'\\'));
  if(!physicalDirectory(root))return 0;
  for(const auto& path:{parent,target}) {
    if(!CreateDirectoryW(path.c_str(),nullptr)&&GetLastError()!=ERROR_ALREADY_EXISTS)return 0;
    if(!physicalDirectory(path))return 0;
  }
  // A truncated directory name must never overwrite a different full hash.
  const auto marker=target+L".complete";
  return GetFileAttributesW(marker.c_str())==INVALID_FILE_ATTRIBUTES||textMatches(marker,version);
}
extern "C" int __stdcall CompleteComponent(const wchar_t* directory,const wchar_t* version) {
  return physicalDirectory(directory)&&writeText(std::wstring(directory)+L".complete",version);
}
// Remove links themselves. Never traverse a junction into another tree.
static bool removeTree(const std::wstring& root) {
  const auto flags=GetFileAttributesW(root.c_str());
  if(flags==INVALID_FILE_ATTRIBUTES)return GetLastError()==ERROR_FILE_NOT_FOUND||GetLastError()==ERROR_PATH_NOT_FOUND;
  if(!(flags&FILE_ATTRIBUTE_DIRECTORY))return DeleteFileW(root.c_str())!=FALSE;
  if(flags&FILE_ATTRIBUTE_REPARSE_POINT)return RemoveDirectoryW(root.c_str())!=FALSE;
  WIN32_FIND_DATAW data{};auto search=FindFirstFileW((root+L"\\*").c_str(),&data);
  if(search==INVALID_HANDLE_VALUE)return false;
  bool ok=true;
  do {
    if(wcscmp(data.cFileName,L".")&&wcscmp(data.cFileName,L"..")&&!removeTree(root+L"\\"+data.cFileName)){ok=false;break;}
  } while(FindNextFileW(search,&data));
  FindClose(search);
  return ok&&RemoveDirectoryW(root.c_str())!=FALSE;
}
extern "C" int __stdcall RemoveComponents(const wchar_t* directory,const wchar_t* owner) {
  if(!physicalDirectory(directory)||!textMatches(std::wstring(directory)+L"\\.weftmate-components",owner))return 0;
  return removeTree(directory);
}
