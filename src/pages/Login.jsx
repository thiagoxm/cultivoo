import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../services/firebase'
import { useNavigate, Link } from 'react-router-dom'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function entrar(e) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, senha)
      navigate('/')
    } catch {
      setErro('E-mail ou senha incorretos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* Painel esquerdo — identidade visual */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden"
        style={{ background: 'var(--brand-gradient)' }}>

        {/* Padrão de fundo decorativo */}
        <div className="absolute inset-0 opacity-10">
          <svg width="100%" height="100%" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
            <circle cx="500" cy="100" r="300" fill="white" />
            <circle cx="100" cy="700" r="250" fill="white" />
          </svg>
        </div>

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-lg">
            <img src="/icon-192.png" alt="Cultivoo" className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-2xl tracking-wide">Cultivoo</span>
        </div>

        {/* Tagline */}
        <div className="relative space-y-4">
          <h2 className="text-white text-4xl font-bold leading-snug">
            Gestão rural simplificada
          </h2>
          <p className="text-white/70 text-lg leading-relaxed">
            Controle tudo em um só lugar.
          </p>
        </div>

        {/* Rodapé */}
        <p className="relative text-white/40 text-sm">© {new Date().getFullYear()} Cultivoo</p>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[#F1F8F1]">
        <div className="w-full max-w-sm space-y-8">

          {/* Logo mobile */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-md">
              <img src="/icon-192.png" alt="Cultivoo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-2xl tracking-wide" style={{ color: 'var(--cultivoo-800)' }}>
              Cultivoo
            </span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-800">Bem-vindo de volta</h1>
            <p className="text-sm text-gray-500 mt-1">Entre com sua conta para continuar</p>
          </div>

          <form onSubmit={entrar} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': 'var(--cultivoo-400)' }}
                placeholder="seu@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': 'var(--cultivoo-400)' }}
                placeholder="••••••••"
                required
              />
            </div>

            {erro && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm">{erro}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-md hover:shadow-lg active:scale-[0.98]"
              style={{ background: 'var(--brand-gradient)' }}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500">
            Não tem conta?{' '}
            <Link to="/cadastro"
              className="font-semibold hover:underline"
              style={{ color: 'var(--cultivoo-700)' }}>
              Cadastre-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}