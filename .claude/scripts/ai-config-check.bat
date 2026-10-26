@echo off
REM ===========================================================================
REM  AI Config Check (Windows) - offline Layer-1 gates, no network.
REM  Runs: generate-mirrors (sync) -> check-propagation -> upstream spec-lint.
REM
REM  Usage:
REM    Double-click this file, OR from any shell:
REM      .claude\scripts\ai-config-check.bat
REM    CI / pre-commit (no pause, propagates exit code):
REM      .claude\scripts\ai-config-check.bat --ci
REM    Read-only (skip the mirror sync write):
REM      .claude\scripts\ai-config-check.bat --check-only
REM
REM  To refresh the spec snapshot from the live docs, run /upstream-check inside
REM  Claude Code (that step needs WebFetch and cannot run from a .bat).
REM ===========================================================================
setlocal enabledelayedexpansion
set "DIR=%~dp0"
set "FAIL=0"
set "CHECKONLY=0"
set "CI=0"
for %%A in (%*) do (
    if /i "%%~A"=="--check-only" set "CHECKONLY=1"
    if /i "%%~A"=="--ci" set "CI=1"
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found on PATH. Install it from https://nodejs.org
    set "FAIL=1"
    goto :done
)

echo ============================================================
echo   AI Config Check  ^(offline^)
echo ============================================================

if "%CHECKONLY%"=="0" (
    echo.
    echo [sync] Generate mirrors...
    node "%DIR%generate-mirrors.js"
    if errorlevel 1 set "FAIL=1"
)

echo.
echo [1] Propagation gate...
node "%DIR%check-propagation.js"
if errorlevel 1 set "FAIL=1"

echo.
echo [2] Upstream spec-lint...
node "%DIR%spec-lint.js"
if errorlevel 1 set "FAIL=1"

:done
echo.
echo ------------------------------------------------------------
if "%FAIL%"=="1" (
    echo   RESULT: FAIL - fix the errors above, then re-run.
) else (
    echo   RESULT: PASS - config is consistent and spec-current.
)
echo ------------------------------------------------------------

REM Pause only on double-click (the bat name appears in cmdcmdline), never in CI.
if "%CI%"=="1" goto :exit
set "CL=!cmdcmdline!"
set "STRIPPED=!CL:%~nx0=!"
if not "!CL!"=="!STRIPPED!" pause

:exit
exit /b %FAIL%
