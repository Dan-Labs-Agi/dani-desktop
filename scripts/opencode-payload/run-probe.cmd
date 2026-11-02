@echo off
rem Runs the ACP initialize probe against this payload on Windows. Exit 0 = PASS.
rem No interpreter is bundled with the OpenCode payload, so the probe pipes one
rem JSON-RPC initialize request to the agent and checks the reply with findstr.
setlocal
set "ROOT=%~dp0.."
set "TMPPROBE=%TEMP%\opencode-probe-%RANDOM%%RANDOM%"
mkdir "%TMPPROBE%" 2>nul
set "HOME=%TMPPROBE%"
set "OUT=%TMPPROBE%\out.jsonl"
echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}} | "%ROOT%\bin\opencode.exe" acp --pure > "%OUT%" 2>nul
findstr /c:"agentInfo" "%OUT%" > "%TMPPROBE%\line.json" || exit /b 1
type "%TMPPROBE%\line.json"
findstr /c:"OpenCode" "%TMPPROBE%\line.json" >nul || exit /b 1
findstr /c:"1.18.32" "%TMPPROBE%\line.json" >nul || exit /b 1
echo PROBE RESULT: PASS (OpenCode 1.18.32, ACP initialize)
exit /b 0
