// src/App.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'

const TABS = [
  { id: 'questions', label: 'Questions', type: 'question' },
  { id: 'diseases', label: 'Diseases', type: 'disease' },
  { id: 'red_flags', label: 'Red flags', type: 'red_flag' },
  { id: 'evidence', label: 'Sources', type: 'evidence' },
]
const STATUS_LABEL = { approved: 'Approved', not_approved: 'Not approved', pending: 'Pending' }
const FILTERS = [['all', 'All'], ['pending', 'To review'], ['approved', 'Approved'], ['not_approved', 'Not approved']]

// fields a doctor may edit per tab (names match the row fields the API returns)
const EDIT_FIELDS = {
  questions: [{ field: 'text', label: 'Question text', multi: true }],
  red_flags: [{ field: 'condition', label: 'Red flag condition', multi: true }, { field: 'action', label: 'Action' }],
  diseases: [{ field: 'name', label: 'Disease name' }, { field: 'description', label: 'Description', multi: true }, { field: 'icd10', label: 'ICD-10' }],
  evidence: [{ field: 'title', label: 'Title' }, { field: 'citation', label: 'Citation', multi: true }, { field: 'url', label: 'URL' }],
}

const sumProgress = (p) => {
  if (!p) return { total: 0, approved: 0, not_approved: 0, done: 0 }
  return Object.values(p).reduce((a, c) => ({
    total: a.total + c.total, approved: a.approved + c.approved, not_approved: a.not_approved + c.not_approved,
    done: a.done + c.approved + c.not_approved,
  }), { total: 0, approved: 0, not_approved: 0, done: 0 })
}
const splitDraft = (s) => {
  const m = /^\s*\[LLM DRAFT\]\s*/i.exec(s || '')
  return m ? { draft: true, text: s.slice(m[0].length) } : { draft: false, text: s || '' }
}
const pretty = (s) => { const t = (s || '').replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }
const ACTIONS = { CONTINUE: 'Continue', NONE: '—', RED_FLAG: 'Red flag', URGENT: 'Urgent', EMERGENCY: 'Emergency', GOTO_PATHWAY: 'Go to pathway', SET_FLAG: 'Set flag', NOTE: 'Note', END: 'End' }
const act = (v) => (v ? ACTIONS[String(v).toUpperCase()] || pretty(v) : '—')
const count = (rows) => rows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), { approved: 0, not_approved: 0, pending: 0 })

function Split({ c, total, slim }) {
  if (!total) return <span className={'split' + (slim ? ' slim' : '')} />
  return (
    <span className={'split' + (slim ? ' slim' : '')} aria-hidden="true">
      <i className="a" style={{ width: `${(c.approved / total) * 100}%` }} />
      <i className="r" style={{ width: `${(c.not_approved / total) * 100}%` }} />
    </span>
  )
}

export default function App() {
  const [modules, setModules] = useState([])
  const [slug, setSlug] = useState(null)
  const [q, setQ] = useState('')
  const [suggOpen, setSuggOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [symptoms, setSymptoms] = useState([])
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useState('questions')
  const [filter, setFilter] = useState('all')
  const [safetyOnly, setSafetyOnly] = useState(false)
  const [focus, setFocus] = useState(null)
  const [editing, setEditing] = useState(null)
 const reviewer = 'Doctor'
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState({ list: false, detail: false })
  const [logOpen, setLogOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const detailReq = useRef(0)
  const toastTimer = useRef(null)
  const searchRef = useRef(null)

  const say = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 6000 : 1800)
  }, [])


  const loadModules = useCallback(async () => {
    try {
      const r = await api.getModules()
      setModules(r.modules)
      setSlug((s) => s || (r.modules[0] && r.modules[0].slug))
    } catch (e) { say(`Could not load modules. ${e.message}`, 'err') }
  }, [say])
  useEffect(() => { loadModules() }, [loadModules])

  // whole symptom list of the module, searched on the client like the reference explorer
  useEffect(() => {
    if (!slug) return
    let live = true
    setLoading((l) => ({ ...l, list: true }))
    api.getSymptoms(slug, '')
      .then((r) => { if (live) setSymptoms(r.symptoms) })
      .catch((e) => { if (live) say(`Could not load symptoms. ${e.message}`, 'err') })
      .finally(() => { if (live) setLoading((l) => ({ ...l, list: false })) })
    return () => { live = false }
  }, [slug, say])

  const openSymptom = useCallback(async (s) => {
    setSel({ kind: s.kind, code: s.code })
    setQ(s.name)
    setSuggOpen(false)
    const id = ++detailReq.current
    setLoading((l) => ({ ...l, detail: true }))
    try {
      const d = await api.getDetail(slug, s.kind, s.code)
      if (id !== detailReq.current) return
      setDetail(d)
      setFilter('all')
      setFocus(null)
      setEditing(null)
      setSafetyOnly(false)
      setTab((cur) => (d[cur] && d[cur].length ? cur : (TABS.find((t) => d[t.id] && d[t.id].length) || TABS[0]).id))
    } catch (e) { say(`Could not load ${s.name}. ${e.message}`, 'err') }
    if (id === detailReq.current) setLoading((l) => ({ ...l, detail: false }))
  }, [slug, say])

  const pickModule = (s) => { setSlug(s); setSel(null); setDetail(null); setQ(''); setSymptoms([]) }

  const progressTimer = useRef(null)
  const scheduleProgress = useCallback(() => {
    clearTimeout(progressTimer.current)
    progressTimer.current = setTimeout(loadModules, 900)
  }, [loadModules])

  const patchLocal = (listKey, keys, status, note = '') =>
    setDetail((d) => d && ({ ...d, [listKey]: d[listKey].map((r) => (keys.has(r.key) ? { ...r, status, note: status === 'not_approved' ? note : '' } : r)) }))

  const decide = useCallback(async (listKey, type, keys, status, note = '') => {
    if (!reviewer.trim()) { say('Enter your name in "Reviewing as" before reviewing.', 'err'); return false }
    const keySet = new Set(keys)
    const before = {}
    detail[listKey].forEach((r) => { if (keySet.has(r.key)) before[r.key] = r.status })
    const revert = (only) => setDetail((d) => d && ({ ...d, [listKey]: d[listKey].map((x) => ((only ? only.has(x.key) : keySet.has(x.key)) ? { ...x, status: before[x.key] } : x)) }))
    patchLocal(listKey, keySet, status, note)
    try {
      if (keys.length === 1) {
        await api.review({ module: slug, entity_type: type, key: keys[0], status, reviewer: reviewer.trim(), note })
      } else {
        const r = await api.reviewBulk({ module: slug, status, reviewer: reviewer.trim(), note, items: keys.map((key) => ({ entity_type: type, key })) })
        const failed = new Set(r.results.filter((x) => !x.ok).map((x) => x.key))
        if (failed.size) {
          revert(failed)
          say(`${failed.size} of ${keys.length} failed and were left unchanged.`, 'err')
          scheduleProgress()
          return false
        }
      }
      say(keys.length === 1 ? STATUS_LABEL[status] : `${keys.length} items ${STATUS_LABEL[status].toLowerCase()}`)
      scheduleProgress()
      return true
    } catch (e) {
      revert()
      say(`Not saved. ${e.message}`, 'err')
      return false
    }
  }, [reviewer, detail, slug, say, scheduleProgress])

  const saveEdit = useCallback(async (listKey, type, key, fields) => {
    if (!reviewer.trim()) { say('Enter your name in "Reviewing as" before editing.', 'err'); return false }
    try {
      const r = await api.editItem({ module: slug, entity_type: type, key, fields, reviewer: reviewer.trim() })
      setDetail((d) => d && ({ ...d, [listKey]: d[listKey].map((x) => (x.key === key ? { ...x, ...fields, ...((r && r.item) || {}), status: 'pending', edited: true } : x)) }))
      setEditing(null)
      say('Saved. Approve it when you are happy with it.')
      scheduleProgress()
      return true
    } catch (e) {
      say(`Not saved. ${e.message}`, 'err')
      return false
    }
  }, [reviewer, slug, say, scheduleProgress])

  const mod = modules.find((m) => m.slug === slug)
  const modTotals = sumProgress(mod && mod.progress)
  const tabDef = TABS.find((t) => t.id === tab)
  const rows = detail ? detail[tab] || [] : []
  const shown = useMemo(
    () => rows.filter((r) => (filter === 'all' || r.status === filter) && (!(safetyOnly && tab === 'questions') || r.safety)),
    [rows, filter, safetyOnly, tab],
  )
  const toApprove = shown.filter((r) => r.status !== 'approved')

  const bulkApprove = async () => {
    if (!toApprove.length) return
    if (!window.confirm(`Approve ${toApprove.length} ${tabDef.label.toLowerCase()} shown for "${detail.name}"?`)) return
    await decide(tab, tabDef.type, toApprove.map((r) => r.key), 'approved')
  }

  // suggestions (reference-style combobox)
  const suggestions = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return symptoms
      .filter((s) => s.name.toLowerCase().includes(t) || s.code.toLowerCase().replace(/_/g, ' ').includes(t))
      .sort((a, b) => (a.kind === b.kind ? b.diseases - a.diseases : a.kind === 'complaint' ? -1 : 1))
      .slice(0, 12)
  }, [q, symptoms])
  const chips = useMemo(
    () => [...symptoms].sort((a, b) => (a.kind === b.kind ? b.diseases - a.diseases : a.kind === 'complaint' ? -1 : 1)).slice(0, 8),
    [symptoms],
  )

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSuggOpen(true); setHi((i) => Math.min(suggestions.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { const s = suggestions[hi] || suggestions[0]; if (s) openSymptom(s) }
    else if (e.key === 'Escape') { setSuggOpen(false); e.target.blur() }
  }

  // keyboard review: J/K move, A approve, N not approve, E edit, U back to pending, / search
  const itemsRef = useRef({})
  const moveFocus = useCallback((dir) => {
    if (!shown.length) return
    const i = shown.findIndex((r) => r.key === focus)
    const next = shown[Math.min(shown.length - 1, Math.max(0, i < 0 ? (dir > 0 ? 0 : shown.length - 1) : i + dir))]
    setFocus(next.key)
    const el = itemsRef.current[next.key]
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [shown, focus])

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') { setLogOpen(false); setEditing(null); return }
      if (e.key === '/') { e.preventDefault(); searchRef.current && searchRef.current.focus(); return }
      if (!detail || logOpen) return
      const k = e.key.toLowerCase()
      if (k === 'j' || k === 'arrowdown') { e.preventDefault(); moveFocus(1) }
      else if (k === 'k' || k === 'arrowup') { e.preventDefault(); moveFocus(-1) }
      else if (k === 'e' && focus) {
        const row = (detail[tab] || []).find((r) => r.key === focus)
        if (row && row.status === 'not_approved') { e.preventDefault(); setEditing(focus) }
      }
      else if (['a', 'n', 'u'].includes(k) && focus) {
        const st = k === 'a' ? 'approved' : k === 'n' ? 'not_approved' : 'pending'
        decide(tab, tabDef.type, [focus], st).then((ok) => { if (ok && st === 'approved' && filter === 'all') moveFocus(1) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, logOpen, focus, tab, tabDef, filter, decide, moveFocus])

  const all = detail ? TABS.flatMap((t) => detail[t.id] || []) : []
  const allCount = count(all)
  const kindLabel = detail ? (detail.kind === 'complaint' ? 'complaint' : 'symptom') : ''

  return (
    <div className="wrap">
      <header>
        <h1>Symptom Question Review</h1>
        <p className="sub">Pick a symptom or complaint, read the questions, possible diseases, red flags and sources stored for it, and approve or reject each one.</p>
      </header>
      <div className="draftbar">Review copy. Items stay AI-drafted and not clinician-approved until you approve them. Each decision is saved to the data files straight away.</div>

      <div className="top">
        <label className="fld"><span>Module</span>
          <select value={slug || ''} onChange={(e) => pickModule(e.target.value)} disabled={!modules.length}>
            {modules.map((m) => { const p = sumProgress(m.progress); return <option key={m.slug} value={m.slug}>{m.name} · {p.done}/{p.total} reviewed</option> })}
          </select>
        </label>
        
        <button className="ghost" onClick={() => setLogOpen(true)} disabled={!slug}>History</button>
        <button className="ghost" onClick={() => setFilesOpen(true)} disabled={!slug}>Data files</button>
      </div>
      {mod && (
        <div className="modprog"><span>{modTotals.done} of {modTotals.total} items reviewed in this module</span><Split c={modTotals} total={modTotals.total} slim /></div>
      )}

      <div className="search">
        <input ref={searchRef} type="search" autoComplete="off" value={q} role="combobox" aria-expanded={suggOpen} aria-controls="sugg"
          placeholder="Search a symptom or complaint, e.g. headache, chest pain, vertigo   ( press / )"
          aria-label="Search symptom or complaint"
          onChange={(e) => { setQ(e.target.value); setSuggOpen(true); setHi(0) }}
          onFocus={() => setSuggOpen(true)} onBlur={() => setTimeout(() => setSuggOpen(false), 120)} onKeyDown={onSearchKey} />
        {suggOpen && q.trim() && (
          <ul className="sugg" id="sugg" role="listbox">
            {suggestions.length ? suggestions.map((s, i) => (
              <li key={s.kind + s.code} role="option" aria-selected={i === hi}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); openSymptom(s) }}>
                <span>{s.name}</span><span className="k">{s.kind} · {s.diseases} disease{s.diseases === 1 ? '' : 's'}</span>
              </li>
            )) : <li className="none">No match</li>}
          </ul>
        )}
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((s) => (
            <button key={s.kind + s.code} className="chip" aria-pressed={!!sel && sel.kind === s.kind && sel.code === s.code} onClick={() => openSymptom(s)}>{s.name}</button>
          ))}
        </div>
      )}
      {loading.list && !symptoms.length && <p className="note">Loading symptoms…</p>}

      {!detail && !loading.detail && <div className="empty">Search above or pick a symptom to start reviewing.</div>}
      {loading.detail && !detail && <div className="empty">Loading…</div>}

      {detail && (
        <div className={'out' + (loading.detail ? ' busy' : '')} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="summary">
            <span className="term">{detail.name}</span><span className="s">{kindLabel}</span>
            <span className="s"><b>{(detail.diseases || []).length}</b> diseases</span>
            <span className="s"><b>{(detail.questions || []).length}</b> questions</span>
            <span className="s"><b>{(detail.questions || []).filter((r) => r.safety).length}</b> safety questions</span>
            <span className="s"><b>{(detail.red_flags || []).length}</b> red flags</span>
            <span className="s"><b>{allCount.approved + allCount.not_approved}</b> of {all.length} reviewed</span>
          </div>
          <Split c={allCount} total={all.length} />
          {detail.notice && <div className="notice">{detail.notice}</div>}

          <div className="tabs" role="tablist">
            {TABS.map((t) => {
              const list = detail[t.id] || []
              const c = count(list)
              return (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab"
                  onClick={() => { setTab(t.id); setFilter('all'); setFocus(null); setEditing(null) }}>
                  <span>{t.label} ({list.length})</span>
                  <span className="tc">{list.length - c.pending}/{list.length}</span>
                  <Split c={c} total={list.length} slim />
                </button>
              )
            })}
          </div>

          <div className="tools">
            <span className="chips" role="group" aria-label="Filter by status">
              {FILTERS.map(([v, l]) => (
                <button key={v} className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>
                  {l}{v !== 'all' && <em>{rows.filter((r) => r.status === v).length}</em>}
                </button>
              ))}
            </span>
            {tab === 'questions' && (
              <label><input type="checkbox" checked={safetyOnly} onChange={(e) => setSafetyOnly(e.target.checked)} /> Safety questions only</label>
            )}
            <span className="grow" />
            <button className="bulk" onClick={bulkApprove} disabled={!toApprove.length}>Approve all shown ({toApprove.length})</button>
          </div>
          <p className="note">
            {tab === 'questions' && rows.some((r) => r.used_by && r.used_by.length > 1) && 'A question approved here is approved in every disease that uses it. '}
            {tab === 'red_flags' && 'Red flags are approved one disease at a time. '}
            Keys: <kbd>J</kbd> <kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>N</kbd> not approve · <kbd>E</kbd> edit (after not approve) · <kbd>U</kbd> back to pending · <kbd>/</kbd> search
          </p>

          {!shown.length && <div className="empty">{rows.length ? 'Nothing matches these filters.' : `No ${tabDef.label.toLowerCase()} linked to this ${detail.kind}.`}</div>}
          <ol className="qs">
            {shown.map((r, i) => (
              <Item key={r.key} row={r} index={i + 1} tab={tab} focused={focus === r.key}
                editing={editing === r.key}
                onEdit={() => { setFocus(r.key); setEditing(r.key) }}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={(fields) => saveEdit(tab, tabDef.type, r.key, fields)}
                refFn={(el) => { itemsRef.current[r.key] = el }}
                onFocus={() => setFocus(r.key)}
                onDecide={(status, note) => decide(tab, tabDef.type, [r.key], status, note)} />
            ))}
          </ol>
        </div>
      )}

      {toast && <div className={'toast ' + toast.kind} role="status">{toast.msg}</div>}
      {logOpen && <LogPanel slug={slug} onClose={() => setLogOpen(false)} />}
      {filesOpen && <FilesPanel slug={slug} onClose={() => setFilesOpen(false)} />}
    </div>
  )
}

function Item({ row, index, tab, focused, editing, onEdit, onCancelEdit, onSaveEdit, refFn, onFocus, onDecide }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async (status) => {
    setBusy(true)
    const ok = await onDecide(status, '')
    setBusy(false)
    if (ok && status === 'not_approved') setNoteOpen(true)
    if (status !== 'not_approved') { setNoteOpen(false); setNote('') }
  }
  const saveNote = async () => {
    setBusy(true)
    const ok = await onDecide('not_approved', note.trim())
    setBusy(false)
    if (ok) setNoteOpen(false)
  }

  return (
    <li ref={refFn} onClick={onFocus} className={'q st-' + row.status + (focused ? ' focused' : '') + (row.safety ? ' safety' : '')}>
      <span className="n">{index}</span>
      <div>
        {tab === 'questions' && <QuestionBody r={row} />}
        {tab === 'red_flags' && <RedFlagBody r={row} />}
        {tab === 'diseases' && <DiseaseBody r={row} />}
        {tab === 'evidence' && <EvidenceBody r={row} />}
        {editing && <EditForm row={row} tab={tab} onSave={onSaveEdit} onCancel={onCancelEdit} />}
        <div className="act">
          <span className={'badge ' + (row.status === 'approved' ? 'b-ok' : row.status === 'not_approved' ? 'b-rf' : 'b-draft')}>{STATUS_LABEL[row.status]}</span>
          {row.edited && <span className="badge b-neutral">Edited</span>}
          <span className="sp" />
          {row.status === 'not_approved' && !editing && (
            <button className="d ed" disabled={busy} onClick={(e) => { e.stopPropagation(); onEdit() }}>Edit</button>
          )}
          <button className={'d ok' + (row.status === 'approved' ? ' on' : '')} disabled={busy || editing} aria-pressed={row.status === 'approved'} onClick={(e) => { e.stopPropagation(); go('approved') }}>Approve</button>
          <button className={'d no' + (row.status === 'not_approved' ? ' on' : '')} disabled={busy || editing} aria-pressed={row.status === 'not_approved'} onClick={(e) => { e.stopPropagation(); go('not_approved') }}>Not approve</button>
          {row.status !== 'pending' && <button className="undo" disabled={busy || editing} onClick={(e) => { e.stopPropagation(); go('pending') }}>Back to pending</button>}
        </div>
        {row.status === 'not_approved' && row.note && !noteOpen && (
          <p className="note">Reason: {row.note}</p>
        )}
        {noteOpen && row.status === 'not_approved' && !editing && (
          <div className="noterow">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not approved? (optional)"
              onKeyDown={(e) => e.key === 'Enter' && saveNote()} aria-label="Reason" autoFocus />
            <button className="ghost" onClick={saveNote} disabled={busy}>Save reason</button>
          </div>
        )}
      </div>
    </li>
  )
}

function EditForm({ row, tab, onSave, onCancel }) {
  const fields = EDIT_FIELDS[tab] || []
  const clean = (f, v) => (f === 'text' || f === 'condition' ? splitDraft(v).text : v ?? '')
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.field, clean(f.field, row[f.field])])), []) // eslint-disable-line
  const [vals, setVals] = useState(initial)
  const [busy, setBusy] = useState(false)
  const changed = fields.filter((f) => String(vals[f.field]).trim() !== String(initial[f.field]).trim())

  const submit = async () => {
    if (!changed.length || busy) return
    setBusy(true)
    const out = {}
    changed.forEach((f) => { out[f.field] = String(vals[f.field]).trim() })
    const ok = await onSave(out)
    if (!ok) setBusy(false)
  }
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
    if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
  }

  return (
    <div className="editform" onClick={(e) => e.stopPropagation()}>
      {row.used_by && row.used_by.length > 1 && tab === 'questions' && (
        <p className="note">This question is shared by {row.used_by.length} diseases. The edit applies to all of them.</p>
      )}
      {fields.map((f, i) => (
        <label key={f.field} className="ef">
          <span>{f.label}</span>
          {f.multi
            ? <textarea rows={3} value={vals[f.field]} autoFocus={i === 0} onKeyDown={onKey} onChange={(e) => setVals((v) => ({ ...v, [f.field]: e.target.value }))} />
            : <input value={vals[f.field]} autoFocus={i === 0} onKeyDown={onKey} onChange={(e) => setVals((v) => ({ ...v, [f.field]: e.target.value }))} />}
        </label>
      ))}
      <div className="efact">
        <button className="bulk" onClick={submit} disabled={!changed.length || busy}>Save changes</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <span className="note">Ctrl+Enter saves · Esc cancels · after saving the item goes back to pending, then approve it</span>
      </div>
    </div>
  )
}

function QuestionBody({ r }) {
  const t = splitDraft(r.text)
  const opts = (r.options || []).map((o) => (typeof o === 'string' ? o : o.text || o.label || o.code || JSON.stringify(o)))
  return (
    <>
      <div className="t">{t.text || <em>(no text)</em>}</div>
      <div className="meta">
        {t.draft && <span className="badge b-draft">AI draft</span>}
        {r.safety && <span className="badge b-rf">Safety</span>}
        {(r.if_yes || r.if_no) && <><span>Yes → {act(r.if_yes)}</span><span>No → {act(r.if_no)}</span></>}
        {r.answer_type && <span>{pretty(r.answer_type)}{opts.length ? ': ' + opts.join(', ') : ''}</span>}
        {(r.yes_weight != null || r.no_weight != null) && <span>Weight {r.yes_weight ?? '–'} / {r.no_weight ?? '–'}</span>}
        {r.purpose && <span>{pretty(r.purpose)}</span>}
        {r.seq != null && <span>Order {r.seq}</span>}
      </div>
      {r.origin === 'disease' && r.used_by && r.used_by.length > 0 && (
        <details className="used"><summary>Used by {r.used_by.length} disease{r.used_by.length > 1 ? 's' : ''}</summary><div>{r.used_by.join(' · ')}</div></details>
      )}
      <p className="code">{r.key}{r.origin === 'complaint_set' ? ' · complaint question set' : ''}</p>
    </>
  )
}

function RedFlagBody({ r }) {
  const t = splitDraft(r.condition)
  return (
    <>
      <div className="t">{pretty(r.rf_name)}</div>
      {t.text && <p className="desc">{t.text}</p>}
      <div className="meta">
        <span className="badge b-rf">Red flag</span>
        {t.draft && <span className="badge b-draft">AI draft</span>}
        {r.action && <span>Action: {act(r.action)}</span>}
        {r.trigger && <span>Trigger: {pretty(r.trigger)}</span>}
        <span>Disease: {r.disease_name}</span>
      </div>
      <p className="code">{r.key}</p>
    </>
  )
}

function DiseaseBody({ r }) {
  return (
    <>
      <div className="t">{r.name}</div>
      {r.description && <p className="desc">{r.description}</p>}
      <div className="meta">
        {r.icd10 && <span className="badge b-neutral">ICD-10 {r.icd10}</span>}
        {r.relationship && <span>{pretty(r.relationship)}</span>}
        {r.frequency && <span>Frequency: {pretty(r.frequency)}</span>}
        <span>{r.questions} question{r.questions === 1 ? '' : 's'}</span>
      </div>
      <p className="code">{r.key}</p>
    </>
  )
}

function EvidenceBody({ r }) {
  return (
    <>
      <div className="t"><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url}</a></div>
      {r.citation && <p className="desc">{r.citation}</p>}
      <div className="meta">
        {r.source_name && <span className="badge b-draft">{r.source_name}</span>}
        <span>For: {r.disease_name}</span>
      </div>
      <p className="code">{r.key}</p>
    </>
  )
}

function LogPanel({ slug, onClose }) {
  const [events, setEvents] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.getLog(slug).then((r) => setEvents(r.events)).catch((e) => setErr(e.message)) }, [slug])
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Review history">
        <div className="sh"><h2>Review history</h2><button className="ghost" onClick={onClose}>Close</button></div>
        {err && <p className="notice">{err}</p>}
        {!events && !err && <p className="note">Loading…</p>}
        {events && !events.length && <p className="note">No decisions yet in this module.</p>}
        <ul className="log">
          {(events || []).map((e, i) => (
            <li key={i}>
              <span className={'badge ' + (e.new === 'approved' ? 'b-ok' : e.new === 'not_approved' ? 'b-rf' : 'b-draft')}>{STATUS_LABEL[e.new] || e.new}</span> <b>{e.entity_type.replace('_', ' ')}</b>
              <p className="code">{e.key}</p>
              <p className="note">{e.reviewer} · {new Date(e.at).toLocaleString()}{e.note ? ` · ${e.note}` : ''}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function FilesPanel({ slug, onClose }) {
  const [list, setList] = useState(null)
  const [view, setView] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.getFiles(slug).then(setList).catch((e) => setErr(e.message)) }, [slug])
  const open = (kind, path) => {
    setView({ kind, path, loading: true })
    api.getFileView(slug, kind, path).then((r) => setView(r)).catch((e) => { setView(null); setErr(e.message) })
  }
  const section = (kind, title) => (
    <>
      <h3>{title}</h3>
      <ul className="log">
        {((list && list[kind]) || []).map((f) => (
          <li key={kind + f.path}>
            <a href="#" onClick={(e) => { e.preventDefault(); open(kind, f.path) }}>{f.path}</a>
            <p className="note">{(f.size / 1024).toFixed(1)} KB · {new Date(f.modified).toLocaleString()} · <a href={api.fileDownloadUrl(slug, kind, f.path)}>download</a></p>
          </li>
        ))}
      </ul>
    </>
  )
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Data files">
        <div className="sh"><h2>Data files</h2><button className="ghost" onClick={onClose}>Close</button></div>
        {err && <p className="notice">{err}</p>}
        {!list && !err && <p className="note">Loading…</p>}
        {list && (
          <p className="note">
            Download all: <a href={api.moduleDownloadUrl(slug, 'json')}>JSON</a> · <a href={api.moduleDownloadUrl(slug, 'csv')}>CSV</a> · <a href={api.moduleDownloadUrl(slug, 'all')}>Both (zip)</a>
          </p>
        )}
        {view ? (
          <>
            <button className="ghost" onClick={() => setView(null)}>← Back to files</button>
            <p className="code">{view.path}</p>
            {view.loading && <p className="note">Loading…</p>}
            {view.kind === 'json' && view.text != null && <pre className="filebox">{view.text}</pre>}
            {view.kind === 'csv' && view.rows && (
              <div className="filebox">
                <table>
                  <thead><tr>{view.fields.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{view.rows.map((r, i) => <tr key={i}>{view.fields.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
                </table>
                {view.total > view.rows.length && <p className="note">Showing first {view.rows.length} of {view.total} rows.</p>}
              </div>
            )}
          </>
        ) : (
          list && <>{section('json', 'JSON (data)')}{section('csv', 'CSV (database seed)')}</>
        )}
      </aside>
    </div>
  )
}