@echo off
chcp 65001 >nul
echo ========================================
echo  调试系统验证工具
echo ========================================
echo.

REM 检查 Electron 进程
tasklist | findstr "electron.exe" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [√] Electron 正在运行
    echo.
) else (
    echo [×] Electron 未运行
    echo.
    echo 请先启动应用: npm run dev
    echo.
    pause
    exit /b 1
)

REM 检查日志文件
set LOG_FILE=%APPDATA%\lil-agents-win\walker-debug.log

if exist "%LOG_FILE%" (
    echo [√] 日志文件存在: %LOG_FILE%
    
    REM 显示文件内容
    echo.
    echo === 日志文件内容 ===
    type "%LOG_FILE%"
    echo.
    echo === 日志文件结束 ===
    echo.
    
    for %%A in ("%LOG_FILE%") do (
        set SIZE=%%~zA
    )
    echo 文件大小: %SIZE% 字节
    echo.
    
    if %SIZE% LSS 100 (
        echo [!] 警告: 日志文件很小,可能只有初始化消息
        echo     这说明调试日志没有被写入!
        echo.
    )
) else (
    echo [×] 日志文件不存在
    echo.
    echo 位置: %LOG_FILE%
    echo.
    echo 这说明 Electron 主进程的日志初始化没有执行
    echo 或者应用还没有正常退出
    echo.
)

echo ========================================
echo  下一步操作
echo ========================================
echo.
echo 1. 如果日志文件很小或不存在:
echo    - 完全关闭 Electron (任务管理器结束进程)
echo    - 重新运行: npm run dev
echo    - 等待角色行走后再关闭应用
echo.
echo 2. 如果日志文件有内容:
echo    - 运行: node analyze-debug-log.js
echo    - 或直接将日志内容复制给开发者分析
echo.
echo 3. 使用快捷键 (在 Electron 窗口中):
echo    - Ctrl+Shift+L : 在控制台查看日志
echo    - Ctrl+Shift+D : 下载日志文件
echo    - Ctrl+Shift+E : 导出日志文件路径
echo.
pause
