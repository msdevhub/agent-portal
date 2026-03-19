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
  target: CommandTarget | null
  onClearTarget: () => void
}

const PORTAL_OPS_USER_ID = "n9izn6p15fboubx5reri5ftx6w"
const OTTOR_TARGET: CommandTarget = {
  id: "ottor-direct",
  name: "Ottor",
  emoji: "🔬",
  user_id: "ctgkdui9n38idyepmdzaoccgdw",
  kind: "bot",
}

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
  const m = msg.match(/^\[引用(服务器|Bot|机器人): ?([^\]]+)\]\s*/)
  if (m) return { ref: `${m[1] === "服务器" ? "🖥️" : "🤖"} ${m[2]}`, body: msg.slice(m[0].length) }
  return { ref: null, body: msg }
}

/** Deduplicate posts by id, keep latest */
function dedupPosts(posts: OpsPost[]): OpsPost[] {
  const map = new Map<string, OpsPost>()
  for (const p of posts) map.set(p.id, p)
  return Array.from(map.values()).sort((a, b) => a.create_at - b.create_at)
}

export function CommandBar({ target, onClearTarget }: CommandBarProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatByTarget, setChatByTarget] = useState<Record<string, ChatState>>({})
  const [sseConnected, setSseConnected] = useState(false)
  const [directChatActive, setDirectChatActive] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Effective target: either an explicit target from card, or Ottor direct chat
  const effectiveTarget = target ?? (directChatActive ? OTTOR_TARGET : null)
  const activeTargetKey = effectiveTarget ? `${effectiveTarget.kind ?? "bot"}:${effectiveTarget.id}` : null
  const activeChat = useMemo(() => {
    if (!activeTargetKey) return EMPTY_CHAT_STATE
    return chatByTarget[activeTargetKey] ?? EMPTY_CHAT_STATE
  }, [activeTargetKey, chatByTarget])
  const { messages, chatOpen, waitingSince, historyLoaded, historyLoading } = activeChat

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
                  chatOpen: true,
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

  // ── Auto-load history when target changes ──
  useEffect(() => {
    if (!effectiveTarget || !activeTargetKey) return
    const state = chatByTarget[activeTargetKey]
    if (state?.historyLoaded || state?.historyLoading) return

    // Mark as loading
    setChatByTarget((prev) => ({
      ...prev,
      [activeTargetKey]: {
        ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE),
        historyLoading: true,
      },
    }))

    const key = activeTargetKey // capture
    const userId = effectiveTarget.user_id

    void (async () => {
      try {
        // 1. Get/create DM channel
        const ch = await getOpsChannel(userId)
        const channelId = ch.channel_id
        if (!channelId) throw new Error("no channel")

        // 2. Load recent messages
        const result = await getOpsMessages(channelId)
        const posts = result?.posts ?? []

        setChatByTarget((prev) => {
          const existing = prev[key] ?? EMPTY_CHAT_STATE
          return {
            ...prev,
            [key]: {
              ...existing,
              channelId,
              messages: dedupPosts([...posts, ...existing.messages]),
              historyLoaded: true,
              historyLoading: false,
              chatOpen: posts.length > 0 || existing.chatOpen,
            },
          }
        })
      } catch {
        setChatByTarget((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? EMPTY_CHAT_STATE),
            historyLoaded: true,
            historyLoading: false,
          },
        }))
      }
    })()
  }, [effectiveTarget, activeTargetKey, chatByTarget])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, activeTargetKey])

  // Focus input
  useEffect(() => {
    if (effectiveTarget) inputRef.current?.focus()
  }, [effectiveTarget])

  // Clear error after 4s
  useEffect(() => {
    if (!error) return
    const t = window.setTimeout(() => setError(null), 4000)
    return () => window.clearTimeout(t)
  }, [error])

  // Timeout waiting after 5min
  useEffect(() => {
    if (!waitingSince || !activeTargetKey) return
    const key = activeTargetKey
    const timeout = window.setTimeout(() => {
      setChatByTarget((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? EMPTY_CHAT_STATE), waitingSince: null },
      }))
    }, 5 * 60 * 1000)
    return () => window.clearTimeout(timeout)
  }, [waitingSince, activeTargetKey])

  const handleSend = useCallback(async () => {
    if (!effectiveTarget || !activeTargetKey || !input.trim() || sending) return
    const msg = input.trim()
    setSending(true)
    setError(null)

    try {
      const finalMsg = effectiveTarget.kind === "server"
        ? `[引用服务器: ${effectiveTarget.name}] ${msg}`
        : msg

      const result = await sendOpsMessage(effectiveTarget.user_id, finalMsg)
      if (!result?.ok) { setError("发送失败"); return }

      const chId = result.channel_id ?? activeChat.channelId
      const sentPost: OpsPost = {
        id: result.post_id ?? `local-${Date.now()}`,
        channel_id: chId ?? "",
        user_id: PORTAL_OPS_USER_ID,
        message: msg,
        create_at: Date.now(),
        update_at: Date.now(),
      }

      setChatByTarget((prev) => ({
        ...prev,
        [activeTargetKey]: {
          ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE),
          channelId: chId,
          chatOpen: true,
          messages: dedupPosts([...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE).messages, sentPost]),
          waitingSince: Date.now(),
        },
      }))
      setInput("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败")
    } finally {
      setSending(false)
    }
  }, [effectiveTarget, activeTargetKey, input, sending, activeChat.channelId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const toggleChat = useCallback(() => {
    if (!activeTargetKey) return
    setChatByTarget((prev) => ({
      ...prev,
      [activeTargetKey]: {
        ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE),
        chatOpen: !activeChat.chatOpen,
      },
    }))
  }, [activeTargetKey, activeChat.chatOpen])

  const handleClearTarget = useCallback(() => {
    if (directChatActive && !target) {
      setDirectChatActive(false)
    } else {
      onClearTarget()
    }
  }, [directChatActive, target, onClearTarget])

  const isWaiting = waitingSince !== null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
      {/* ── Chat panel ── */}
      {chatOpen && (
        <div className="pointer-events-auto mx-auto max-w-3xl px-4">
          <div className="rounded-t-xl border border-b-0 border-zinc-700/60 bg-[#111113]/95 backdrop-blur-lg">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2">
              <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                {effectiveTarget?.emoji} {effectiveTarget?.name}
                {effectiveTarget?.kind === "server" && <Server className="h-3 w-3 text-zinc-500" />}
                {effectiveTarget?.kind === "bot" && <Bot className="h-3 w-3 text-zinc-500" />}
                {isWaiting && (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    等待回复
                  </span>
                )}
                {!sseConnected && <span className="ml-2 text-amber-400/70">⚠ 连接断开</span>}
              </span>
              <button type="button" onClick={toggleChat} className="text-zinc-500 transition hover:text-zinc-300">
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            {/* Messages area */}
            <div className="max-h-80 overflow-y-auto px-4 py-3 space-y-2">
              {historyLoading && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  加载历史消息…
                </div>
              )}

              {!historyLoading && messages.length === 0 && (
                <div className="py-6 text-center text-xs text-zinc-600">
                  暂无消息。发送第一条消息开始对话。
                </div>
              )}

              {messages.map((post) => {
                const isSelf = post.user_id === PORTAL_OPS_USER_ID
                const { ref, body } = parseRef(post.message ?? "")
                return (
                  <div
                    key={post.id}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                      isSelf
                        ? "ml-auto bg-emerald-500/15 text-emerald-100"
                        : "mr-auto bg-zinc-800/60 text-zinc-200"
                    )}
                  >
                    {!isSelf && (
                      <div className="mb-1 text-[10px] font-medium text-zinc-500">
                        {effectiveTarget?.emoji ?? "🤖"} {effectiveTarget?.name ?? "Bot"}
                      </div>
                    )}
                    {/* Reference badge */}
                    {ref && (
                      <div className="mb-1.5 inline-flex items-center gap-1 rounded-md border border-zinc-700/50 bg-zinc-800/40 px-2 py-0.5 text-[10px] text-zinc-400">
                        {ref}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{body}</div>
                    <div className="mt-1 text-right text-[10px] text-zinc-600">
                      {formatTime(post.create_at)}
                    </div>
                  </div>
                )
              })}

              {isWaiting && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3 mr-auto">
                  <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
                  <span className="text-xs text-zinc-500">等待回复…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* ── Input bar ── */}
      <div className="pointer-events-auto border-t border-zinc-800/60 bg-[#09090b]/95 backdrop-blur-lg shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          {/* Chat toggle / Ottor quick button */}
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={toggleChat}
              className="rounded-lg border border-zinc-800 bg-[#18181b] p-2 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
              title={chatOpen ? "收起" : "展开"}
            >
              {chatOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          ) : !effectiveTarget && (
            <button
              type="button"
              onClick={() => setDirectChatActive(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/15"
              title="和 Ottor 对话"
            >
              <span>🔬</span>
              <span>Ottor</span>
            </button>
          )}

          {/* Target badge */}
          {effectiveTarget ? (
            <button
              type="button"
              onClick={handleClearTarget}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                effectiveTarget.kind === "server"
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              )}
              title="点击清除"
            >
              <span>{effectiveTarget.emoji}</span>
              <span>@{effectiveTarget.name}</span>
              <X className="h-3 w-3" />
            </button>
          ) : (
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#18181b] px-3 py-1.5 text-xs text-zinc-600">
              <MessageSquare className="h-3 w-3" />
              <span>选择目标或点击 🔬 Ottor 开始对话</span>
            </div>
          )}

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={effectiveTarget ? `给 ${effectiveTarget.name} 发消息...` : "先选择一个目标"}
            disabled={!effectiveTarget || sending}
            className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-[#18181b] px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 transition focus:border-emerald-500/40 focus:outline-none disabled:opacity-50"
          />

          {/* Send */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!effectiveTarget || !input.trim() || sending}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-auto max-w-3xl px-4 pb-2">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTime(ts?: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
