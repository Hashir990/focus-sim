@echo off
REM  Focus Simulator - build and run, from source.
REM
REM  Double-click this, or run `start.cmd` in a terminal here.
REM
REM  Why this file exists: there are two Focus Simulators on this machine. The
REM  one in the Start menu is the *installed* copy and only changes when a new
REM  version is published. This one rebuilds from the code in this folder and
REM  runs that. Editing the source and then launching from the Start menu shows
REM  you the old app, which has cost an entire afternoon of "that change did
REM  nothing" at least once.
REM
REM  The build stamp is printed before the window opens so there is never any
REM  doubt about which of the two you are looking at. It matches the one in the
REM  bottom of the menu.

setlocal
cd /d "%~dp0"

echo.
echo   Focus Simulator - building from source...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, or not on PATH.
  echo   Get it from https://nodejs.org  ^(the LTS one^), then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   First run - installing dependencies. This takes a few minutes, once.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. Nothing has been changed.
    pause
    exit /b 1
  )
)

call npm run build
if errorlevel 1 (
  echo.
  echo   The build failed, so the app was not started. The error is above.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -e "const f=require(''fs'').readFileSync(''dist/index.html'',''utf8'');const m=f.match(/build \d{4}-\d\d-\d\d \d\d:\d\d/);console.log(m?m[0]:''unknown build'')"') do set STAMP=%%v

echo.
echo   Running %STAMP%  -  check this matches the footer in the menu.
echo.

call npx electron .

endlocal
