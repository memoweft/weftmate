#include "../../build/installer-directory.h"
#include <iostream>

int wmain(int argc,wchar_t** argv) {
  if(argc!=3)return 2;
  // The actual G7 candidate default in a clean classic Windows Sandbox.
  constexpr size_t sandboxDefaultDirectoryChars=70;
  const std::wstring local=argv[1],original=local+L"\\Programs\\WeftMate-g7cbc435a7";
  SetEnvironmentVariable(L"LOCALAPPDATA",local.c_str());
  const auto suffix=static_cast<size_t>(_wtoi(argv[2]));
  const auto target=defaultInstallFolder(original);
  if(original.size()!=sandboxDefaultDirectoryChars||target.size()+suffix>=260)return 3;
  if(defaultInstallFolder(local+L"\\Programs\\WeftMate")!=local+L"\\Programs\\WeftMate")return 6;
  if(defaultInstallFolder(local+L"\\custom\\WeftMate g7cbc435a7")!=local+L"\\custom\\WeftMate g7cbc435a7")return 7;
  CreateDirectory(original.c_str(),nullptr);
  if(defaultInstallFolder(original)!=original)return 8;
  RemoveDirectory(original.c_str());
  const auto error=validateInstallFolder(target,L"WeftMate-g7cbc435a7.exe",local+L"\\data",1,false);
  if(!error.empty()){std::wcerr<<error<<L"\n";return 1;}
  const auto boundary=target+std::wstring(259-suffix-target.size(),L'x');
  if(!validateInstallFolder(boundary,L"WeftMate.exe",local+L"\\data",1,false).empty())return 4;
  if(validateInstallFolder(boundary+L"x",L"WeftMate.exe",local+L"\\data",1,false).empty())return 5;
  std::cout<<"default-directory-accepted chars="<<target.size()<<" payloadSuffix="<<suffix<<"\n";
  return 0;
}
