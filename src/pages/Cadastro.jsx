import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../services/firebase'
import { useNavigate, Link } from 'react-router-dom'

const funcoes = ['Proprietário', 'Consultor', 'Gerente', 'Agrônomo', 'Contador', 'Outro']

export default function Cadastro() {
  const [form, setForm] = useState({ nome: '', sobrenome: '', telefone: '', funcao: '', email: '', senha: '' })
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

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🌱</div>
          <h1 className="text-2xl font-bold text-green-800">Criar conta</h1>
          <p className="text-gray-500 text-sm mt-1">Comece a gerenciar sua propriedade</p>
        </div>
        <form onSubmit={cadastrar} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
              <input value={form.nome} onChange={e => atualizar('nome', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
              <input value={form.sobrenome} onChange={e => atualizar('sobrenome', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
            <input value={form.telefone} onChange={e => atualizar('telefone', e.target.value)}
              placeholder="(00) 00000-0000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Função</label>
            <select value={form.funcao} onChange={e => atualizar('funcao', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              required>
              <option value="">Selecione...</option>
              {funcoes.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input type="email" value={form.email} onChange={e => atualizar('email', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input type="password" value={form.senha} onChange={e => atualizar('senha', e.target.value)}
              placeholder="mínimo 6 caracteres"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              required />
          </div>
          {erro && <p className="text-red-500 text-sm">{erro}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 transition-colors disabled:opacity-50">
            {loading ? 'Criando conta...' : 'Criar conta'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-6">
          Já tem conta?{' '}
          <Link to="/login" className="text-green-700 font-medium hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  )
}