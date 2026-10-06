@echo off
cd /d "%~dp0"
start /b "Fox Server" node server.mjs
powershell -NoProfile -Command "$foxReady=$false; for($foxTry=0; $foxTry -lt 30; $foxTry++){try{Invoke-WebRequest -Uri 'http://127.0.0.1:8777/' -Method Head -UseBasicParsing -TimeoutSec 1 | Out-Null; $foxReady=$true; break}catch{Start-Sleep -Milliseconds 200}}; if($foxReady){Start-Process 'http://127.0.0.1:8777/'}"
pause
