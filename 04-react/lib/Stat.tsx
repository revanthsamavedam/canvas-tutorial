import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: string | number
  icon: ReactNode
}

export function Stat({ label, value, icon }: StatProps) {
  return (
    <div className="lib-stat">
      <span className="lib-stat-icon">{icon}</span>
      <span className="lib-stat-value">{value}</span>
      <span className="lib-stat-label">{label}</span>
    </div>
  )
}
