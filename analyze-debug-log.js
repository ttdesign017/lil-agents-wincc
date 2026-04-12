/**
 * 自动分析 WalkerCharacter 调试日志的脚本
 * 
 * 使用方法:
 * node analyze-debug-log.js
 * 
 * 此脚本会:
 * 1. 读取 walker-debug.log 文件
 * 2. 解析 END 阶段数据
 * 3. 分析帧时间、位置变化等问题
 * 4. 生成详细分析报告
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// 日志文件路径
const logFilePath = join(
  process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
  'lil-agents-win',
  'walker-debug.log'
);

console.log('=== Walker Character 跳帧问题自动分析工具 ===\n');
console.log(`日志文件路径: ${logFilePath}\n`);

// 检查文件是否存在
if (!existsSync(logFilePath)) {
  console.error('❌ 错误: 日志文件不存在');
  console.error('请确保:');
  console.error('1. 应用已经启动并运行过');
  console.error('2. 角色已经行走并进入 END 阶段');
  console.error('3. 应用已正常退出(触发日志导出)');
  process.exit(1);
}

// 读取日志文件
let logContent;
try {
  logContent = readFileSync(logFilePath, 'utf-8');
} catch (err) {
  console.error('❌ 错误: 无法读取日志文件:', err.message);
  process.exit(1);
}

console.log(`✅ 日志文件大小: ${(logContent.length / 1024).toFixed(2)} KB\n`);

// 解析日志行
const lines = logContent.split('\n').filter(line => line.trim());

console.log(`📊 日志总行数: ${lines.length}\n`);

// 按角色分组分析
const characterData = {};
let currentChar = null;

lines.forEach(line => {
  // 提取角色名称
  const charMatch = line.match(/\[([^\]]+)\]/);
  if (charMatch && line.includes('END phase:')) {
    // 解析 END phase 数据
    const frameMatch = line.match(/frame=(\d+)\/(\d+)/);
    const elapsedMatch = line.match(/elapsed=([0-9.]+)ms/);
    const easeMatch = line.match(/easeCoeff=([0-9.]+)/);
    const deltaMatch = line.match(/delta=(-?[0-9.]+)/);
    const progressMatch = line.match(/progress=([0-9.]+)/);
    
    if (frameMatch && elapsedMatch) {
      const data = {
        frame: parseInt(frameMatch[1]),
        maxFrame: parseInt(frameMatch[2]),
        elapsed: parseFloat(elapsedMatch[1]),
        easeCoeff: easeMatch ? parseFloat(easeMatch[1]) : null,
        delta: deltaMatch ? parseFloat(deltaMatch[1]) : null,
        progress: progressMatch ? parseFloat(progressMatch[1]) : null,
        rawLine: line
      };
      
      if (!characterData[currentChar]) {
        characterData[currentChar] = {
          endPhaseFrames: [],
          transitions: [],
          issues: []
        };
      }
      
      characterData[currentChar].endPhaseFrames.push(data);
    }
  }
  
  // 捕获阶段转换
  if (line.includes('Transition to END phase') || 
      line.includes('Transition from LOOP to END')) {
    const match = line.match(/\[([^\]]+)\]/);
    if (match) {
      currentChar = match[1];
      if (!characterData[currentChar]) {
        characterData[currentChar] = {
          endPhaseFrames: [],
          transitions: [],
          issues: []
        };
      }
      characterData[currentChar].transitions.push(line);
    }
  }
  
  // 捕获 END phase complete
  if (line.includes('END phase complete')) {
    const match = line.match(/\[([^\]]+)\]/);
    if (match && characterData[match[1]]) {
      characterData[match[1]].transitions.push(line);
    }
  }
});

// 分析每个角色的数据
console.log('=== 分析报告 ===\n');

Object.entries(characterData).forEach(([charName, data]) => {
  console.log(`\n🎭 角色: ${charName}`);
  console.log('─'.repeat(60));
  
  const { endPhaseFrames, transitions, issues } = data;
  
  if (endPhaseFrames.length === 0) {
    console.log('  ⚠️  暂无 END 阶段数据');
    return;
  }
  
  console.log(`  📈 END 阶段帧数: ${endPhaseFrames.length}`);
  console.log(`  🔄 阶段转换次数: ${transitions.length}`);
  
  // 分析帧时间
  const elapsedTimes = endPhaseFrames.map(f => f.elapsed).filter(e => e !== null);
  if (elapsedTimes.length > 0) {
    const avg = elapsedTimes.reduce((a, b) => a + b, 0) / elapsedTimes.length;
    const min = Math.min(...elapsedTimes);
    const max = Math.max(...elapsedTimes);
    const variance = max - min;
    
    console.log(`\n  ⏱️  帧时间分析:`);
    console.log(`    平均: ${avg.toFixed(2)}ms`);
    console.log(`    范围: ${min.toFixed(2)}ms - ${max.toFixed(2)}ms`);
    console.log(`    波动: ${variance.toFixed(2)}ms`);
    
    if (variance > 10) {
      issues.push({
        type: 'HIGH',
        message: `帧时间不稳定! 波动 ${variance.toFixed(2)}ms 过大`
      });
    }
  }
  
  // 分析位置变化
  const deltas = endPhaseFrames.map(f => f.delta).filter(d => d !== null);
  if (deltas.length > 1) {
    console.log(`\n  📍 位置变化分析:`);
    
    let hasJump = false;
    for (let i = 1; i < deltas.length; i++) {
      const prevDelta = Math.abs(deltas[i - 1]);
      const currDelta = Math.abs(deltas[i]);
      const jump = Math.abs(currDelta - prevDelta);
      const jumpRatio = prevDelta > 0 ? jump / prevDelta : 0;
      
      if (jumpRatio > 0.3 && jump > 0.0001) {
        hasJump = true;
        const frame = endPhaseFrames[i].frame;
        console.log(`    ⚠️  帧 ${frame}: delta 从 ${prevDelta.toFixed(6)} 变为 ${currDelta.toFixed(6)} (变化 ${jumpRatio * 100}%)`);
        
        issues.push({
          type: 'MEDIUM',
          message: `帧 ${frame} 位置变化跳跃 (${jumpRatio * 100}%)`
        });
      }
    }
    
    if (!hasJump) {
      console.log(`    ✅ 位置变化平滑,无异常跳跃`);
    }
  }
  
  // 分析帧号连续性
  const frames = endPhaseFrames.map(f => f.frame);
  if (frames.length > 1) {
    console.log(`\n  🎬 帧号连续性:`);
    
    let hasSkip = false;
    for (let i = 1; i < frames.length; i++) {
      const diff = frames[i] - frames[i - 1];
      if (diff !== 1) {
        hasSkip = true;
        console.log(`    ❌ 帧号跳跃: 从 ${frames[i - 1]} 到 ${frames[i]} (跳过 ${diff - 1} 帧)`);
        
        issues.push({
          type: 'HIGH',
          message: `帧号不连续,跳过 ${diff - 1} 帧`
        });
      }
    }
    
    if (!hasSkip) {
      console.log(`    ✅ 帧号连续,无跳帧`);
    }
  }
  
  // 分析进度
  const progresses = endPhaseFrames.map(f => f.progress).filter(p => p !== null);
  if (progresses.length > 0) {
    const totalProgress = Math.abs(progresses[progresses.length - 1] - progresses[0]);
    console.log(`\n  📊 进度变化:`);
    console.log(`    起始: ${progresses[0].toFixed(6)}`);
    console.log(`    结束: ${progresses[progresses.length - 1].toFixed(6)}`);
    console.log(`    总变化: ${totalProgress.toFixed(6)}`);
  }
  
  // 问题汇总
  if (issues.length > 0) {
    console.log(`\n  🚨 发现问题 (${issues.length} 个):`);
    issues.forEach((issue, idx) => {
      const icon = issue.type === 'HIGH' ? '🔴' : '🟡';
      console.log(`    ${idx + 1}. ${icon} [${issue.type}] ${issue.message}`);
    });
  } else {
    console.log(`\n  ✅ 未发现明显问题`);
  }
  
  console.log('');
});

// 输出建议
console.log('\n=== 分析建议 ===\n');

if (Object.keys(characterData).length === 0) {
  console.log('⚠️  未找到 END 阶段数据,请确保:');
  console.log('  1. 角色已经行走');
  console.log('  2. 角色已经停止行走(进入 END 阶段)');
  console.log('  3. 应用已正常退出(触发日志导出)');
} else {
  console.log('📋 下一步:');
  console.log('  1. 检查上面的分析报告,特别关注标记为 🔴 的高严重性问题');
  console.log('  2. 将完整的日志文件提供给开发者进行深入分析');
  console.log('  3. 日志文件位置: ' + logFilePath);
}

console.log('');
