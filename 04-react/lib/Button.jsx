export function Button({ children, onClick }) {
  return (
    <button className="lib-button" type="button" onClick={onClick}>
      {children}
    </button>
  )
}
