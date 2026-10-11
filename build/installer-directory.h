#pragma once
#include <windows.h>
#include <string>
std::wstring chooseInstallFolder(HWND owner,const std::wstring& initial);
bool choosingInstallFolder();
std::wstring resolveInstallFolder(const std::wstring& folder,const std::wstring& executable);
std::wstring validateInstallFolder(const std::wstring& path,const std::wstring& executable,const std::wstring& dataDirectory,unsigned int kilobytes,bool english);
