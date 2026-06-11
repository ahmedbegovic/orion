import { useEffect } from 'react'
import { useAgentStore } from '@/stores/agent'
import { toastError } from '@/stores/toasts'
import Modal from '../chat/Modal'

interface Props {
  open: boolean
  onClose: () => void
}

export default function SkillsPanel({ open, onClose }: Props) {
  const skills = useAgentStore((s) => s.skills)
  const refreshSkills = useAgentStore((s) => s.refreshSkills)
  const setSkillEnabled = useAgentStore((s) => s.setSkillEnabled)
  const setSkillChatEnabled = useAgentStore((s) => s.setSkillChatEnabled)

  useEffect(() => {
    if (open) void refreshSkills().catch(toastError)
  }, [open, refreshSkills])

  return (
    <Modal open={open} title="Skills" onClose={onClose}>
      <p className="mb-3 text-[11.5px] leading-relaxed text-zinc-600">
        Agent exposes a skill to Code/Agent sessions; Chat lists it in the chat system prompt.
        Coding skills should stay chat-off.
      </p>
      {skills.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-zinc-600">No skills installed yet.</p>
      ) : (
        <ul className="space-y-1">
          {skills.map((skill) => (
            <li
              key={skill.name}
              className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-zinc-800/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-zinc-200">{skill.name}</span>
                <span className="block text-[11px] leading-relaxed text-zinc-500">
                  {skill.description}
                </span>
              </span>
              <label className="flex shrink-0 cursor-pointer items-center gap-1 pt-0.5 text-[11px] text-zinc-500">
                <input
                  type="checkbox"
                  checked={skill.agentEnabled}
                  onChange={(e) =>
                    void setSkillEnabled(skill.name, e.target.checked).catch(toastError)
                  }
                  className="accent-emerald-600"
                />
                Agent
              </label>
              <label className="flex shrink-0 cursor-pointer items-center gap-1 pt-0.5 text-[11px] text-zinc-500">
                <input
                  type="checkbox"
                  checked={skill.chatEnabled}
                  onChange={(e) =>
                    void setSkillChatEnabled(skill.name, e.target.checked).catch(toastError)
                  }
                  className="accent-emerald-600"
                />
                Chat
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
