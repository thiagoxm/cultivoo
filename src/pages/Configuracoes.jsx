import { useEffect, useState } from 'react'
import {
  doc, getDoc, setDoc, collection, query,
  where, getDocs, updateDoc, deleteDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  User, Sprout, Share2, Plus, Trash2, Pencil,
  X, Check, AlertCircle, Wheat, Coffee, Cloud, Leaf, Bean
} from 'lucide-react'

const CULTURAS_PADRAO = [
  'Soja', 'Milho', 'Cana-de-açúcar', 'Café', 'Algodão',
  'Arroz', 'Feijão', 'Trigo', 'Sorgo', 'Outro'
]

// Sugestões para autocomplete
const CULTURAS_SUGESTOES = [
  'Algodão', 'Amendoim', 'Arroz', 'Aveia', 'Azevém',
  'Batata', 'Café', 'Cana-de-açúcar', 'Cebola', 'Centeio',
  'Cevada', 'Ervilha', 'Feijão', 'Fumo', 'Girassol',
  'Mandioca', 'Milho', 'Soja', 'Sorgo', 'Tomate',
  'Trigo', 'Uva', 'Outro'
]

function iconeCultura(nome) {
  const n = nome?.toLowerCase() || ''
  if (n.includes('café')) return <Coffee size={13} className="text-amber-700" />
  if (n.includes('cana')) return <Leaf size={13} className="text-green-500" />
  if (n.includes('algodão')) return <Cloud size={13} className="text-blue-300" />
  if (n.includes('uva')) return <Leaf size={13} className="text-purple-500" />
  if (n.includes('feijão')) return <Bean size={13} className="text-amber-900" />
  if (['soja','milho','arroz','trigo','sorgo','aveia','cevada','centeio','amendoim','girassol'].some(c => n.includes(c)))
    return <Wheat size={13} className="text-yellow-600" />
  return <Sprout size={13} className="text-green-600" />
}

const FUNCOES = ['Proprietário', 'Consultor', 'Gerente', 'Agrônomo', 'Contador', 'Outro']

const ABAS_PERMISSAO = [
  { key: 'lavouras',   label: 'Lavouras' },
  { key: 'safras',     label: 'Safras' },
  { key: 'patrimonio', label: 'Patrimônio' },
  { key: 'financeiro', label: 'Financeiro' },
]

function mascaraTelefone(valor) {
  const nums = valor.replace(/\D/g, '').slice(0, 11)
  if (nums.length <= 2) return nums.length ? `(${nums}` : ''
  if (nums.length <= 7) return `(${nums.slice(0,2)}) ${nums.slice(2)}`
  return `(${nums.slice(0,2)}) ${nums.slice(2,7)}-${nums.slice(7)}`
}

export default function Configuracoes() {
  const { usuario } = useAuth()
  const [abaSelecionada, setAbaSelecionada] = useState('perfil')
  const [loading, setLoading] = useState(false)
  const [sucesso, setSucesso] = useState('')

  // ── Perfil ───────────────────────────────────────────────────────────────────
  const [perfil, setPerfil] = useState({
    nome: '', sobrenome: '', telefone: '', funcao: ''
  })

  // ── Culturas ──────────────────────────────────────────────────────────────────
  const [culturas, setCulturas] = useState([])
  const [novaCultura, setNovaCultura] = useState('')
  const [sugestoesFiltradas, setSugestoesFiltradas] = useState([])
  const [dropdownCulturaAberto, setDropdownCulturaAberto] = useState(false)
  const [confirmacaoExcluirCultura, setConfirmacaoExcluirCultura] = useState(null)

  // ── Compartilhamentos ─────────────────────────────────────────────────────────
  const [convitesConcedidos, setConvitesConcedidos] = useState([])
  const [convitesRecebidos, setConvitesRecebidos] = useState([])
  const [modalPermissoes, setModalPermissoes] = useState(null)
  const [confirmacaoRevogar, setConfirmacaoRevogar] = useState(null)

  async function carregar() {
    const uid = usuario.uid
    const email = usuario.email

    const userDoc = await getDoc(doc(db, 'usuarios', uid))
    if (userDoc.exists()) {
        const d = userDoc.data()
        setPerfil({
            nome: d.nome || '',
            sobrenome: d.sobrenome || '',
            telefone: mascaraTelefone(d.telefone || ''),
            funcao: d.funcao || '',
        })
      setCulturas(d.culturasFavoritas?.length > 0 ? d.culturasFavoritas : [...CULTURAS_PADRAO])
    } else {
      setCulturas([...CULTURAS_PADRAO])
    }

    const [concedidosSnap, recebidosSnap] = await Promise.all([
      getDocs(query(collection(db, 'convites'), where('proprietarioUid', '==', uid))),
      getDocs(query(collection(db, 'convites'), where('emailConvidado', '==', email))),
    ])
    setConvitesConcedidos(concedidosSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setConvitesRecebidos(recebidosSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  function mostrarSucesso(msg) {
    setSucesso(msg)
    setTimeout(() => setSucesso(''), 3000)
  }

  // ── Perfil ───────────────────────────────────────────────────────────────────
  async function salvarPerfil(e) {
    e.preventDefault()
    setLoading(true)
    await setDoc(doc(db, 'usuarios', usuario.uid), {
      ...perfil,
      email: usuario.email,
      culturasFavoritas: culturas,
    }, { merge: true })
    setLoading(false)
    mostrarSucesso('Perfil atualizado com sucesso!')
  }

  // ── Culturas ──────────────────────────────────────────────────────────────────
  function onChangeCultura(texto) {
    setNovaCultura(texto)
    if (texto.length < 1) {
      setSugestoesFiltradas([])
      setDropdownCulturaAberto(false)
      return
    }
    const filtradas = CULTURAS_SUGESTOES.filter(c =>
      c.toLowerCase().includes(texto.toLowerCase()) && !culturas.includes(c)
    )
    setSugestoesFiltradas(filtradas)
    setDropdownCulturaAberto(filtradas.length > 0)
  }

  function selecionarSugestao(cultura) {
    setNovaCultura(cultura)
    setSugestoesFiltradas([])
    setDropdownCulturaAberto(false)
  }

  function adicionarCultura() {
    const cultura = novaCultura.trim()
    if (!cultura) return
    if (culturas.includes(cultura)) return alert('Esta cultura já está na lista.')
    setCulturas(c => [...c, cultura])
    setNovaCultura('')
    setSugestoesFiltradas([])
    setDropdownCulturaAberto(false)
  }

  function removerCultura(cultura) {
    setCulturas(c => c.filter(x => x !== cultura))
    setConfirmacaoExcluirCultura(null)
  }

  async function salvarCulturas() {
    setLoading(true)
    await setDoc(doc(db, 'usuarios', usuario.uid), {
      culturasFavoritas: culturas
    }, { merge: true })
    setLoading(false)
    mostrarSucesso('Culturas salvas com sucesso!')
  }

  // ── Compartilhamentos ─────────────────────────────────────────────────────────
  async function salvarPermissoes() {
    if (!modalPermissoes) return
    setLoading(true)
    await updateDoc(doc(db, 'convites', modalPermissoes.conviteId), {
      permissoes: modalPermissoes.permissoes
    })
    setModalPermissoes(null)
    await carregar()
    setLoading(false)
    mostrarSucesso('Permissões atualizadas!')
  }

  async function revogarAcesso(conviteId) {
    await deleteDoc(doc(db, 'convites', conviteId))
    await carregar()
    mostrarSucesso('Acesso revogado.')
  }

  async function sairCompartilhamento(conviteId) {
    await updateDoc(doc(db, 'convites', conviteId), { status: 'recusado' })
    await carregar()
    mostrarSucesso('Você saiu do compartilhamento.')
  }

  const inputClass = "w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"

  return (
    <div className="space-y-5 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Configurações</h1>

      {sucesso && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <Check size={15} className="text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700 font-medium">{sucesso}</p>
        </div>
      )}

      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { val: 'perfil',            label: 'Perfil',            icon: User },
          { val: 'culturas',          label: 'Culturas',          icon: Sprout },
          { val: 'compartilhamentos', label: 'Compartilhamentos', icon: Share2 },
        ].map(({ val, label, icon: Icon }) => (
          <button key={val} onClick={() => setAbaSelecionada(val)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              abaSelecionada === val
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Perfil ── */}
      {abaSelecionada === 'perfil' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 mb-4">Dados pessoais</h2>
          <form onSubmit={salvarPerfil} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input value={perfil.nome}
                  onChange={e => setPerfil(p => ({ ...p, nome: e.target.value }))}
                  className={inputClass} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
                <input value={perfil.sobrenome}
                  onChange={e => setPerfil(p => ({ ...p, sobrenome: e.target.value }))}
                  className={inputClass} required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input
                value={perfil.telefone}
                onChange={e => setPerfil(p => ({ ...p, telefone: mascaraTelefone(e.target.value) }))}
                placeholder="(00) 00000-0000"
                maxLength={16}
                className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Função</label>
              <select value={perfil.funcao}
                onChange={e => setPerfil(p => ({ ...p, funcao: e.target.value }))}
                className={inputClass}>
                <option value="">Selecione...</option>
                {FUNCOES.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input value={usuario.email} disabled
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
              <p className="text-xs text-gray-400 mt-1">O e-mail não pode ser alterado.</p>
            </div>
            <button type="submit" disabled={loading}
              className="w-full text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
              style={{ background: 'var(--brand-gradient)' }}>
              {loading ? 'Salvando...' : 'Salvar perfil'}
            </button>
          </form>
        </div>
      )}

      {/* ── Culturas ── */}
      {abaSelecionada === 'culturas' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-700">Culturas favoritas</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Estas culturas aparecerão nas opções ao cadastrar uma safra.
            </p>
          </div>

          {/* Input com autocomplete */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                value={novaCultura}
                onChange={e => onChangeCultura(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), adicionarCultura())}
                onBlur={() => setTimeout(() => setDropdownCulturaAberto(false), 150)}
                placeholder="Nome da cultura..."
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                autoComplete="off"
              />
              {dropdownCulturaAberto && sugestoesFiltradas.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
                  {sugestoesFiltradas.map(s => (
                    <button key={s} type="button"
                      onMouseDown={() => selecionarSugestao(s)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-green-50 transition-colors border-b border-gray-50 last:border-0">
                      {iconeCultura(s)}
                      <span className="text-gray-700">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={adicionarCultura}
              className="flex items-center gap-1.5 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm flex-shrink-0"
              style={{ background: 'var(--brand-gradient)' }}>
              <Plus size={15} /> Adicionar
            </button>
          </div>

          {/* Lista de culturas */}
          <div className="space-y-1.5">
            {culturas.map(c => (
              <div key={c}
                className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
                <div className="flex items-center gap-2">
                  {iconeCultura(c)}
                  <span className="text-sm text-gray-700">{c}</span>
                </div>
                <button
                  onClick={() => setConfirmacaoExcluirCultura(c)}
                  className="text-gray-300 hover:text-red-500 p-1 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {culturas.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                Nenhuma cultura cadastrada. Adicione acima.
              </p>
            )}
          </div>

          <button onClick={salvarCulturas} disabled={loading}
            className="w-full text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
            style={{ background: 'var(--brand-gradient)' }}>
            {loading ? 'Salvando...' : 'Salvar culturas'}
          </button>
        </div>
      )}

      {/* ── Compartilhamentos ── */}
      {abaSelecionada === 'compartilhamentos' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h2 className="font-semibold text-gray-700">Acessos que concedi</h2>
            <p className="text-xs text-gray-400">Propriedades que você compartilhou com outros usuários.</p>
            {convitesConcedidos.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Você não compartilhou nenhuma propriedade ainda.</p>
            ) : (
              <div className="space-y-2">
                {convitesConcedidos.map(c => (
                  <div key={c.id}
                    className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{c.propriedadeNome}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{c.emailConvidado}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === 'aceito' ? 'bg-green-100 text-green-700'
                          : c.status === 'recusado' ? 'bg-red-100 text-red-500'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {c.status === 'aceito' ? 'Aceito' : c.status === 'recusado' ? 'Recusado' : 'Pendente'}
                        </span>
                        {c.permissoes?.length > 0 && (
                          <span className="text-xs text-gray-400">{c.permissoes.join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setModalPermissoes({
                          conviteId: c.id,
                          propriedadeNome: c.propriedadeNome,
                          emailConvidado: c.emailConvidado,
                          permissoes: [...(c.permissoes || [])]
                        })}
                        className="text-gray-300 hover:text-blue-500 p-1 transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmacaoRevogar({ id: c.id, email: c.emailConvidado, prop: c.propriedadeNome })}
                        className="text-gray-300 hover:text-red-500 p-1 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h2 className="font-semibold text-gray-700">Acessos que recebi</h2>
            <p className="text-xs text-gray-400">Propriedades que outros usuários compartilharam com você.</p>
            {convitesRecebidos.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Você não recebeu nenhum compartilhamento.</p>
            ) : (
              <div className="space-y-2">
                {convitesRecebidos.map(c => (
                  <div key={c.id}
                    className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{c.propriedadeNome}</p>
                      <p className="text-xs text-gray-500 mt-0.5">De: {c.proprietarioNome}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === 'aceito' ? 'bg-green-100 text-green-700'
                          : c.status === 'recusado' ? 'bg-red-100 text-red-500'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {c.status === 'aceito' ? 'Aceito' : c.status === 'recusado' ? 'Recusado' : 'Pendente'}
                        </span>
                        {c.permissoes?.length > 0 && (
                          <span className="text-xs text-gray-400">Acesso: {c.permissoes.join(', ')}</span>
                        )}
                      </div>
                    </div>
                    {c.status === 'aceito' && (
                      <button
                        onClick={() => setConfirmacaoRevogar({
                          id: c.id, email: c.proprietarioNome,
                          prop: c.propriedadeNome, sair: true
                        })}
                        className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                        Sair
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal editar permissões */}
      {modalPermissoes && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-800">Editar permissões</h3>
              <button onClick={() => setModalPermissoes(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div>
              <p className="text-sm text-gray-600">{modalPermissoes.propriedadeNome}</p>
              <p className="text-xs text-gray-400">{modalPermissoes.emailConvidado}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ABAS_PERMISSAO.map(aba => {
                const ativo = modalPermissoes.permissoes.includes(aba.key)
                return (
                  <label key={aba.key}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-colors ${
                      ativo ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <input type="checkbox" checked={ativo}
                      onChange={() => setModalPermissoes(m => ({
                        ...m,
                        permissoes: ativo
                          ? m.permissoes.filter(p => p !== aba.key)
                          : [...m.permissoes, aba.key]
                      }))}
                      className="accent-green-600 w-4 h-4" />
                    <span className={`text-sm font-medium ${ativo ? 'text-green-700' : 'text-gray-600'}`}>
                      {aba.label}
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setModalPermissoes(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={salvarPermissoes} disabled={loading}
                className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
                style={{ background: 'var(--brand-gradient)' }}>
                {loading ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmação excluir cultura */}
      {confirmacaoExcluirCultura && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
              <h3 className="font-bold text-gray-800">Remover cultura?</h3>
            </div>
            <p className="text-sm text-gray-600">
              Deseja remover <span className="font-semibold">"{confirmacaoExcluirCultura}"</span> da lista?
            </p>
            <p className="text-xs text-gray-400">Safras já cadastradas com esta cultura não serão afetadas.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacaoExcluirCultura(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => removerCultura(confirmacaoExcluirCultura)}
                className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmação revogar/sair */}
      {confirmacaoRevogar && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
              <h3 className="font-bold text-gray-800">
                {confirmacaoRevogar.sair ? 'Sair do compartilhamento?' : 'Revogar acesso?'}
              </h3>
            </div>
            <p className="text-sm text-gray-600">
              {confirmacaoRevogar.sair
                ? `Você perderá o acesso à propriedade "${confirmacaoRevogar.prop}".`
                : `Remover acesso de ${confirmacaoRevogar.email} à propriedade "${confirmacaoRevogar.prop}"?`
              }
            </p>
            <p className="text-xs text-red-500">Esta ação não poderá ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacaoRevogar(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (confirmacaoRevogar.sair) sairCompartilhamento(confirmacaoRevogar.id)
                  else revogarAcesso(confirmacaoRevogar.id)
                  setConfirmacaoRevogar(null)
                }}
                className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">
                {confirmacaoRevogar.sair ? 'Sair' : 'Revogar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}