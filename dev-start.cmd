@echo off
set "PATH=C:\Program Files\nodejs\;%PATH%"
echo [dev-start] PATH=%PATH%
echo [dev-start] node resolved to:
where node
cd /d "C:\Users\Owner\Desktop\Claude - scope\ScopeAssistantWeb"
echo [dev-start] cwd=%cd%
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
