import type { MouseEventHandler, ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  // Accepted but not forwarded to the <button>: on main, Home passes
  // `disabled` and Button silently ignores it, so the button is never
  // actually disabled. Kept that way here — forwarding it would change
  // behaviour, not just add types.
  disabled?: boolean
}

export function Button({ children, onClick }: ButtonProps) {
  return (
    <button className="lib-button" type="button" onClick={onClick}>
      {children}
    </button>
  )
}
