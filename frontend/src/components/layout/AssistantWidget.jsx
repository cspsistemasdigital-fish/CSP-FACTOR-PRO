import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

/** Normalize accents, case and punctuation so speech and typing match equally. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Specific intents come first: "relatório de empréstimos" must not be captured
// by the generic "relatório" rule.
const COMMANDS = [
  {
    keys: ['relatorio de emprestimo', 'relatorio dos emprestimos', 'relatorio emprestimos', 'rel emprestimos', 'relatorio de emprestimos'],
    to: '/emprestimos/relatorio',
    label: 'Relatório de Empréstimos',
  },
  { keys: ['relatorio geral', 'relatorios', 'relatorio', 'rel'], to: '/relatorios', label: 'Relatório Geral' },
  { keys: ['dashboard', 'painel', 'visao geral', 'inicio', 'principal'], to: '/dashboard', label: 'Dashboard' },
  { keys: ['agenda', 'compromissos', 'calendario', 'calendar'], to: '/agenda', label: 'Agenda' },
  { keys: ['clientes', 'cliente', 'sacado', 'emitente'], to: '/clientes', label: 'Clientes' },
  { keys: ['cheques', 'cheque'], to: '/cheques', label: 'Cheques' },
  { keys: ['boletos', 'boleto'], to: '/boletos', label: 'Boletos' },
  { keys: ['operacoes', 'operacao', 'bordero'], to: '/operacoes', label: 'Operações' },
  { keys: ['recebimentos', 'recebimento', 'receber', 'baixa'], to: '/recebimentos', label: 'Recebimentos' },
  { keys: ['emprestimos', 'emprestimo', 'emprestimo'], to: '/emprestimos', label: 'Empréstimos' },
  { keys: ['configuracoes', 'configuracao', 'config', 'ajustes', 'preferencias', 'perfil'], to: '/configuracoes', label: 'Configurações' },
  { keys: ['administracao', 'administracao', 'admin', 'usuarios', 'auditoria'], to: '/administracao', label: 'Administração', adminOnly: true },
]

const SUGGESTIONS = ['Cheques', 'Boletos', 'Clientes', 'Relatórios']

let messageId = 0
function makeMessage(role, text, extra = {}) {
  messageId += 1
  return { id: messageId, role, text, ...extra }
}

export default function AssistantWidget() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [messages, setMessages] = useState([
    makeMessage(
      'assistant',
      'Olá! Sou o atendente virtual. Diga ou escreva o nome de uma página do menu — por exemplo “Cheques”, “Boletos” ou “Relatórios” — e eu a abro para você.',
    ),
  ])
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const logRef = useRef(null)

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setVoiceAvailable(Boolean(Recognition))
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, open])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const answer = useCallback(
    (spoken, fromVoice = false) => {
      const text = String(spoken || '').trim()
      if (!text) return
      const normalized = normalize(text)
      setMessages((current) => [...current, makeMessage('user', text)])

      const help = ['ajuda', 'socorro', 'o que voce faz', 'menu', 'opcoes', 'comandos']
      if (help.some((key) => normalized.includes(key))) {
        setMessages((current) => [
          ...current,
          makeMessage(
            'assistant',
            'Posso abrir: Dashboard, Agenda, Clientes, Empréstimos, Cheques, Boletos, Operações, Recebimentos, Relatório de Empréstimos, Relatório Geral, Configurações e Administração. É só falar ou digitar o nome.',
          ),
        ])
        return
      }

      const target = COMMANDS.find(
        (command) =>
          (!command.adminOnly || isAdmin) &&
          command.keys.some((key) => normalized.includes(key)),
      )

      if (target) {
        setMessages((current) => [
          ...current,
          makeMessage('assistant', `Abrindo ${target.label} para você.`, { to: target.to }),
        ])
        navigate(target.to)
        return
      }

      setMessages((current) => [
        ...current,
        makeMessage(
          'assistant',
          fromVoice
            ? 'Não entendi o comando. Tente dizer apenas o nome da página, como “Cheques” ou “Boletos”.'
            : 'Não encontrei essa página. Digite um dos nomes do menu lateral, como “Clientes”, “Empréstimos” ou “Configurações”.',
        ),
      ])
    },
    [isAdmin, navigate],
  )

  const submit = (event) => {
    event.preventDefault()
    answer(input)
    setInput('')
  }

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      setMessages((current) => [
        ...current,
        makeMessage('assistant', 'O comando por voz não está disponível neste navegador. Use o Chrome ou o Edge, ou digite o nome da página.'),
      ])
      return
    }
    try {
      const recognition = new Recognition()
      recognition.lang = 'pt-BR'
      recognition.interimResults = false
      recognition.maxAlternatives = 1
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript || ''
        answer(transcript, true)
      }
      recognition.onerror = (event) => {
        setListening(false)
        setMessages((current) => [
          ...current,
          makeMessage(
            'assistant',
            event.error === 'not-allowed'
              ? 'Permissão do microfone negada. Libere o uso do microfone nas configurações do navegador para falar comigo.'
              : 'Não consegui ouvir agora. Tente novamente ou digite o comando.',
          ),
        ])
      }
      recognition.onend = () => setListening(false)
      recognitionRef.current = recognition
      setListening(true)
      recognition.start()
    } catch {
      setListening(false)
      setMessages((current) => [
        ...current,
        makeMessage('assistant', 'Não foi possível iniciar o microfone. Você pode digitar o nome da página normalmente.'),
      ])
    }
  }

  return (
    <div className={`assistant-widget ${open ? 'open' : ''}`}>
      {open && (
        <section className="assistant-panel" aria-label="Atendente virtual">
          <header className="assistant-header">
            <span className="assistant-avatar"><i className="bi bi-robot" /></span>
            <div>
              <strong>Atendente virtual</strong>
              <small>{listening ? 'Ouvindo…' : 'Fale ou digite o nome de uma página'}</small>
            </div>
            <button
              type="button"
              className="btn-close"
              onClick={() => setOpen(false)}
              aria-label="Fechar atendente virtual"
            />
          </header>

          <div className="assistant-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversa">
            {messages.map((message) => (
              <div key={message.id} className={`assistant-message ${message.role}`}>
                <span>{message.text}</span>
                {message.to && (
                  <button type="button" className="assistant-link" onClick={() => navigate(message.to)}>
                    Abrir página <i className="bi bi-arrow-right" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="assistant-suggestions">
            {SUGGESTIONS.map((item) => (
              <button type="button" key={item} onClick={() => answer(item)}>
                {item}
              </button>
            ))}
          </div>

          <form className="assistant-input" onSubmit={submit}>
            <button
              type="button"
              className={`assistant-mic ${listening ? 'listening' : ''}`}
              onClick={toggleVoice}
              disabled={!voiceAvailable}
              aria-label={listening ? 'Parar de ouvir' : 'Falar com o atendente'}
              title={voiceAvailable ? (listening ? 'Parar de ouvir' : 'Falar por voz') : 'Voz indisponível neste navegador'}
            >
              <i className={`bi ${listening ? 'bi-mic-fill' : 'bi-mic'}`} />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={voiceAvailable ? 'Digite ou fale…' : 'Digite o nome da página…'}
              aria-label="Mensagem para o atendente virtual"
              maxLength={120}
            />
            <button type="submit" className="btn btn-primary" disabled={!input.trim()} aria-label="Enviar mensagem">
              <i className="bi bi-send-fill" />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="assistant-fab"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Fechar atendente virtual' : 'Abrir atendente virtual'}
        title="Atendente virtual"
      >
        <i className={`bi ${open ? 'bi-x-lg' : listening ? 'bi-mic-fill' : 'bi-robot'}`} />
      </button>
    </div>
  )
}
