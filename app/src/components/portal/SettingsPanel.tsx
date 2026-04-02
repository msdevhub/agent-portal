import { useEffect, useState } from "react"
import { Settings, X, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchPortalSettings, updatePortalSettings, fetchBotsList } from "@/lib/api"

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

interface BotOption {
  agent_id: string
  name: string
  emoji: string
  mm_user_id: string
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [bots, setBots] = useState<BotOption[]>([])
  const [defaultBot, setDefaultBot] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([fetchPortalSettings(), fetchBotsList()])
      .then(([settings, botList]) => {
        setDefaultBot(settings?.default_bot ?? null)
        setBots(
          (botList ?? []).map((b: any) => ({
            agent_id: b.agent_id ?? b.id,
            name: b.name ?? b.agent_id,
            emoji: b.emoji ?? "🤖",
            mm_user_id: b.mm_user_id ?? "",
          }))
        )
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  const handleSave = async (bot: BotOption) => {
    const value = {
      agent_id: bot.agent_id,
      name: bot.name,
      mm_user_id: bot.mm_user_id,
      emoji: bot.emoji,
    }
    setDefaultBot(value)
    setSaving(true)
    setSaved(false)
    try {
      await updatePortalSettings({ default_bot: value })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-[71] w-[320px] max-w-[85vw] bg-[#111113] border-l border-zinc-800 flex flex-col transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800">
              <Settings className="h-4 w-4 text-zinc-300" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">设置</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Default Bot */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              默认对话 Bot
            </label>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {bots.map((bot) => {
                  const isSelected = defaultBot?.agent_id === bot.agent_id
                  return (
                    <button
                      key={bot.agent_id}
                      onClick={() => handleSave(bot)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        isSelected
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-zinc-800 bg-[#18181b] hover:border-zinc-700 hover:bg-zinc-800"
                      )}
                    >
                      <span className="text-lg">{bot.emoji}</span>
                      <span className={cn("text-sm font-medium flex-1", isSelected ? "text-emerald-300" : "text-zinc-300")}>
                        {bot.name}
                      </span>
                      {isSelected && <Check className="h-4 w-4 text-emerald-400" />}
                    </button>
                  )
                })}
                {bots.length === 0 && (
                  <div className="text-xs text-zinc-600 text-center py-4">暂无可用 Bot</div>
                )}
              </div>
            )}
            {/* Save status */}
            {saving && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" /> 保存中...
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Check className="h-3 w-3" /> 已保存
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
