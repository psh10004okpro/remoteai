import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Host from './pages/Host'
import Session from './pages/Session'
import Features from './pages/Features'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/host" element={<Host />} />
      <Route path="/session" element={<Session />} />
      <Route path="/features" element={<Features />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
