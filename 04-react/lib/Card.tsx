import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
}

export function Card({ title, children }: CardProps) {
  return (
    <section className="lib-card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  )
}
