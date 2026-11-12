export function Card({ title, children }) {
  return (
    <section className="lib-card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  )
}
