import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../services/firebase'
import {
  LayoutDashboard, MapPin, Sprout, Layers,
  Tractor, DollarSign, LogOut, Menu, X, Leaf, Settings, Wheat, Package,
  Warehouse
} from 'lucide-react'
import { useState } from 'react'

const menus = [
  { to: '/',               icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/propriedades',   icon: MapPin,           label: 'Propriedades' },
  { to: '/lavouras',       icon: Sprout,           label: 'Lavouras' },
  { to: '/safras',         icon: Layers,           label: 'Safras' },
  { to: '/producao',       icon: Wheat,            label: 'Produção' },
  { to: '/patrimonio',     icon: Tractor,          label: 'Patrimônio' },
  { to: '/financeiro',     icon: DollarSign,       label: 'Financeiro' },
  { to: '/estoque',        icon: Package,          label: 'Estoque Insumos' },
  { to: '/estoque-producao',        icon: Warehouse,          label: 'Estoque Produção' },
]

export default function Layout() {
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)

  async function sair() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-[#F1F8F1]">

      {/* ── Sidebar desktop ── */}
      <aside className="hidden md:flex flex-col w-60"
        style={{ background: 'var(--sidebar-bg)' }}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5"
          style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
          <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 shadow-md">
            <img src="/icon-192.png" alt="Cultivoo" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-white font-bold text-base leading-tight tracking-wide">Cultivoo</p>
            <p className="text-xs leading-tight" style={{ color: 'var(--sidebar-text-muted)' }}>
              Gestão rural
            </p>
          </div>
        </div>

        {/* Menu */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {menus.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                  isActive
                    ? 'font-semibold shadow-sm'
                    : 'hover:opacity-90'
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--sidebar-active)' : 'transparent',
                color: isActive ? '#fff' : 'var(--sidebar-text)',
                boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
              })}
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Rodapé */}
        <div style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          <NavLink to="/configuracoes"
            className={({ isActive }) =>
              `flex items-center gap-3 px-6 py-3 text-sm transition-opacity hover:opacity-75 ${
                isActive ? 'opacity-100' : 'opacity-70'
              }`
            }
            style={{ color: 'var(--sidebar-text-muted)' }}>
            <Settings size={16} />
            Configurações
          </NavLink>
          <button
            onClick={sair}
            className="flex items-center gap-3 px-6 py-3 w-full text-sm transition-opacity hover:opacity-75"
            style={{ color: 'var(--sidebar-text-muted)' }}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* ── Header mobile ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 shadow-md"
        style={{ background: 'var(--sidebar-bg)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg overflow-hidden">
            <img src="/icon-192.png" alt="Cultivoo" className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-base tracking-wide">Cultivoo</span>
        </div>
        <button onClick={() => setAberto(!aberto)} className="text-white p-1">
          {aberto ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* ── Menu mobile overlay ── */}
      {aberto && (
        <div className="md:hidden fixed inset-0 z-40 pt-14 flex flex-col"
          style={{ background: 'var(--sidebar-bg)' }}>

          {/* Itens principais — ocupam o espaço disponível */}
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
            {menus.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setAberto(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-all ${
                    isActive ? 'font-semibold' : ''
                  }`
                }
                style={({ isActive }) => ({
                  background: isActive ? 'var(--sidebar-active)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--sidebar-text)',
                })}
              >
                <Icon size={20} />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Rodapé mobile — Configurações + Sair fixos na base */}
          <div className="px-4 pb-6" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
            <NavLink to="/configuracoes"
              onClick={() => setAberto(false)}
              className="flex items-center gap-3 px-4 py-3 text-base w-full transition-opacity hover:opacity-75"
              style={{ color: 'var(--sidebar-text-muted)' }}>
              <Settings size={20} />
              Configurações
            </NavLink>
            <button
              onClick={sair}
              className="flex items-center gap-3 px-4 py-3 text-base w-full transition-opacity hover:opacity-75"
              style={{ color: 'var(--sidebar-text-muted)' }}>
              <LogOut size={20} />
              Sair
            </button>
          </div>
        </div>
      )}

      {/* ── Conteúdo principal ── */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="max-w-5xl mx-auto p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}