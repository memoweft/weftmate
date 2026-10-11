#include "../../build/installer-directory.h"
#include <iostream>
#include <stdexcept>
static void check(bool value,const char* name){if(!value)throw std::runtime_error(name);std::cout<<name<<"\n";}
int wmain(int argc,wchar_t** argv){
  if(argc!=2)return 2;
  const std::wstring root=argv[1],exe=L"WeftMate-inst1qa.exe",data=root+L"\\data";
  try {
    check(resolveInstallFolder(root,exe)==root+L"\\WeftMate","parent-gets-app-child");
    check(resolveInstallFolder(root+L"\\WeftMate",exe)==root+L"\\WeftMate","empty-app-folder-is-not-nested");
    check(validateInstallFolder(root+L"\\WeftMate",exe,data,1,false).empty(),"physical-writable-folder-accepted");
    check(!validateInstallFolder(data+L"\\WeftMate",exe,data,1,false).empty(),"data-descendant-rejected");
    check(!validateInstallFolder(root,exe,data,1,false).empty(),"data-ancestor-rejected");
    check(!validateInstallFolder(root+L"\\WeftMate",exe,root+L"\\other\\..\\WeftMate\\data",1,false).empty(),"normalized-data-ancestor-rejected");
    check(!validateInstallFolder(root+L"\\old\\WeftMate",exe,root+L"\\data-link",1,false).empty(),"physical-data-alias-ancestor-rejected");
    check(!validateInstallFolder(root+L"\\data-link\\WeftMate",exe,data,1,false).empty(),"installation-junction-rejected");
    for(auto variable:{L"SystemRoot",L"ProgramFiles",L"ProgramFiles(x86)",L"ProgramW6432",L"ProgramData",L"APPDATA"}){
      wchar_t folder[32768]{};if(GetEnvironmentVariable(variable,folder,32768))check(!validateInstallFolder(std::wstring(folder)+L"\\WeftMate",exe,data,1,false).empty(),"system-folder-rejected");
    }
    check(!validateInstallFolder(root+L"\\WeftMate",exe,data,0xffffffff,false).empty(),"insufficient-free-space-rejected");
    check(!validateInstallFolder(root+L"\\"+std::wstring(220,L'x'),exe,data,1,false).empty(),"runtime-path-length-rejected");
    std::cout<<"Directory checks passed.\n";return 0;
  }catch(const std::exception& error){std::cerr<<error.what()<<"\n";return 1;}
}
