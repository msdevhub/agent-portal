import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MessageSquare, Send, X, ChevronUp, ChevronDown, Loader2 } from "lucide-react"

import type { OpsPost } from "@/lib/api"
import { sendOpsMessage, getOpsMessages } from "@/lib/api"
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

type ChatState = {
  channelId: string | null
  messages: OpsPost[]
  chatOpen: boolean
  pollingSince: number | null
}

const EMPTY_CHAT_STATE: ChatState = {
  channelId: null,
  messages: [],
  chatOpen: false,
  pollingSince: null,
}

export function CommandBar({ target, onClearTarget }: CommandBarProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatByTarget, setChatByTarget] = useState<Record<string, ChatState>>({})
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollCountRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const activeTargetKey = target ? `${target.kind ?? "bot"}:${target.id}` : null
  const activeChat = useMemo(() => {
    if (!activeTargetKey) return EMPTY_CHAT_STATE
    return chatByTarget[activeTargetKey] ?? EMPTY_CHAT_STATE
  }, [activeTargetKey, chatByTarget])
  const { channelId, messages, chatOpen, pollingSince } = activeChat

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, activeTargetKey])

  // Focus input when target changes
  useEffect(() => {
    if (target) {
      inputRef.current?.focus()
    }
  }, [target])

  // Clear error after 4s
  useEffect(() => {
    if (!error) return
    const t = window.setTimeout(() => setError(null), 4000)
    return () => window.clearTimeout(t)
  }, [error])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  // Poll for replies after sending
  const startPolling = useCallback((targetKey: string, chId: string, sinceTs: number) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollCountRef.current = 0
    setChatByTarget((prev) => ({
      ...prev,
      [targetKey]: {
        ...(prev[targetKey] ?? EMPTY_CHAT_STATE),
        pollingSince: sinceTs,
      },
    }))

    const poll = async () => {
      try {
        const result = await getOpsMessages(chId, sinceTs)
        const posts = result?.posts ?? []
        if (posts.length > 0) {
          setChatByTarget((prev) => {
            const current = prev[targetKey] ?? EMPTY_CHAT_STATE
            const existingIds = new Set(current.messages.map((p) => p.id))
            const newPosts = posts.filter((p) => !existingIds.has(p.id))
            return newPosts.length > 0
              ? {
                  ...prev,
                  [targetKey]: {
                    ...current,
                    messages: [...current.messages, ...newPosts],
                  },
                }
              : prev
          })
        }
      } catch {
        // Silently ignore polling errors
      }

      pollCountRef.current += 1
      if (pollCountRef.current < 10) {
        pollTimerRef.current = setTimeout(poll, 3000)
      } else {
        setChatByTarget((prev) => ({
          ...prev,
          [targetKey]: {
            ...(prev[targetKey] ?? EMPTY_CHAT_STATE),
            pollingSince: null,
          },
        }))
      }
    }

    pollTimerRef.current = setTimeout(poll, 3000)
  }, [])

  const handleSend = async () => {
    if (!target || !activeTargetKey || !input.trim() || sending) return

    const msg = input.trim()
    setSending(true)
    setError(null)

    try {
      const result = await sendOpsMessage(target.user_id, msg)
      if (!result?.ok) {
        setError("发送失败")
        return
      }

      const chId = result.channel_id ?? channelId

      // Add our sent message locally
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
          messages: [...((prev[activeTargetKey] ?? EMPTY_CHAT_STATE).messages), sentPost],
        },
      }))
      setInput("")

      // Start polling for reply — use create_at from sent post minus 1s to avoid race
      if (chId) {
        startPolling(activeTargetKey, chId, Date.now() - 1000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败")
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const isPolling = pollingSince !== null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
      {/* Chat history panel */}
      {chatOpen && messages.length > 0 && (
        <div className="pointer-events-auto mx-auto max-w-3xl px-4">
          <div className="rounded-t-xl border border-b-0 border-zinc-700/60 bg-[#111113]/95 backdrop-blur-lg">
            <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2">
              <span className="text-xs font-medium text-zinc-400">
                对话 {target ? `· ${target.emoji} ${target.name}` : ""}
                {isPolling && (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    等待回复
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => activeTargetKey && setChatByTarget((prev) => ({ ...prev, [activeTargetKey]: { ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE), chatOpen: false } }))}
                className="text-zinc-500 transition hover:text-zinc-300"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((post) => {
                const isSelf = post.user_id === PORTAL_OPS_USER_ID
                return (
                  <div
                    key={post.id}
                    className={cn(
                      "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-6",
                      isSelf
                        ? "ml-auto bg-emerald-500/15 text-emerald-100"
                        : "mr-auto bg-zinc-800/60 text-zinc-200"
                    )}
                  >
                    {!isSelf && (
                      <div className="mb-1 text-[10px] font-medium text-zinc-500">
                        {target?.emoji ?? "🤖"} {target?.name ?? "Bot"}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{post.message ?? ""}</div>
                    <div className="mt-1 text-right text-[10px] text-zinc-600">
                      {formatTime(post.create_at)}
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="pointer-events-auto border-t border-zinc-800/60 bg-[#09090b]/95 backdrop-blur-lg shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          {/* Chat toggle */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => activeTargetKey && setChatByTarget((prev) => ({ ...prev, [activeTargetKey]: { ...(prev[activeTargetKey] ?? EMPTY_CHAT_STATE), chatOpen: !chatOpen } }))}
              className="rounded-lg border border-zinc-800 bg-[#18181b] p-2 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
              title={chatOpen ? "收起对话" : "展开对话"}
            >
              {chatOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}

          {/* Target badge */}
          {target ? (
            <button
              type="button"
              onClick={onClearTarget}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
              title="点击清除引用"
            >
              <span>{target.emoji}</span>
              <span>@{target.name}</span>
              <X className="h-3 w-3" />
            </button>
          ) : (
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#18181b] px-3 py-1.5 text-xs text-zinc-600">
              <MessageSquare className="h-3 w-3" />
              <span>点击 Bot 卡片 💬 选择目标</span>
            </div>
          )}

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={target ? `给 ${target.name} 发指令...` : "先选择一个 Bot"}
            disabled={!target || sending}
            className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-[#18181b] px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 transition focus:border-emerald-500/40 focus:outline-none disabled:opacity-50"
          />

          {/* Send button */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!target || !input.trim() || sending}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        {/* Error display */}
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
