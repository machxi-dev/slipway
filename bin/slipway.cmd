@echo off
rem Slipway's runner for cmd.exe and the PowerShell tool, which cannot run the extensionless
rem bin\slipway. It runs that same file with node, so both paths share one entry point. Its
rem folder comes from its own path, never from the plugin-root variable (docs/spikes/). The call
rem to :find_dp0 keeps %~dp0 right when cmd found this file on PATH under a quoted name.
setlocal
call :find_dp0
node "%dp0%slipway" %*
exit /b %ERRORLEVEL%

:find_dp0
set "dp0=%~dp0"
exit /b
