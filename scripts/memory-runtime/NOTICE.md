# Windows memory runtime notices

The accompanying `runtime-lock.json` records exact versions, hashes, download
sources and licenses. Python retains its upstream `python/LICENSE.txt`.
MemoWeft retains `MemoWeft-LICENSE`; each dependency retains its wheel metadata
and upstream license files under `site-packages/*.dist-info` and package folders.
The fixed multilingual E5 model and tokenizer are MIT licensed by intfloat:
https://huggingface.co/intfloat/multilingual-e5-small/tree/614241f622f53c4eeff9890bdc4f31cfecc418b3

The full layer contains unmodified Microsoft Visual C++ 14.44.35211.0 x64
`msvcp140.dll` and `msvcp140_1.dll`, extracted from the fixed official Microsoft
redistributable, with its original `VC-LICENSE.rtf`. The redistributable installer
is never executed or installed by this build. These files are deployed beside
the managed executable; Windows supplies the Universal CRT.

Microsoft limits redistribution to licensed Visual Studio users and the
applicable Microsoft Software License Terms. The application distributor must
establish its redistribution rights before release. Carrying the license is
not by itself evidence of those rights. App-local runtime servicing follows
application updates; review Microsoft runtime updates with each pin update.
https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files
https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution

This payload contains no account database or user data. The base layer provides
lexical memory dependencies only. Automatic application configuration and
installation/upgrade acceptance are separate work.
