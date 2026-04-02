#!/usr/bin/env python3
"""
Agent Portal Digest v4 — Project-oriented pipeline.

Core flow: collect messages → extract events → match to projects → update status.

Usage:
  python digest.py                    # today
  python digest.py --date 2026-03-29  # specific date
  python digest.py --dry-run          # analyse only, no push
  python digest.py --l1-only          # L0 + L1 only
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

# Ensure project root is on sys.path so `config` and subpackages resolve.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import DATA_DIR
from pipeline.collector import collect_daily_data, save_raw_backup
from pipeline.extractor import extract_all
from pipeline.aggregator import aggregate_all
from pipeline.project_tracker import (
    load_cache, run_incremental_matching, save_cache, update_dormant_status,
)
from pipeline.project_insights import (
    generate_project_insights, push_project_insights,
    match_events_to_projects,
)
from push.notifier import notify_daddy
from push.pusher import push_activities, push_timeline, sync_bots
from push.supabase import supabase_request

TZ_SHANGHAI = timezone(timedelta(hours=8))


def main():
    parser = argparse.ArgumentParser(description="Agent Portal Digest v4")
    parser.add_argument("--date", type=str, default=None,
                        help="Date (YYYY-MM-DD), defaults to today")
    parser.add_argument("--dry-run", action="store_true",
                        help="Analyse only, do not push to Supabase")
    parser.add_argument("--full", action="store_true",
                        help="Full re-collect (ignore cursor cache)")
    parser.add_argument("--l1-only", action="store_true",
                        help="Stop after L0 + L1 extraction")
    parser.add_argument("--skip-l3", action="store_true",
                        help="(v3 compat, no-op in v4)")
    args = parser.parse_args()

    date_str = args.date or datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d")
    print(f"{'=' * 60}")
    print(f"📡 Agent Portal Digest v4 — {date_str}")
    print(f"{'=' * 60}")

    # === L0: Data collection ===
    # Sync bot registry first (ensure new bots auto-register in AP_bots)
    try:
        sync_bots()
    except Exception as e:
        print(f"  ⚠️ bot 同步失败（不阻塞主流程）: {e}")

    collected = collect_daily_data(date_str, full=args.full)

    if not collected:
        print(f"\n📭 {date_str} 没有任何 bot 有活跃对话，退出。")
        return

    save_raw_backup(date_str, collected)

    # === L1: Structured extraction ===
    l1_results = extract_all(collected)

    raw_dir = os.path.join(DATA_DIR, "raw", date_str)
    os.makedirs(raw_dir, exist_ok=True)
    l1_path = os.path.join(raw_dir, "_l1_results.json")
    with open(l1_path, "w", encoding="utf-8") as f:
        json.dump(l1_results, f, ensure_ascii=False, indent=2)
    print(f"💾 L1 结果保存到 {l1_path}")

    if args.l1_only:
        print(f"\n🏁 L1 完成，--l1-only 模式，停止。")
        return

    # === L1.5: Task aggregation ===
    aggregated_tasks = aggregate_all(l1_results)

    agg_path = os.path.join(raw_dir, "_aggregated_tasks.json")
    with open(agg_path, "w", encoding="utf-8") as f:
        json.dump(aggregated_tasks, f, ensure_ascii=False, indent=2)
    print(f"💾 聚合结果保存到 {agg_path}")

    # === L2: Project matching + discovery ===
    print(f"\n🔄 项目匹配...")
    project_cache = load_cache()
    project_cache = run_incremental_matching(project_cache, l1_results, date_str)
    project_cache = update_dormant_status(project_cache, date_str)
    save_cache(project_cache)

    # Load projects from DB (PG direct preferred, Supabase fallback)
    sb_names = None
    try:
        from push.db import db_select
        sb_projects = db_select(
            "AP_projects",
            columns="id, name, slug, status, metadata, emoji, tags, agent_id, updated_at",
        )
        if sb_projects:
            sb_projects = [p for p in sb_projects if p.get("status") != "dismissed"]
            sb_names = {p["name"] for p in sb_projects}
            active_projects = sb_projects
            print(f"   📋 从 PG 加载 {len(active_projects)} 个项目（权威来源）")
        else:
            raise ValueError("PG 返回空")
    except Exception as e:
        print(f"   ⚠️ Supabase 加载失败，回退到本地缓存: {e}")
        active_projects = [
            p for p in project_cache.get("projects", [])
            if p.get("status") not in ("merged", "dismissed")
        ]
        print(f"   📋 当前 {len(active_projects)} 个项目（本地缓存）")

    # === L3: Project status updates (core step) ===
    matched_projects = match_events_to_projects(
        l1_results, aggregated_tasks or {}, active_projects,
    )

    project_updates = generate_project_insights(
        l1_results, matched_projects, active_projects, date_str,
    )

    # Filter: only keep updates for Supabase-known projects
    if sb_names:
        before = len(project_updates)
        project_updates = [
            u for u in project_updates if u.get("project_name") in sb_names
        ]
        if len(project_updates) < before:
            print(f"   🔍 过滤掉 {before - len(project_updates)} 个非活跃项目的更新")

    if args.dry_run:
        print(f"\n🏁 --dry-run 模式，不推送。")
        print(f"\n--- 项目状态预览 ---")
        for u in project_updates:
            health = u.get("health", "?")
            icon = {"healthy": "🟢", "attention": "🟡",
                    "blocked": "🔴", "stale": "⚪"}.get(health, "❓")
            print(f"  {icon} [{health}] {u.get('project_name', '?')}")
            print(f"     状态: {u.get('current_summary', '')}")
            print(f"     下一步: {u.get('next_action', '')}")
        return

    # === Push project status to Supabase ===
    should_notify = True
    if project_updates:
        should_notify = push_project_insights(
            project_updates, matched_projects, active_projects,
            l1_results, date_str,
        )

    # === Push activity data (for bot detail pages) ===
    try:
        push_activities(l1_results, date_str, aggregated_tasks=aggregated_tasks)
    except Exception as e:
        print(f"  ⚠️ 活动推送失败: {e}")
    try:
        push_timeline(l1_results, date_str)
    except Exception as e:
        print(f"  ⚠️ 时间线推送失败: {e}")

    # === Notify Daddy (subject to cooldown lock) ===
    if should_notify:
        notify_daddy(date_str, project_updates, active_projects)
    else:
        print(f"  🔒 通知已冷却，跳过")

    print(f"\n{'=' * 60}")
    print(f"🎉 Daily Digest v4 完成!")
    print(f"   📊 {len(l1_results)} 个 bot 的消息已处理")
    print(f"   📋 {len(project_updates)} 个项目状态已更新")
    print(f"   💾 原始记录已备份")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
