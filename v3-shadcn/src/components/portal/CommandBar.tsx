import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, ChevronDown, ChevronUp, Loader2, MessageSquare, Send, Server, X } from "lucide-react"

import type { OpsPost } from "@/lib/api"
import { getOpsChannel, getOpsMessages, sendOpsMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface CommandTarget {
  id: string
  name: string
  emoji: string
  user_id: string
  kind?: "bot" | "server"
}

interface CommandBarProps {
  targets: CommandTarget[]
  onClearTarget: (id?: string) => void
}

const PORTAL_SENDER_USER_ID = "8zzs18ha4fdhf8jt8ybm61eqdw" // @dora (admin token sends as this user)

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
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Determine effective targets: if targets selected, use them. Else if direct chat, use Ottor.
  const isMultiTarget = targets.length > 1
  const primaryTarget = targets[0] ?? (directChatActive ? { id: "ottor-direct", name: "Ottor", emoji: "🔬", user_id: "ctgkdui9n38idyepmdzaoccgdw", kind: "bot" } : null)
  
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
    }
  }, [targets.length, directChatActive])

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
        const refs = targets.map(t => `[引用${t.kind === "server" ? "服务器" : "Bot"}: ${t.name}]`).join(" ")
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // If no target selected and not in direct chat, show nothing (or minimal bar)
  if (!primaryTarget && !directChatActive) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none p-4 flex justify-center">
        <button
          onClick={() => { setDirectChatActive(true); setExpanded(true); }}
          className="pointer-events-auto shadow-xl shadow-black/40 flex items-center gap-2 rounded-full border border-zinc-700 bg-[#18181b] px-4 py-2.5 text-sm font-medium text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 hover:scale-105 transition-all"
        >
          <MessageSquare className="h-4 w-4" />
          <span>开始对话</span>
        </button>
      </div>
    )
  }

  return (
    <div className={cn(
      "fixed inset-x-0 bottom-0 z-50 transition-all duration-300",
      expanded ? "h-[85vh] sm:h-[600px]" : "h-auto"
    )}>
      {/* Backdrop for mobile full screen */}
      {expanded && (
        <div 
          className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:hidden"
          onClick={() => setExpanded(false)}
        />
      )}

      <div className="flex h-full flex-col justify-end">
        <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-t-2xl border border-b-0 border-zinc-700/60 bg-[#111113]/95 shadow-2xl backdrop-blur-xl sm:mx-auto sm:mb-0">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3 bg-[#18181b]/50">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="flex -space-x-1.5 overflow-hidden p-0.5">
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
              
              <div className="flex flex-col">
                <span className="text-sm font-medium text-zinc-200 truncate">
                  {targets.length > 0 
                    ? `${targets.map(t => t.name).join(", ")}` 
                    : "Ottor (Direct)"}
                </span>
                {waitingSince && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Waiting...
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button 
                onClick={() => setExpanded(!expanded)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
              <button 
                onClick={() => { onClearTarget(); setDirectChatActive(false); setExpanded(false); }}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          {expanded && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-[300px] max-h-[calc(85vh-130px)] sm:max-h-[460px]">
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
                const isSelf = post.user_id === PORTAL_SENDER_USER_ID
                const { ref, body } = parseRef(post.message ?? "")
                
                return (
                  <div key={post.id} className={cn("flex w-full", isSelf ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
                      isSelf 
                        ? "bg-emerald-600/20 text-emerald-100 rounded-br-none" 
                        : "bg-zinc-800/60 text-zinc-200 rounded-bl-none"
                    )}>
                      {ref && (
                        <div className="mb-1 inline-flex rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                          {ref}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words">{body}</div>
                      <div className="mt-1 text-right text-[10px] opacity-50">
                        {new Date(post.create_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
            {/* Selected Tags Chips (Removable) */}
            {targets.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {targets.map(t => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-300">
                    <span>{t.emoji}</span>
                    <span>{t.name}</span>
                    <button onClick={() => onClearTarget(t.id)} className="hover:text-white"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={targets.length > 1 ? `发送给 ${targets.length} 个目标...` : "输入消息..."}
                className="flex-1 rounded-xl border border-zinc-700 bg-[#18181b] px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                autoFocus
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || sending}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
