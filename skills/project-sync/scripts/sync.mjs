#!/usr/bin/env node
/**
 * project-sync v2 — Local workspace maintenance only
 * 
 * Each bot runs this for ITS OWN workspace:
 * 1. Summarize recent session activity (from memory/ files)
 * 2. Update CONTEXT.md with current project status
 * 3. Clean up stale memory files (>7 days → archive/)
 * 4. Report workspace health
 * 
 * Does NOT push to Portal API (dashboard-collector handles that centrally).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';

const WORKSPACE = process.env.WORKSPACE || process.cwd();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ARCHIVE_DAYS = 7;

// --- Helpers ---

function readSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// --- 1. Session summary ---

function summarizeSessions() {
  const memDir = join(WORKSPACE, 'memory');
  if (!existsSync(memDir)) return { recent: 0, total: 0, lastDate: null };
  
  const files = readdirSync(memDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  if (!files.length) return { recent: 0, total: 0, lastDate: null };

  const todayStr = today();
  const recent = files.filter(f => daysAgo(f.replace('.md', '')) <= 1);
  const lastFile = files[files.length - 1];
  const lastContent = readSafe(join(memDir, lastFile));
  const lineCount = lastContent ? lastContent.split('\n').filter(l => l.trim()).length : 0;

  return {
    recent: recent.length,
    total: files.length,
    lastDate: lastFile.replace('.md', ''),
    lastEntries: lineCount,
  };
}

// --- 2. CONTEXT.md freshness check ---

function checkContext() {
  const contextPath = join(WORKSPACE, 'CONTEXT.md');
  const content = readSafe(contextPath);
  if (!content) return { exists: false, stale: true, lines: 0 };
  
  const stat = statSync(contextPath);
  const modDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
  const lines = content.split('\n').length;

  return {
    exists: true,
    stale: modDays > 3,
    modifiedDaysAgo: modDays,
    lines,
  };
}

// --- 3. Archive old memory files ---

function archiveOldMemory() {
  const memDir = join(WORKSPACE, 'memory');
  if (!existsSync(memDir)) return 0;

  const archiveDir = join(memDir, 'archive');
  const files = readdirSync(memDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  let archived = 0;

  for (const f of files) {
    const dateStr = f.replace('.md', '');
    if (daysAgo(dateStr) > ARCHIVE_DAYS) {
      if (!DRY_RUN) {
        mkdirSync(archiveDir, { recursive: true });
        renameSync(join(memDir, f), join(archiveDir, f));
      }
      archived++;
    }
  }
  return archived;
}

// --- 4. Tasks check ---

function checkTasks() {
  const tasksPath = join(WORKSPACE, 'tasks.json');
  try {
    const raw = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status !== 'done').length,
      done: tasks.filter(t => t.status === 'done').length,
    };
  } catch {
    return { total: 0, pending: 0, done: 0 };
  }
}

// --- Main ---

function main() {
  const wsName = basename(WORKSPACE);
  console.log(`[sync] ${wsName} | ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('[sync] DRY RUN');

  const sessions = summarizeSessions();
  const context = checkContext();
  const archived = archiveOldMemory();
  const tasks = checkTasks();

  const report = {
    workspace: wsName,
    sessions,
    context,
    tasks,
    archived,
  };

  console.log(JSON.stringify(report, null, 2));

  // Summary line
  const parts = [];
  if (sessions.recent > 0) parts.push(`📝 ${sessions.lastEntries} entries today`);
  if (context.stale) parts.push(`⚠️ CONTEXT.md stale (${context.modifiedDaysAgo}d)`);
  if (tasks.pending > 0) parts.push(`📋 ${tasks.pending} pending tasks`);
  if (archived > 0) parts.push(`🗄️ ${archived} memory files archived`);
  if (!parts.length) parts.push('✅ workspace healthy');

  console.log(`\n[STATUS] ${wsName}: ${parts.join(' | ')}`);
}

main();
