@echo off
setlocal
"%~dp0resources\harness\node\node.exe" "%~dp0resources\harness\node_modules\@deepseek-ai\dsh\lib\bin.js" %*
exit /b %ERRORLEVEL%
