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

  useEffect(() => {
    if (open) void refreshSkills().catch(toastError)
  }, [open, refreshSkills])

  return (
    <Modal open={open} title="Agent skills" onClose={onClose}>
      <p className="mb-3 text-[11.5px] leading-relaxed text-zinc-600">
        Enabled skills are exposed to the agent in every session.
      </p>
      {skills.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-zinc-600">No skills installed yet.</p>
      ) : (
        <ul className="space-y-1">
          {skills.map((skill) => (
            <li key={skill.name}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-zinc-800/60">
                <input
                  type="checkbox"
                  checked={skill.agentEnabled}
                  onChange={(e) =>
                    void setSkillEnabled(skill.name, e.target.checked).catch(toastError)
                  }
                  className="mt-0.5 accent-emerald-600"
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-zinc-200">{skill.name}</span>
                  <span className="block text-[11px] leading-relaxed text-zinc-500">
                    {skill.description}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
