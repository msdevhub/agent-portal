import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, ChevronDown, ChevronUp, FolderOpen, Loader2, MessageSquare, Send, Server, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import type { OpsPost } from "@/lib/api"
import { getOpsChannel, getOpsMessages, sendOpsMessage, fetchPortalSettings } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface ProjectContext {
  id: string
  name: string
  emoji?: string | null
  description?: string | null
  summary?: string | null
  timeline?: { date: string; event: string; bot?: string }[]
  next_actions?: { text: string; done?: boolean }[]
  status?: string
}

export interface CommandTarget {
  id: string
  name: string
  emoji: string
  user_id: string
  kind?: "bot" | "server"
  prefill?: string
  projectContext?: ProjectContext
}

interface CommandBarProps {
  targets: CommandTarget[]
  onClearTarget: (id?: string) => void
}

const PORTAL_SENDER_USER_ID = "hj8iizxdtbb8bfo8wdanp3tfua" // @matter (admin token sends as this user)

type ChatState = {
  channelId: string | null
  messages: OpsPost[]
  chatOpen: boolean
  waitingSince: number | null
  historyLoaded: boolean
  historyLoading: boolean
}

const EMPTY_CHAT_STATE: ChatState = {
  channelId: null,
  messages: [],
  chatOpen: false,
  waitingSince: null,
  historyLoaded: false,
  historyLoading: false,
}

/** Parse [引用服务器: xxx] prefix from a message */
function parseRef(msg: string): { ref: string | null; body: string } {
  const m = msg.match(/^\[(引用服务器|引用Bot|引用机器人|Ref): ?([^\]]+)\]\s*/)
  if (m) return { ref: `${m[1].includes("Bot") ? "🤖" : "🖥️"} ${m[2]}`, body: msg.slice(m[0].length) }
  return { ref: null, body: msg }
}

/** Deduplicate posts by id, keep latest */
function dedupPosts(posts: OpsPost[]): OpsPost[] {
  const map = new Map<string, OpsPost>()
  for (const p of posts) map.set(p.id, p)
  return Array.from(map.values()).sort((a, b) => a.create_at - b.create_at)
}

export function CommandBar({ targets, onClearTarget }: CommandBarProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatByTarget, setChatByTarget] = useState<Record<string, ChatState>>({})
  const [sseConnected, setSseConnected] = useState(false)
  const [directChatActive, setDirectChatActive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [projectInfoOpen, setProjectInfoOpen] = useState(false)
  
  // Mobile bottom sheet state
  type SheetSnap = 'collapsed' | 'half' | 'full'
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('collapsed')
  const [isMobile, setIsMobile] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Snap point heights
  const getSnapHeight = useCallback((snap: SheetSnap) => {
    const vh = window.innerHeight
    switch (snap) {
      case 'collapsed': return vh * 0.15
      case 'half': return vh * 0.5
      case 'full': return vh * 0.85
    }
  }, [])

  const findNearestSnap = useCallback((h: number): SheetSnap | 'close' => {
    const vh = window.innerHeight
    const closeThreshold = vh * 0.08
    if (h < closeThreshold) return 'close'
    const snaps: SheetSnap[] = ['collapsed', 'half', 'full']
    let best = snaps[0]
    let bestDist = Math.abs(h - getSnapHeight(snaps[0]))
    for (const s of snaps) {
      const d = Math.abs(h - getSnapHeight(s))
      if (d < bestDist) { best = s; bestDist = d }
    }
    return best
  }, [getSnapHeight])

  // Touch handlers for drag handle
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    setIsDragging(true)
    dragStartY.current = e.touches[0].clientY
    dragStartHeight.current = getSnapHeight(sheetSnap)
  }, [isMobile, sheetSnap, getSnapHeight])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    const dy = dragStartY.current - e.touches[0].clientY
    const newH = Math.max(0, Math.min(window.innerHeight * 0.9, dragStartHeight.current + dy))
    setDragHeight(newH)
  }, [isDragging])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    if (dragHeight !== null) {
      const snap = findNearestSnap(dragHeight)
      if (snap === 'close') {
        setDragHeight(null)
        onClearTarget()
        setDirectChatActive(false)
        setExpanded(false)
        return
      }
      setSheetSnap(snap)
      setExpanded(snap !== 'collapsed')
    }
    setDragHeight(null)
  }, [isDragging, dragHeight, findNearestSnap, onClearTarget])

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 20
    const maxH = lineHeight * 5 + 12 // 5 lines + padding
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px'
  }, [])

  // Fetch default bot from portal settings
  const [defaultBotSetting, setDefaultBotSetting] = useState<{ agent_id: string; name: string; emoji: string; mm_user_id: string } | null>(null)
  useEffect(() => {
    fetchPortalSettings()
      .then(s => { if (s?.default_bot) setDefaultBotSetting(s.default_bot) })
      .catch(() => {})
  }, [])

  const fallbackBot = defaultBotSetting
    ? { id: `${defaultBotSetting.agent_id}-direct`, name: defaultBotSetting.name, emoji: defaultBotSetting.emoji, user_id: defaultBotSetting.mm_user_id, kind: "bot" as const }
    : { id: "nexora-direct", name: "Nexora", emoji: "🦞", user_id: "x67znhpzf3bs7pfktmed8qihny", kind: "bot" as const }

  // Determine effective targets: if targets selected, use them. Else if direct chat, use default bot.
  const isMultiTarget = targets.length > 1
  const primaryTarget = targets[0] ?? (directChatActive ? fallbackBot : null)
  const projectCtx = targets.find(t => t.projectContext)?.projectContext ?? null
  
  // Active chat key is primary target ID (or Ottor)
  const activeTargetKey = primaryTarget ? `${primaryTarget.kind ?? "bot"}:${primaryTarget.id}` : null
  
  const activeChat = useMemo(() => {
    if (!activeTargetKey) return EMPTY_CHAT_STATE
    return chatByTarget[activeTargetKey] ?? EMPTY_CHAT_STATE
  }, [activeTargetKey, chatByTarget])
  
  const { messages, waitingSince, historyLoaded, historyLoading } = activeChat
  
  // Auto-expand if messages exist or targets selected
  useEffect(() => {
    if (targets.length > 0 || directChatActive) {
      setExpanded(true)
      if (isMobile) setSheetSnap('half')
    }
  }, [targets.length, directChatActive, isMobile])

  // Prefill input when a target with prefill text is added
  useEffect(() => {
    const prefillTarget = targets.find(t => t.prefill)
    if (prefillTarget?.prefill) {
      setInput(prefillTarget.prefill)
      // Clear the prefill flag so it doesn't re-trigger
      prefillTarget.prefill = undefined
      // Focus the input
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [targets])

  // ── SSE connection ──
  useEffect(() => {
    const es = new EventSource("/api/ops/stream")
    eventSourceRef.current = es
    es.onopen = () => setSseConnected(true)

    es.addEventListener("new_message", (e) => {
      try {
        const post: OpsPost = JSON.parse(e.data)
        if (!post.channel_id) return
        setChatByTarget((prev) => {
          const updated = { ...prev }
          for (const [key, state] of Object.entries(updated)) {
            if (state.channelId === post.channel_id) {
              const existingIds = new Set(state.messages.map((p) => p.id))
              if (!existingIds.has(post.id)) {
                updated[key] = {
                  ...state,
                  messages: [...state.messages, post],
                  waitingSince: null,
                }
              }
              break
            }
          }
          return updated
        })
      } catch { /* ignore */ }
    })

    es.onerror = () => setSseConnected(false)
    return () => { es.close(); eventSourceRef.current = null }
  }, [])

  // ── Auto-load history ──
  useEffect(() => {
    if (!primaryTarget || !activeTargetKey) return
    const state = chatByTarget[activeTargetKey]
    if (state?.historyLoaded || state?.historyLoading) return

    setChatByTarget((prev) => ({
      ...prev,
      [activeTargetKey]: { ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE), historyLoading: true },
    }))

    const key = activeTargetKey
    const userId = primaryTarget.user_id

    void (async () => {
      try {
        const ch = await getOpsChannel(userId)
        const channelId = ch.channel_id
        if (!channelId) throw new Error("no channel")

        const result = await getOpsMessages(channelId)
        const posts = result?.posts ?? []

        setChatByTarget((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? EMPTY_CHAT_STATE),
            channelId,
            messages: dedupPosts([...posts, ...(prev[key]?.messages ?? [])]),
            historyLoaded: true,
            historyLoading: false,
          },
        }))
      } catch {
        setChatByTarget((prev) => ({
          ...prev,
          [key]: { ...(prev[key] ?? EMPTY_CHAT_STATE), historyLoaded: true, historyLoading: false },
        }))
      }
    })()
  }, [primaryTarget, activeTargetKey, chatByTarget])

  // Auto-scroll
  useEffect(() => {
    if (expanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [messages, expanded, activeTargetKey])

  // Focus input
  useEffect(() => {
    if (primaryTarget && expanded) inputRef.current?.focus()
  }, [primaryTarget, expanded])

  const handleSend = useCallback(async () => {
    if (!primaryTarget || !input.trim() || sending) return
    const msg = input.trim()
    setSending(true)
    setError(null)

    try {
      // If multi-target, we send to the primary one but mention others in text?
      // Or send individually? The requirement said "引用多个发给一个目标".
      // So we construct a message with references.
      
      let finalMsg = msg
      if (targets.length > 0) {
        // Prepend references for ALL targets if they are servers/bots
        const refs = targets.map(t => {
          const parts = [`[引用${t.kind === "server" ? "服务器" : "Bot"}: ${t.name}]`]
          if (t.projectContext) parts.push(`[引用项目: ${t.projectContext.name}]`)
          return parts.join(" ")
        }).join(" ")
        finalMsg = `${refs} ${msg}`
      }

      // Send to primary target only (as requested)
      const result = await sendOpsMessage(primaryTarget.user_id, finalMsg)
      
      if (!result?.ok) throw new Error("发送失败")

      const chId = result.channel_id ?? activeChat.channelId
      const sentPost: OpsPost = {
        id: result.post_id ?? `local-${Date.now()}`,
        channel_id: chId ?? "",
        user_id: PORTAL_SENDER_USER_ID,
        message: finalMsg,
        create_at: Date.now(),
        update_at: Date.now(),
      }

      if (activeTargetKey) {
        setChatByTarget((prev) => ({
          ...prev,
          [activeTargetKey]: {
            ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE),
            channelId: chId,
            messages: dedupPosts([...(prev[activeTargetKey]?.messages ?? []), sentPost]),
            waitingSince: Date.now(),
          },
        }))
      }
      setInput("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败")
    } finally {
      setSending(false)
    }
  }, [targets, primaryTarget, activeTargetKey, input, sending, activeChat.channelId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
      // Reset textarea height after send
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.style.height = 'auto'
        }
      }, 0)
    }
  }

  // If no target selected and not in direct chat, show nothing (or minimal bar)
  if (!primaryTarget && !directChatActive) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none p-4 flex justify-center">
        <button
          onClick={() => { setDirectChatActive(true); setExpanded(true); if (isMobile) setSheetSnap('half'); setTimeout(() => inputRef.current?.focus(), 150); }}
          className="pointer-events-auto shadow-xl shadow-black/40 flex items-center gap-2 rounded-full border border-zinc-700 bg-[#18181b] px-4 py-2.5 text-sm font-medium text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 hover:scale-105 transition-all"
        >
          <MessageSquare className="h-4 w-4" />
          <span>开始对话</span>
        </button>
      </div>
    )
  }

  // Mobile sheet height
  const mobileSheetHeight = isMobile
    ? (isDragging && dragHeight !== null ? dragHeight : getSnapHeight(sheetSnap))
    : undefined

  const showMessages = isMobile ? (sheetSnap !== 'collapsed' || isDragging) : expanded

  return (
    <div className={cn(
      "fixed inset-x-0 bottom-0 z-50 transition-all duration-300",
      !isMobile && (expanded ? "h-[85vh] sm:h-[600px]" : "h-auto")
    )}>
      {/* Backdrop for mobile */}
      {isMobile && (sheetSnap === 'half' || sheetSnap === 'full') && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => { setSheetSnap('collapsed'); setExpanded(false) }}
        />
      )}
      {!isMobile && expanded && (
        <div 
          className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:hidden"
          onClick={() => setExpanded(false)}
        />
      )}

      <div className="flex h-full flex-col justify-end">
        <div
          className={cn(
            "mx-auto w-full max-w-3xl overflow-hidden border border-b-0 border-zinc-700/60 bg-[#111113]/95 shadow-2xl backdrop-blur-xl sm:mx-auto sm:mb-0",
            isMobile && !isDragging && "transition-[max-height] duration-300 ease-out"
          )}
          style={isMobile ? { maxHeight: mobileSheetHeight, display: 'flex', flexDirection: 'column' } : undefined}
        >
          {/* Mobile drag handle */}
          {isMobile && (
            <div
              className="flex justify-center py-2 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div className="h-1 w-10 rounded-full bg-zinc-500" />
            </div>
          )}
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3 bg-[#18181b]/50">
            <div className="flex items-center gap-2 overflow-hidden min-w-0">
              <div className="flex -space-x-1.5 overflow-hidden p-0.5 shrink-0">
                {targets.length > 0 ? (
                  targets.map((t) => (
                    <div key={t.id} className="relative flex h-6 w-6 items-center justify-center rounded-full border border-[#18181b] bg-zinc-800 text-[10px] ring-2 ring-[#111113]" title={t.name}>
                      {t.emoji}
                    </div>
                  ))
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs">🔬</div>
                )}
              </div>
              
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {targets.length > 0 
                      ? `${targets.map(t => t.name).join(", ")}` 
                      : `${fallbackBot?.emoji ?? "🤖"} ${fallbackBot?.name ?? "Bot"}`}
                  </span>
                  {projectCtx && (
                    <button
                      onClick={() => setProjectInfoOpen(v => !v)}
                      className="inline-flex items-center gap-1 shrink-0 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 transition"
                      title="查看项目详情"
                    >
                      <FolderOpen className="h-2.5 w-2.5" />
                      {projectCtx.emoji ?? "📂"} {projectCtx.name}
                    </button>
                  )}
                </div>
                {waitingSince && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Waiting...
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button 
                onClick={() => setExpanded(!expanded)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
              <button 
                onClick={() => { onClearTarget(); setDirectChatActive(false); setExpanded(false); setProjectInfoOpen(false); }}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Project Context Panel (collapsible) */}
          {expanded && projectCtx && projectInfoOpen && (
            <div className="border-b border-zinc-800/60 bg-violet-500/5 px-4 py-3 space-y-2 max-h-[200px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-violet-300">{projectCtx.emoji ?? "📂"} {projectCtx.name}</span>
                <span className="text-[10px] text-zinc-500">{projectCtx.status}</span>
              </div>
              {(projectCtx.summary || projectCtx.description) && (
                <p className="text-xs text-zinc-400 leading-relaxed">{projectCtx.summary || projectCtx.description}</p>
              )}
              {projectCtx.timeline && projectCtx.timeline.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">时间线</span>
                  {projectCtx.timeline.slice(-5).map((ev, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <span className="text-zinc-600 shrink-0 tabular-nums">{ev.date?.slice(5) ?? "—"}</span>
                      <span className="text-zinc-400">{ev.event}</span>
                      {ev.bot && <span className="text-sky-400/60 shrink-0">@{ev.bot}</span>}
                    </div>
                  ))}
                </div>
              )}
              {projectCtx.next_actions && projectCtx.next_actions.filter(a => !a.done).length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">待办</span>
                  {projectCtx.next_actions.filter(a => !a.done).map((a, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
                      <span className="text-sky-400">→</span>
                      <span>{a.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages Area */}
          {(isMobile ? showMessages : expanded) && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-0.5 min-h-[300px] max-h-[calc(85vh-130px)] sm:max-h-[460px]">
              {historyLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                </div>
              )}
              
              {!historyLoading && messages.length === 0 && (
                <div className="py-10 text-center text-sm text-zinc-600">
                  <p>暂无消息记录</p>
                  <p className="text-xs mt-1">发送消息给 {targets.length > 1 ? "选中的目标" : primaryTarget?.name}</p>
                </div>
              )}

              {messages.map((post) => {
                const isSelf = post.is_self ?? (post.user_id === PORTAL_SENDER_USER_ID)
                const { ref, body } = parseRef(post.message ?? "")
                const botTarget = targets.find(t => t.user_id === post.user_id)
                const botName = botTarget?.name ?? primaryTarget?.name ?? "Bot"
                const botInitial = botTarget?.emoji ?? botName[0]?.toUpperCase() ?? "B"
                
                return (
                  <div key={post.id} className="group flex items-start gap-2.5 w-full px-2 py-1 hover:bg-zinc-800/20 rounded transition-colors">
                    {/* Avatar */}
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mt-0.5",
                      isSelf 
                        ? "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white" 
                        : "bg-gradient-to-br from-indigo-500 to-purple-600 text-white"
                    )}>
                      {isSelf ? "D" : botInitial}
                    </div>
                    {/* Content */}
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex items-baseline gap-2">
                        <span className={cn(
                          "text-xs font-semibold",
                          isSelf ? "text-emerald-400" : "text-indigo-400"
                        )}>
                          {isSelf ? "Daddy" : botName}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {new Date(post.create_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                        {ref && (
                          <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                            {ref}
                          </span>
                        )}
                      </div>
                      <div className="chat-markdown prose prose-invert max-w-none break-words text-zinc-300 text-[13px] leading-[1.5]
                        prose-p:my-0.5 prose-p:leading-[1.5]
                        prose-headings:my-1.5 prose-headings:font-semibold prose-headings:text-sm
                        prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0
                        prose-code:rounded prose-code:bg-black/40 prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                        prose-pre:my-1.5 prose-pre:rounded-md prose-pre:bg-black/40 prose-pre:p-2.5 prose-pre:overflow-x-auto
                        prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline
                        prose-blockquote:border-l-2 prose-blockquote:border-zinc-600 prose-blockquote:pl-3 prose-blockquote:text-zinc-400 prose-blockquote:my-1
                        prose-hr:border-zinc-700 prose-hr:my-2
                        prose-strong:text-zinc-100 prose-em:text-zinc-300
                        [&_table]:my-1.5 [&_table]:w-full [&_table]:text-[12px] [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:block
                        [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:text-zinc-300 [&_th]:bg-zinc-800/80 [&_th]:border [&_th]:border-zinc-700/60
                        [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-[12px] [&_td]:text-zinc-400 [&_td]:border [&_td]:border-zinc-700/40
                        [&_tr:hover_td]:bg-zinc-800/30
                      ">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input Area */}
          <div className="border-t border-zinc-800/60 bg-[#111113] p-3 sm:p-4">
            {/* Selected Tags Chips (Removable) + Project Pill */}
            {(targets.length > 0 || projectCtx) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {targets.map(t => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-300">
                    <span>{t.emoji}</span>
                    <span>{t.name}</span>
                    <button onClick={() => onClearTarget(t.id)} className="hover:text-white"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                {projectCtx && (
                  <button
                    onClick={() => setProjectInfoOpen(v => !v)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
                      projectInfoOpen
                        ? "border-violet-500/50 bg-violet-500/20 text-violet-200"
                        : "border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                    )}
                  >
                    <FolderOpen className="h-2.5 w-2.5" />
                    {projectCtx.emoji ?? "📂"} {projectCtx.name}
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize() }}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (isMobile && sheetSnap === 'collapsed') { setSheetSnap('half'); setExpanded(true) } }}
                placeholder={targets.length > 1 ? `发送给 ${targets.length} 个目标...` : "输入消息..."}
                rows={1}
                className="flex-1 rounded-xl border border-zinc-700 bg-[#18181b] px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 resize-none overflow-y-auto"
                style={{ maxHeight: 112 }}
                autoFocus
              />
              <button
                onClick={() => { void handleSend(); if (inputRef.current) inputRef.current.style.height = 'auto' }}
                disabled={!input.trim() || sending}
                className={cn(
                  "inline-flex items-center justify-center rounded-xl px-4 py-2 text-white shadow-lg transition",
                  input.trim()
                    ? "bg-emerald-600 shadow-emerald-900/20 hover:bg-emerald-500"
                    : "bg-zinc-700 shadow-none cursor-not-allowed opacity-50"
                )}
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
