// src/DataPage.jsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './api.js'

const STATUS = { approved: 'Approved', not_approved: 'Not approved', pending: 'Pending' }
// event.files holds paths like data/<slug>/diseases/x.json or seed_data/<SEED>/x.csv
const toOpen = (slug, f) => {
  if (f.startsWith(`data/${slug}/`) && f.endsWith('.json')) return { kind: 'json', path: f.slice(`data/${slug}/`.length) }
  if (f.endsWith('.csv')) return { kind: 'csv', path: f.split('/').pop() }
  return null
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export default function DataPage() {
  const [modules, setModules] = useState([])
  const [slug, setSlug] = useState('')
  const [kind, setKind] = useState('json')
  const [files, setFiles] = useState(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(null)
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [events, setEvents] = useState(null)
  const [allEvents, setAllEvents] = useState(false)

  useEffect(() => {
    api.getModules()
      .then((r) => { setModules(r.modules); setSlug((s) => s || (r.modules[0] && r.modules[0].slug) || '') })
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!slug) return
    let live = true
    setFiles(null); setOpen(null); setContent(null); setErr('')
    api.getFiles(slug)
      .then((r) => { if (live) setFiles(r) })
      .catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [slug])

  const loadEvents = useCallback(() => {
    if (!slug) return
    api.getLog(slug).then((r) => setEvents(r.events)).catch((e) => setErr(e.message))
  }, [slug])
  useEffect(() => { setEvents(null); setAllEvents(false); loadEvents() }, [loadEvents])

  const openFromLog = (t) => {
    setKind(t.kind)
    setOpen(t)
    const g = document.querySelector('.dbgrid')
    if (g) g.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true); setContent(null); setErr('')
    api.viewFile(slug, open.kind, open.path)
      .then((r) => { if (live) setContent(r) })
      .catch((e) => { if (live) setErr(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [slug, open])

  const grouped = useMemo(() => {
    const t = filter.trim().toLowerCase()
    const rows = ((files && files[kind]) || []).filter((f) => !t || f.path.toLowerCase().includes(t))
    const g = {}
    rows.forEach((f) => { (g[f.group] = g[f.group] || []).push(f) })
    return { groups: Object.entries(g), total: rows.length }
  }, [files, kind, filter])

  return (
    <div className="wrap">
      <header>
        <h1>Database and downloads</h1>
        <p className="sub">View the stored JSON and CSV files of a module, and download them exactly as they are saved.</p>
      </header>

      <div className="top">
        <label className="fld"><span>Module</span>
          <select value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!modules.length}>
            {modules.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
          </select>
        </label>
        <a className="ghost" href="#/">Back to review</a>
      </div>

      {err && <div className="notice">{err}</div>}

      <div className="tools">
        <span className="chips" role="group" aria-label="File type">
          <button className="chip" aria-pressed={kind === 'json'} onClick={() => { setKind('json'); setOpen(null); setContent(null) }}>
            JSON{files ? ` (${files.json.length})` : ''}
          </button>
          <button className="chip" aria-pressed={kind === 'csv'} onClick={() => { setKind('csv'); setOpen(null); setContent(null) }}>
            CSV{files ? ` (${files.csv.length})` : ''}
          </button>
        </span>
        <span className="grow" />
        <a className="ghost" href={slug ? api.zipUrl(slug, 'json') : '#'}>Download all JSON (zip)</a>
        <a className="ghost" href={slug ? api.zipUrl(slug, 'csv') : '#'}>Download all CSV (zip)</a>
        <a className="ghost" href={slug ? api.zipUrl(slug, 'all') : '#'}>Download both (zip)</a>
      </div>

      <section className="recent">
        <div className="dbhead">
          <h2>Recent changes</h2>
          <span className="grow" />
          <button className="ghost" onClick={loadEvents}>Refresh</button>
        </div>
        {!events && !err && <p className="note">Loading…</p>}
        {events && !events.length && <p className="note">No doctor decisions or edits in this module yet.</p>}
        <ul className="log">
          {(events || []).slice(0, allEvents ? 200 : 8).map((e, i) => (
            <li key={i}>
              <span className={'badge ' + (e.new === 'approved' ? 'b-ok' : e.new === 'not_approved' ? 'b-rf' : 'b-draft')}>{STATUS[e.new] || e.new}</span>{' '}
              <b>{e.entity_type.replace('_', ' ')}</b>
              <p className="code">{e.key}</p>
              <p className="note">{e.reviewer} · {new Date(e.at).toLocaleString()}{e.note ? ` · ${e.note}` : ''}</p>
              <p className="note">
                {(e.files || []).length ? 'Files updated: ' : 'No file needed changes (already in this state).'}
                {(e.files || []).map((f) => {
                  const t = toOpen(slug, f)
                  return t
                    ? <button key={f} className="filelink" onClick={() => openFromLog(t)}>{f.split('/').pop()}</button>
                    : <span key={f} className="filelink">{f.split('/').pop()}</span>
                })}
              </p>
            </li>
          ))}
        </ul>
        {events && events.length > 8 && (
          <button className="ghost" onClick={() => setAllEvents((v) => !v)}>{allEvents ? 'Show less' : `Show all (${events.length})`}</button>
        )}
      </section>

      <div className="dbgrid">
        <div className="dbfiles">
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files…" aria-label="Filter files" />
          {!files && !err && <p className="note">Loading…</p>}
          {files && !grouped.total && <p className="note">No {kind.toUpperCase()} files.</p>}
          {grouped.groups.map(([group, rows]) => (
            <div key={group} className="dbgroup">
              <h3>{group} <em>{rows.length}</em></h3>
              <ul>
                {rows.map((f) => (
                  <li key={f.path}>
                    <button className={'dbfile' + (open && open.path === f.path && open.kind === kind ? ' on' : '')}
                      onClick={() => setOpen({ kind, path: f.path })}>
                      <span>{f.name}</span><span className="k">{fmtSize(f.size)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="dbview">
          {!open && <div className="empty">Pick a file on the left to view it.</div>}
          {open && (
            <>
              <div className="dbhead">
                <span className="code">{open.path}{content ? ` · ${fmtSize(content.size)}` : ''}</span>
                <span className="grow" />
                <a className="bulk" href={api.fileUrl(slug, open.kind, open.path)}>Download this file</a>
              </div>
              {loading && <p className="note">Loading…</p>}
              {content && content.kind === 'json' && (
                <>
                  {content.truncated && <p className="note">Preview is cut at 3 MB. The download has the full file.</p>}
                  <pre className="dbpre">{content.text}</pre>
                </>
              )}
              {content && content.kind === 'csv' && (
                <>
                  <p className="note">
                    {content.total} row{content.total === 1 ? '' : 's'}
                    {content.total > content.rows.length ? `, showing the first ${content.rows.length}. The download has all rows.` : ''}
                  </p>
                  <div className="dbtable">
                    <table>
                      <thead><tr>{content.fields.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>
                        {content.rows.map((r, i) => (
                          <tr key={i}>{content.fields.map((c) => <td key={c}>{r[c]}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}