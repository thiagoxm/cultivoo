import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../services/firebase'
import {
  LayoutDashboard, MapPin, Sprout, Layers,
  Tractor, DollarSign, LogOut, Menu, X
} from 'lucide-react'
import { useState } from 'react'

const menus = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/propriedades', icon: MapPin,           label: 'Propriedades' },
  { to: '/lavouras',     icon: Sprout,           label: 'Lavouras' },
  { to: '/safras',       icon: Layers,           label: 'Safras' },
  { to: '/patrimonio',   icon: Tractor,          label: 'Patrimônio' },
  { to: '/financeiro',   icon: DollarSign,       label: 'Financeiro' },
]

export default function Layout() {
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)

  async function sair() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-56 bg-green-800 text-white">
        <div className="p-5 text-xl font-bold tracking-wide border-b border-green-700">
          🌱 Cultivoo
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {menus.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-green-600 font-medium' : 'hover:bg-green-700'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={sair}
          className="flex items-center gap-3 px-6 py-4 text-sm hover:bg-green-700 border-t border-green-700"
        >
          <LogOut size={18} /> Sair
        </button>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-green-800 text-white flex items-center justify-between px-4 py-3">
        <span className="font-bold text-lg">🌱 Cultivoo</span>
        <button onClick={() => setAberto(!aberto)}>
          {aberto ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {aberto && (
        <div className="md:hidden fixed inset-0 z-40 bg-green-800 text-white pt-14">
          <nav className="p-4 space-y-1">
            {menus.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setAberto(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg text-base transition-colors ${
                    isActive ? 'bg-green-600 font-medium' : 'hover:bg-green-700'
                  }`
                }
              >
                <Icon size={20} />
                {label}
              </NavLink>
            ))}
            <button
              onClick={sair}
              className="flex items-center gap-3 px-4 py-3 text-base hover:bg-green-700 w-full mt-4"
            >
              <LogOut size={20} /> Sair
            </button>
          </nav>
        </div>
      )}

      {/* Conteúdo principal */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="max-w-5xl mx-auto p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}