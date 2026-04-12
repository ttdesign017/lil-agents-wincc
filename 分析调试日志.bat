@echo off
chcp 65001 >nul
echo ========================================
echo  WalkerCharacter 跳帧问题调试工具
echo ========================================
echo.

REM 检查日志文件
set LOG_FILE=%APPDATA%\lil-agents-win\walker-debug.log

if exist "%LOG_FILE%" (
    echo [√] 找到日志文件: %LOG_FILE%
    echo.
    
    REM 显示文件大小
    for %%A in ("%LOG_FILE%") do (
        set SIZE=%%~zA
    )
    echo [i] 文件大小: %SIZE% 字节
    echo.
    
    REM 运行分析
    echo 正在分析日志...
    echo.
    node analyze-debug-log.js
    
    echo.
    echo ========================================
    echo  分析完成
    echo ========================================
    echo.
    echo 日志文件位置: %LOG_FILE%
    echo.
    pause
) else (
    echo [×] 未找到日志文件
    echo.
    echo 请确保:
    echo   1. 已经启动应用 (npm run dev)
    echo   2. 角色已经行走并进入 END 阶段
    echo   3. 应用已正常退出
    echo.
    echo 或者:
    echo   - 按 Ctrl+Shift+D 导出日志文件
    echo   - 将日志文件放到 %APPDATA%\lil-agents-win\ 目录下
    echo.
    pause
)
