import { useCallback, useEffect, useMemo, useState } from 'react'
import { agendaApi } from '../api'
import { apiError } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const MONTHS = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const COLORS = [
  { value: 'green', label: 'Verde' },
  { value: 'blue', label: 'Azul' },
  { value: 'amber', label: 'Âmbar' },
  { value: 'rose', label: 'Rosa' },
  { value: 'violet', label: 'Violeta' },
]
const EMPTY_FORM = { title: '', start_at: '', end_at: '', location: '', description: '', color: 'green' }

function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromDateKey(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function localDateTime(date, hour, minute = '00') {
  return `${localDateKey(date)}T${String(hour).padStart(2, '0')}:${minute}`
}

function dateTimeInput(value) {
  return value ? value.slice(0, 16) : ''
}

function dateRange(date, mode) {
  if (mode === 'day') return [new Date(date.getFullYear(), date.getMonth(), date.getDate())]
  if (mode === 'week') {
    const first = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay())
    return Array.from({ length: 7 }, (_, index) => addDays(first, index))
  }
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const first = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - firstOfMonth.getDay())
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

function addDays(date, count) {
  const result = new Date(date)
  result.setDate(result.getDate() + count)
  return result
}

function moveDate(date, mode, direction) {
  if (mode === 'day') return addDays(date, direction)
  if (mode === 'week') return addDays(date, direction * 7)
  return new Date(date.getFullYear(), date.getMonth() + direction, 1)
}

function eventOccursOn(event, date) {
  const day = localDateKey(date)
  return event.start_at.slice(0, 10) <= day && event.end_at.slice(0, 10) >= day
}

function eventFormFor(date, event) {
  if (event) {
    return {
      title: event.title,
      start_at: dateTimeInput(event.start_at),
      end_at: dateTimeInput(event.end_at),
      location: event.location || '',
      description: event.description || '',
      color: event.color || 'green',
    }
  }
  const start = localDateTime(date, 9)
  const endDate = new Date(date)
  endDate.setHours(10, 0, 0, 0)
  return { ...EMPTY_FORM, start_at: start, end_at: localDateTime(endDate, 10) }
}

export default function Agenda() {
  const { canWrite, isAdmin } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState('month')
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalEvent, setModalEvent] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const visibleDates = useMemo(() => dateRange(selectedDate, mode), [selectedDate, mode])
  const firstDate = visibleDates[0]
  const lastDate = visibleDates[visibleDates.length - 1]
  const displayTitle = mode === 'month'
    ? MONTHS.format(selectedDate)
    : mode === 'day'
      ? FULL_DATE.format(selectedDate)
      : `${SHORT_DATE.format(firstDate)} – ${FULL_DATE.format(lastDate)}`

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const start = localDateKey(firstDate)
      const end = localDateKey(addDays(lastDate, 1))
      const response = await agendaApi.list({ start, end })
      setEvents(response.data.items || [])
    } catch (requestError) {
      const parsed = apiError(requestError)
      setError(parsed.message)
      toast.error('Falha ao carregar a Agenda', parsed.message)
    } finally {
      setLoading(false)
    }
  }, [firstDate, lastDate, toast])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  const selectedEvents = useMemo(
    () => events
      .filter((event) => eventOccursOn(event, selectedDate))
      .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [events, selectedDate],
  )

  const openNewEvent = (date = selectedDate) => {
    setSelectedDate(date)
    setForm(eventFormFor(date))
    setFormErrors({})
    setModalEvent({})
  }

  const openExistingEvent = (event) => {
    setForm(eventFormFor(selectedDate, event))
    setFormErrors({})
    setModalEvent(event)
  }

  const closeModal = () => {
    setModalEvent(null)
    setFormErrors({})
  }

  const updateForm = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setFormErrors((current) => ({ ...current, [field]: undefined }))
  }

  const saveEvent = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (!form.title.trim()) nextErrors.title = 'Informe o título do compromisso.'
    if (!form.start_at) nextErrors.start_at = 'Informe a data e o horário de início.'
    if (!form.end_at) nextErrors.end_at = 'Informe a data e o horário de término.'
    if (form.start_at && form.end_at && form.end_at <= form.start_at) {
      nextErrors.end_at = 'O término deve ser posterior ao início.'
    }
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        location: form.location.trim(),
        description: form.description.trim(),
      }
      if (modalEvent.id) {
        await agendaApi.update(modalEvent.id, payload)
        toast.success('Compromisso atualizado')
      } else {
        await agendaApi.create(payload)
        toast.success('Compromisso adicionado à Agenda')
      }
      closeModal()
      await loadEvents()
    } catch (requestError) {
      const parsed = apiError(requestError)
      setFormErrors(parsed.errors || {})
      toast.error('Não foi possível salvar o compromisso', parsed.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteEvent = async () => {
    if (!modalEvent?.id || !window.confirm('Deseja excluir este compromisso da Agenda?')) return
    try {
      await agendaApi.remove(modalEvent.id)
      closeModal()
      toast.success('Compromisso excluído')
      await loadEvents()
    } catch (requestError) {
      const parsed = apiError(requestError)
      toast.error('Não foi possível excluir o compromisso', parsed.message)
    }
  }

  const goToToday = () => setSelectedDate(new Date())
  const navigatePeriod = (direction) => setSelectedDate((current) => moveDate(current, mode, direction))
  return (
    <div className="page agenda-page">
      <PageHeader
        title="Agenda"
        subtitle="Compromissos compartilhados com toda a equipe."
        icon="bi-calendar2-week-fill"
      >
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => openNewEvent()}>
            <i className="bi bi-plus-lg" /> Novo compromisso
          </button>
        )}
      </PageHeader>

      <section className="agenda-toolbar" aria-label="Controles da Agenda">
        <div className="agenda-period-controls">
          <button type="button" className="agenda-icon-button" onClick={() => navigatePeriod(-1)} aria-label="Período anterior">
            <i className="bi bi-chevron-left" />
          </button>
          <button type="button" className="agenda-icon-button" onClick={() => navigatePeriod(1)} aria-label="Próximo período">
            <i className="bi bi-chevron-right" />
          </button>
          <button type="button" className="agenda-today-button" onClick={goToToday}>Hoje</button>
          <h3>{displayTitle}</h3>
        </div>
        <div className="agenda-view-switch" role="group" aria-label="Visualização da Agenda">
          {[
            ['month', 'Mês'],
            ['week', 'Semana'],
            ['day', 'Dia'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={mode === value ? 'active' : ''}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="agenda-summary" aria-label="Resumo da Agenda">
        <div><span className="agenda-summary-icon"><i className="bi bi-calendar-event" /></span><p><strong>{events.length}</strong><small>no período exibido</small></p></div>
        <div><span className="agenda-summary-icon"><i className="bi bi-sun" /></span><p><strong>{selectedEvents.length}</strong><small>no dia selecionado</small></p></div>
        <span className="agenda-shared-label"><i className="bi bi-people-fill" /> Agenda compartilhada</span>
      </section>

      {error && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {error}
          <button type="button" className="btn btn-sm btn-outline-danger ms-2" onClick={loadEvents}>Tentar novamente</button>
        </div>
      )}

      <section className={`agenda-calendar agenda-calendar-${mode}`} aria-label={`Agenda: ${displayTitle}`}>
        {mode !== 'day' && (
          <div className="agenda-weekdays" aria-hidden="true">
            {(mode === 'week' ? visibleDates : WEEKDAYS).map((day, index) => (
              <span key={mode === 'week' ? day.toISOString() : WEEKDAYS[index]}>
                {mode === 'week' ? WEEKDAYS[day.getDay()] : day}
              </span>
            ))}
          </div>
        )}
        <div className="agenda-grid" style={{ '--agenda-columns': visibleDates.length }}>
          {visibleDates.map((date) => {
            const dateEvents = events
              .filter((event) => eventOccursOn(event, date))
              .sort((a, b) => a.start_at.localeCompare(b.start_at))
            const dayKey = localDateKey(date)
            const isToday = dayKey === localDateKey(new Date())
            const outsideMonth = mode === 'month' && date.getMonth() !== selectedDate.getMonth()
            return (
              <div
                key={dayKey}
                className={`agenda-day ${mode === 'month' ? 'month-cell' : 'range-cell'} ${isToday ? 'is-today' : ''} ${outsideMonth ? 'outside-month' : ''} ${dayKey === localDateKey(selectedDate) ? 'is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="agenda-day-number"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedDate(date)
                    if (mode === 'month') setMode('day')
                  }}
                  aria-label={`Selecionar ${FULL_DATE.format(date)}`}
                >
                  {mode === 'week' && <span>{WEEKDAYS[date.getDay()]}</span>}
                  <strong>{date.getDate()}</strong>
                </button>
                {canWrite && mode !== 'month' && dateEvents.length === 0 && (
                  <button
                    type="button"
                    className="agenda-empty-slot"
                    onClick={(event) => {
                      event.stopPropagation()
                      openNewEvent(date)
                    }}
                  >
                    <i className="bi bi-plus" /> Adicionar compromisso
                  </button>
                )}
                <div className="agenda-event-list">
                  {(mode === 'month' ? dateEvents.slice(0, 3) : dateEvents).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`agenda-event agenda-event-${item.color}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedDate(date)
                        openExistingEvent(item)
                      }}
                      title={`${item.title} · ${item.start_at.slice(11, 16)}`}
                    >
                      {mode !== 'month' && <time>{item.start_at.slice(11, 16)}</time>}
                      <span>{item.title}</span>
                    </button>
                  ))}
                  {mode === 'month' && dateEvents.length > 3 && (
                    <button type="button" className="agenda-more-events" onClick={() => { setSelectedDate(date); setMode('day') }}>
                      + {dateEvents.length - 3} compromisso(s)
                    </button>
                  )}
                  {mode === 'month' && canWrite && (
                    <button
                      type="button"
                      className="agenda-add-day"
                      aria-label={`Adicionar compromisso em ${FULL_DATE.format(date)}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        openNewEvent(date)
                      }}
                    >
                      <i className="bi bi-plus" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {loading && <div className="agenda-loading"><span className="spinner-border spinner-border-sm" /> Atualizando compromissos…</div>}
      </section>

      <section className="agenda-day-summary">
        <div className="agenda-day-summary-heading">
          <div><span className="home-section-kicker">DIA SELECIONADO</span><h3>{FULL_DATE.format(selectedDate)}</h3></div>
          {canWrite && (
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openNewEvent(selectedDate)}>
              <i className="bi bi-plus-lg" /> Adicionar
            </button>
          )}
        </div>
        {selectedEvents.length ? (
          <div className="agenda-upcoming-list">
            {selectedEvents.map((event) => (
              <button type="button" className={`agenda-upcoming-item agenda-event-${event.color}`} key={event.id} onClick={() => openExistingEvent(event)}>
                <span className="agenda-upcoming-time">{event.start_at.slice(11, 16)}<small>{event.end_at.slice(11, 16)}</small></span>
                <span className="agenda-upcoming-copy"><strong>{event.title}</strong><small>{event.location || event.description || 'Compromisso da equipe'}</small></span>
                <i className="bi bi-chevron-right" />
              </button>
            ))}
          </div>
        ) : (
          <div className="agenda-empty-day">
            <span><i className="bi bi-calendar2-check" /></span>
            <div><strong>Nenhum compromisso neste dia</strong><small>Use a Agenda compartilhada para manter a equipe alinhada.</small></div>
            {canWrite && <button type="button" className="btn btn-light btn-sm" onClick={() => openNewEvent(selectedDate)}>Criar compromisso</button>}
          </div>
        )}
      </section>

      {modalEvent !== null && (
        <div className="agenda-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeModal()
        }}>
          <section className="agenda-modal" role="dialog" aria-modal="true" aria-labelledby="agenda-modal-title">
            <header className="agenda-modal-head">
              <div>
                <span className="home-section-kicker">{modalEvent.id ? 'COMPROMISSO' : 'NOVO EVENTO'}</span>
                <h2 id="agenda-modal-title">{modalEvent.id ? (canWrite ? 'Editar compromisso' : 'Detalhes do compromisso') : 'Novo compromisso'}</h2>
              </div>
              <button type="button" className="agenda-icon-button" aria-label="Fechar" onClick={closeModal}><i className="bi bi-x-lg" /></button>
            </header>
            <form onSubmit={saveEvent} noValidate>
              <label className="agenda-field agenda-field-full">
                <span>Título <b>*</b></span>
                <input autoFocus maxLength={160} value={form.title} onChange={updateForm('title')} disabled={!canWrite} placeholder="Ex.: Reunião com cliente" />
                {formErrors.title && <small className="agenda-field-error">{formErrors.title}</small>}
              </label>
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span>Início <b>*</b></span>
                  <input type="datetime-local" value={form.start_at} onChange={updateForm('start_at')} disabled={!canWrite} />
                  {formErrors.start_at && <small className="agenda-field-error">{formErrors.start_at}</small>}
                </label>
                <label className="agenda-field">
                  <span>Término <b>*</b></span>
                  <input type="datetime-local" value={form.end_at} onChange={updateForm('end_at')} disabled={!canWrite} />
                  {formErrors.end_at && <small className="agenda-field-error">{formErrors.end_at}</small>}
                </label>
              </div>
              <div className="agenda-form-row">
                <label className="agenda-field">
                  <span>Local</span>
                  <input maxLength={180} value={form.location} onChange={updateForm('location')} disabled={!canWrite} placeholder="Endereço ou sala" />
                  {formErrors.location && <small className="agenda-field-error">{formErrors.location}</small>}
                </label>
                <label className="agenda-field">
                  <span>Cor</span>
                  <select value={form.color} onChange={updateForm('color')} disabled={!canWrite}>
                    {COLORS.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="agenda-field agenda-field-full">
                <span>Descrição</span>
                <textarea rows={3} maxLength={4000} value={form.description} onChange={updateForm('description')} disabled={!canWrite} placeholder="Observações sobre o compromisso" />
                {formErrors.description && <small className="agenda-field-error">{formErrors.description}</small>}
              </label>
              {!canWrite && modalEvent.created_by && (
                <p className="agenda-created-by"><i className="bi bi-person-circle" /> Criado por {modalEvent.created_by}</p>
              )}
              <footer className="agenda-modal-actions">
                {isAdmin && modalEvent.id && (
                  <button type="button" className="btn btn-outline-danger me-auto" onClick={deleteEvent}>
                    <i className="bi bi-trash3" /> Excluir
                  </button>
                )}
                <button type="button" className="btn btn-light" onClick={closeModal}>{canWrite ? 'Cancelar' : 'Fechar'}</button>
                {canWrite && (
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <><span className="spinner-border spinner-border-sm me-2" />Salvando…</> : 'Salvar compromisso'}
                  </button>
                )}
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
