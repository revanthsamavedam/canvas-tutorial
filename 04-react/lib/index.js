// The pre-existing component library. In a real deployment this folder
// is your design system: a workspace package, a git submodule, or an npm
// package. The app imports it by name ('@canvas-lib') and the builder
// resolves it at build time — the library never ships as a separate file
// and is never loaded from a CDN at view time.
import './styles.css'

export { Button } from './Button.jsx'
export { Card } from './Card.jsx'
export { Stat } from './Stat.jsx'
