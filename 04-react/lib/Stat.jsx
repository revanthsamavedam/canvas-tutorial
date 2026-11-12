export function Stat({ label, value, icon }) {
  return (
    <div className="lib-stat">
      <span className="lib-stat-icon">{icon}</span>
      <span className="lib-stat-value">{value}</span>
      <span className="lib-stat-label">{label}</span>
    </div>
  )
}
