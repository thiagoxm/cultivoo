import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../services/firebase'
import { useNavigate, Link } from 'react-router-dom'

const funcoes = ['Proprietário', 'Consultor', 'Gerente', 'Agrônomo', 'Contador', 'Outro']

export default function Cadastro() {
  const [form, setForm] = useState({
    nome: '', sobrenome: '', telefone: '', funcao: '', email: '', senha: ''
  })
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  function atualizar(campo, valor) {
    setForm(f => ({ ...f, [campo]: valor }))
  }

  async function cadastrar(e) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.senha)
      await setDoc(doc(db, 'usuarios', cred.user.uid), {
        nome: form.nome,
        sobrenome: form.sobrenome,
        telefone: form.telefone,
        funcao: form.funcao,
        email: form.email,
        criadoEm: new Date()
      })
      navigate('/')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') setErro('E-mail já cadastrado.')
      else if (err.code === 'auth/weak-password') setErro('Senha deve ter pelo menos 6 caracteres.')
      else setErro('Erro ao cadastrar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent transition-all"

  return (
    <div className="min-h-screen flex">

      {/* Painel esquerdo */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden"
        style={{ background: 'var(--brand-gradient)' }}>
        <div className="absolute inset-0 opacity-10">
          <svg width="100%" height="100%" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
            <circle cx="500" cy="100" r="300" fill="white" />
            <circle cx="100" cy="700" r="250" fill="white" />
          </svg>
        </div>
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-lg">
            <img src="/icon-192.png" alt="Cultivoo" className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-2xl tracking-wide">Cultivoo</span>
        </div>
        <div className="relative space-y-4">
          <h2 className="text-white text-4xl font-bold leading-snug">
            Comece agora, sem complicação!
          </h2>
          <p className="text-white/70 text-lg leading-relaxed">
            Crie sua conta em menos de 1 minuto e comece a gerenciar sua propriedade hoje.
          </p>
        </div>
        <p className="relative text-white/40 text-sm">© {new Date().getFullYear()} Cultivoo</p>
      </div>

      {/* Painel direito */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[#F1F8F1] overflow-y-auto">
        <div className="w-full max-w-sm space-y-6 py-8">

          {/* Logo mobile */}
          <div className="lg:hidden flex items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-md">
              <img src="/icon-192.png" alt="Cultivoo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-2xl tracking-wide" style={{ color: 'var(--cultivoo-800)' }}>
              Cultivoo
            </span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-800">Criar conta</h1>
            <p className="text-sm text-gray-500 mt-1">Preencha os dados para começar</p>
          </div>

          <form onSubmit={cadastrar} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input value={form.nome} onChange={e => atualizar('nome', e.target.value)}
                  className={inputClass} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
                <input value={form.sobrenome} onChange={e => atualizar('sobrenome', e.target.value)}
                  className={inputClass} required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input value={form.telefone} onChange={e => atualizar('telefone', e.target.value)}
                placeholder="(00) 00000-0000" className={inputClass} required />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Função</label>
              <select value={form.funcao} onChange={e => atualizar('funcao', e.target.value)}
                className={inputClass} required>
                <option value="">Selecione...</option>
                {funcoes.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input type="email" value={form.email} onChange={e => atualizar('email', e.target.value)}
                className={inputClass} required />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
              <input type="password" value={form.senha} onChange={e => atualizar('senha', e.target.value)}
                placeholder="mínimo 6 caracteres" className={inputClass} required />
            </div>

            {erro && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm">{erro}</p>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-md hover:shadow-lg active:scale-[0.98]"
              style={{ background: 'var(--brand-gradient)' }}>
              {loading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500">
            Já tem conta?{' '}
            <Link to="/login"
              className="font-semibold hover:underline"
              style={{ color: 'var(--cultivoo-700)' }}>
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}