import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home.tsx'
import { About } from './pages/About.tsx'

// MemoryRouter, not HashRouter or BrowserRouter: the page runs inside
// a srcDoc iframe, whose URL is `about:srcdoc` — there is no real URL
// to put a hash or a path on, and HashRouter's location handling
// throws there (react-router's encodeLocation does `new URL(...)`
// against the page URL, which fails on about:srcdoc). MemoryRouter
// keeps the history in memory; Link navigation still works, and the
// routes are the same (/ and /about).
export default function App() {
  return (
    <MemoryRouter>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </MemoryRouter>
  )
}
