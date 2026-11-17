@echo off
chcp 65001 >nul
rem Agent Dash 설치: 프로그램을 %LOCALAPPDATA%\agent-dash 에 복사하고 Hermes config.yaml 에 훅을 등록.
rem 사용법: install.cmd [HERMES_HOME 경로]   (생략하면 %HERMES_HOME% 또는 %USERPROFILE%\.hermes)
"%~dp0dash\dash.exe" install %*
pause
