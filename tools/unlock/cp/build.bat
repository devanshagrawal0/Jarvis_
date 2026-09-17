@echo off
setlocal
cd /d "%~dp0"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 ( echo VCVARS FAILED & exit /b 1 )
rc /nologo /fo resources.res resources.rc
if errorlevel 1 ( echo RC FAILED & exit /b 1 )
cl /nologo /LD /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /W3 /I. ^
   Dll.cpp CSampleProvider.cpp CSampleCredential.cpp helpers.cpp resources.res ^
   /link /DEF:jarvisunlock.def /OUT:JarvisUnlock.dll ^
   secur32.lib shlwapi.lib credui.lib user32.lib gdi32.lib ole32.lib advapi32.lib
if errorlevel 1 ( echo LINK FAILED & exit /b 1 )
echo BUILD_OK
endlocal
