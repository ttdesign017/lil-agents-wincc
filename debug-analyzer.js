/**
 * 自动调试脚本 - 用于分析 WalkerCharacter 的 END 阶段跳帧问题
 * 
 * 使用方法:
 * 1. 在浏览器开发者工具的 Console 中运行此脚本
 * 2. 或者保存为 snippet 后重复使用
 * 
 * 脚本会自动:
 * - 监控调试日志
 * - 分析 END 阶段的帧数据
 * - 生成分析报告
 */

(function() {
  'use strict';

  console.log('%c=== Walker Character Debug Analyzer ===', 'color: #00ff00; font-size: 16px; font-weight: bold;');
  console.log('等待角色行走并进入 END 阶段...\n');

  // 存储分析结果
  const analysisResults = {
    characters: {},
    totalWalks: 0,
    issues: []
  };

  // 分析 END 阶段数据
  function analyzeEndPhase(characterName, logs) {
    const endPhaseLogs = logs.filter(log => log.includes('END phase:'));
    const rAFLogs = logs.filter(log => log.includes('rAF tick: phase=end'));
    
    if (endPhaseLogs.length === 0) return null;

    const analysis = {
      character: characterName,
      totalFrames: endPhaseLogs.length,
      elapsedTimes: [],
      deltas: [],
      easeCoeffs: [],
      progressions: [],
      frameNumbers: [],
      issues: []
    };

    // 解析 END phase 日志
    endPhaseLogs.forEach(log => {
      const elapsedMatch = log.match(/elapsed=([0-9.]+)ms/);
      const deltaMatch = log.match(/delta=(-?[0-9.]+)/);
      const easeMatch = log.match(/easeCoeff=([0-9.]+)/);
      const progressMatch = log.match(/progress=([0-9.]+)/);
      const frameMatch = log.match(/frame=(\d+)/);

      if (elapsedMatch) analysis.elapsedTimes.push(parseFloat(elapsedMatch[1]));
      if (deltaMatch) analysis.deltas.push(parseFloat(deltaMatch[1]));
      if (easeMatch) analysis.easeCoeffs.push(parseFloat(easeMatch[1]));
      if (progressMatch) analysis.progressions.push(parseFloat(progressMatch[1]));
      if (frameMatch) analysis.frameNumbers.push(parseInt(frameMatch[1]));
    });

    // 分析问题
    // 1. 检查 elapsed 时间稳定性
    if (analysis.elapsedTimes.length > 1) {
      const avgElapsed = analysis.elapsedTimes.reduce((a, b) => a + b, 0) / analysis.elapsedTimes.length;
      const maxElapsed = Math.max(...analysis.elapsedTimes);
      const minElapsed = Math.min(...analysis.elapsedTimes);
      const variance = maxElapsed - minElapsed;

      analysis.avgElapsed = avgElapsed;
      analysis.maxElapsed = maxElapsed;
      analysis.minElapsed = minElapsed;
      analysis.elapsedVariance = variance;

      if (variance > 10) {
        analysis.issues.push({
          type: 'UNSTABLE_ELAPSED',
          severity: 'HIGH',
          message: `帧时间不稳定! 变化: ${variance.toFixed(2)}ms (范围: ${minElapsed.toFixed(2)}-${maxElapsed.toFixed(2)}ms)`
        });
      }
    }

    // 2. 检查 delta 跳跃
    if (analysis.deltas.length > 1) {
      for (let i = 1; i < analysis.deltas.length; i++) {
        const prevDelta = Math.abs(analysis.deltas[i - 1]);
        const currDelta = Math.abs(analysis.deltas[i]);
        const jump = Math.abs(currDelta - prevDelta);
        const jumpRatio = prevDelta > 0 ? jump / prevDelta : 0;

        if (jumpRatio > 0.3 && jump > 0.0001) {
          analysis.issues.push({
            type: 'DELTA_JUMP',
            severity: 'MEDIUM',
            message: `帧 ${analysis.frameNumbers[i]} 的位置变化跳跃! delta 从 ${prevDelta.toFixed(6)} 变为 ${currDelta.toFixed(6)} (变化 ${jumpRatio * 100}%)`,
            frame: analysis.frameNumbers[i]
          });
        }
      }
    }

    // 3. 检查帧号连续性
    for (let i = 1; i < analysis.frameNumbers.length; i++) {
      const diff = analysis.frameNumbers[i] - analysis.frameNumbers[i - 1];
      if (diff !== 1) {
        analysis.issues.push({
          type: 'FRAME_SKIP',
          severity: 'HIGH',
          message: `帧号不连续! 从 ${analysis.frameNumbers[i - 1]} 跳到 ${analysis.frameNumbers[i]} (跳过 ${diff - 1} 帧)`,
          frame: analysis.frameNumbers[i]
        });
      }
    }

    // 4. 检查进度合理性
    if (analysis.progressions.length > 0) {
      const totalProgress = Math.abs(
        analysis.progressions[analysis.progressions.length - 1] - 
        analysis.progressions[0]
      );
      analysis.totalProgress = totalProgress;
    }

    return analysis;
  }

  // 生成报告
  function generateReport() {
    const logs = window.__walkerDebugLogs;
    if (!logs || Object.keys(logs).length === 0) {
      console.warn('%c⚠️ 暂无调试数据,请等待角色行走并进入 END 阶段', 'color: #ffaa00;');
      return;
    }

    console.log('\n%c=== 分析报告 ===', 'color: #00ff00; font-size: 14px; font-weight: bold;');
    console.log(`分析时间: ${new Date().toLocaleString()}\n`);

    Object.entries(logs).forEach(([charName, charLogs]) => {
      console.log(`%c角色: ${charName}`, 'color: #00ffff; font-size: 12px; font-weight: bold;');
      
      const analysis = analyzeEndPhase(charName, charLogs);
      if (!analysis) {
        console.log('  暂无 END 阶段数据\n');
        return;
      }

      console.log(`  总帧数: ${analysis.totalFrames}`);
      if (analysis.avgElapsed) {
        console.log(`  平均帧时间: ${analysis.avgElapsed.toFixed(2)}ms`);
        console.log(`  帧时间范围: ${analysis.minElapsed.toFixed(2)}-${analysis.maxElapsed.toFixed(2)}ms`);
        console.log(`  帧时间波动: ${analysis.elapsedVariance.toFixed(2)}ms`);
      }
      if (analysis.totalProgress !== undefined) {
        console.log(`  总进度变化: ${analysis.totalProgress.toFixed(6)}`);
      }

      if (analysis.issues.length > 0) {
        console.log(`\n  %c⚠️ 发现 ${analysis.issues.length} 个问题:`, 'color: #ff4444; font-weight: bold;');
        analysis.issues.forEach((issue, idx) => {
          const severityColor = issue.severity === 'HIGH' ? '#ff0000' : '#ffaa00';
          console.log(`  %c[${issue.severity}] ${issue.message}`, `color: ${severityColor};`);
        });
      } else {
        console.log(`\n  %c✓ 未发现问题`, 'color: #00ff00;');
      }

      console.log('');
    });

    // 输出原始数据摘要
    console.log('%c=== 原始数据导出 ===', 'color: #888888;');
    console.log('完整日志已存储在 window.__walkerDebugLogs');
    console.log('使用以下命令可导出为文件:');
    console.log('%c  Ctrl + Shift + D', 'color: #00ff00; font-weight: bold;');
  }

  // 实时监控
  let lastLogCount = {};
  function startMonitoring() {
    setInterval(() => {
      const logs = window.__walkerDebugLogs;
      if (!logs) return;

      Object.entries(logs).forEach(([charName, charLogs]) => {
        if (!lastLogCount[charName]) lastLogCount[charName] = 0;
        
        const newLogs = charLogs.slice(lastLogCount[charName]);
        if (newLogs.length > 0) {
          lastLogCount[charName] = charLogs.length;
          
          // 实时检测 END 阶段问题
          newLogs.forEach(log => {
            if (log.includes('END phase:') && log.includes('delta=')) {
              const deltaMatch = log.match(/delta=(-?[0-9.]+)/);
              const elapsedMatch = log.match(/elapsed=([0-9.]+)ms/);
              
              if (deltaMatch && elapsedMatch) {
                const delta = parseFloat(deltaMatch[1]);
                const elapsed = parseFloat(elapsedMatch[1]);
                
                // 实时警告
                if (elapsed > 100) {
                  console.warn(`%c⚠️ 帧时间过长: ${elapsed.toFixed(2)}ms`, 'color: #ff0000; font-weight: bold; background: #ffff00;');
                }
                if (Math.abs(delta) > 0.001) {
                  console.warn(`%c⚠️ 位置变化过大: ${delta.toFixed(6)}`, 'color: #ff0000; font-weight: bold; background: #ffff00;');
                }
              }
            }
          });
        }
      });
    }, 500);
  }

  // 启动监控
  startMonitoring();

  // 暴露分析函数
  window.analyzeWalkerLogs = generateReport;
  
  console.log('\n%c✅ 调试分析器已启动!', 'color: #00ff00; font-weight: bold;');
  console.log('%c使用说明:', 'color: #00ffff; font-weight: bold;');
  console.log('1. 等待角色行走并进入 END 阶段');
  console.log('2. 实时警告会在控制台显示');
  console.log('3. 运行 %canalyzeWalkerLogs()%c 生成完整报告', 'color: #00ff00;', 'color: inherit;');
  console.log('4. 按 %cCtrl + Shift + D%c 导出日志文件\n', 'color: #00ff00;', 'color: inherit;');

})();
