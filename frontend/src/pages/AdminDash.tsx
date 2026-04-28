import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Users, RefreshCw, Eye, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API = 'http://localhost:5000';
interface Application {
  id: string; timestamp: string; idFront: string; idBack: string; selfie: string;
  status: 'pending'|'approved'|'rejected'; reviewedAt: string|null; reviewNote: string;
  userData: { docType?: string; fields?: Record<string,string>; autoResult?: string; reasons?: string[] };
}
interface Stats { total:number; pending:number; approved:number; rejected:number }

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' });

const Badge = ({ s }: { s: string }) => {
  if (s === 'approved' || s === 'verified')  return <span className="badge badge-green"><CheckCircle size={10}/>Verified</span>;
  if (s === 'rejected' || s === 'failed')    return <span className="badge badge-red"><XCircle size={10}/>Failed</span>;
  return <span className="badge badge-yellow"><Clock size={10}/>Pending</span>;
};

const DOC_LABEL: Record<string,string> = { nid:'NID Card', passport:'Passport', driving:'Driving Licence' };

/* Modal */
const Modal = ({ app, onClose }: { app: Application; onClose: ()=>void }) => {
  const autoResult = app.userData?.autoResult || app.status;
  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <motion.div className="modal-box" initial={{scale:.9,opacity:0}} animate={{scale:1,opacity:1}} style={{maxWidth:680}}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <p style={{ fontSize:'.65rem', color:'var(--muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em' }}>
              {DOC_LABEL[app.userData?.docType||''] || 'Document'} Verification • #{app.id.slice(-8)}
            </p>
            <h2 style={{ fontSize:'1.25rem', fontWeight:800 }}>{fmt(app.timestamp)}</h2>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <Badge s={autoResult} />
            <button className="btn btn-ghost" style={{ padding:'7px', borderRadius:8 }} onClick={onClose}><X size={16}/></button>
          </div>
        </div>

        {/* Images */}
        <div className="preview-grid" style={{ marginBottom:12 }}>
          <div>
            <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', marginBottom:6 }}>Document Front</p>
            <div className="preview-box">
              <img src={`${API}/uploads/${app.idFront}`} alt="front" onError={e=>{(e.target as HTMLImageElement).alt='Not found';}} />
            </div>
          </div>
          <div>
            <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', marginBottom:6 }}>Document Back</p>
            <div className="preview-box">
              <img src={`${API}/uploads/${app.idBack}`} alt="back" onError={e=>{(e.target as HTMLImageElement).alt='Not found';}} />
            </div>
          </div>
        </div>
        <div style={{ marginBottom:20 }}>
          <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', marginBottom:6 }}>Live Selfie</p>
          <div className="preview-box" style={{ aspectRatio:'16/9' }}>
            <img src={`${API}/uploads/${app.selfie}`} alt="selfie" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          </div>
        </div>

        {/* Extracted fields */}
        {app.userData?.fields && Object.keys(app.userData.fields).length > 0 && (
          <div style={{ background:'rgba(0,229,160,0.04)', borderRadius:12, padding:'14px 18px', marginBottom:16, border:'1px solid rgba(0,229,160,0.15)' }}>
            <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--green)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:10 }}>OCR Extracted Data</p>
            {Object.entries(app.userData.fields).map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:'.85rem' }}>
                <span style={{ color:'var(--muted)' }}>{k}</span><span style={{ fontWeight:600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Failure reasons */}
        {app.userData?.reasons && app.userData.reasons.length > 0 && (
          <div style={{ background:'rgba(239,68,68,0.06)', borderRadius:12, padding:'14px 18px', border:'1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--red)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>Failure Reasons</p>
            {app.userData.reasons.map((r,i) => <p key={i} style={{ fontSize:'.85rem', color:'var(--muted)', marginBottom:4 }}>• {r}</p>)}
          </div>
        )}
      </motion.div>
    </div>
  );
};

const AdminDash: React.FC = () => {
  const [stats, setStats]       = useState<Stats>({total:0,pending:0,approved:0,rejected:0});
  const [apps,  setApps]        = useState<Application[]>([]);
  const [filter, setFilter]     = useState('all');
  const [page,   setPage]       = useState(1);
  const [total,  setTotal]      = useState(0);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<Application|null>(null);
  const LIMIT = 10;

  const fetchStats = async () => {
    try { const r = await fetch(`${API}/api/admin/stats`); setStats(await r.json()); } catch {}
  };

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/applications?status=${filter}&page=${page}&limit=${LIMIT}`);
      const j = await r.json();
      setApps(j.applications||[]); setTotal(j.total||0);
    } catch { setApps([]); }
    setLoading(false);
  }, [filter, page]);

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchApps(); }, [fetchApps]);

  const totalPages = Math.ceil(total/LIMIT);
  const statCards = [
    { label:'Total',    val:stats.total,    color:'var(--blue)',   border:'rgba(59,130,246,0.25)'  },
    { label:'Pending',  val:stats.pending,  color:'var(--yellow)', border:'rgba(245,158,11,0.25)'  },
    { label:'Verified', val:stats.approved, color:'var(--green)',  border:'rgba(0,229,160,0.25)'   },
    { label:'Failed',   val:stats.rejected, color:'var(--red)',    border:'rgba(239,68,68,0.25)'   },
  ];

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:'36px 24px' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28 }}>
        <div>
          <h1 style={{ fontSize:'1.8rem', fontWeight:900, letterSpacing:'-.04em' }}>Verification History</h1>
          <p style={{ color:'var(--muted)', marginTop:4, fontSize:'.9rem' }}>All auto-verified submissions — read only</p>
        </div>
        <button className="btn btn-ghost" onClick={() => { fetchStats(); fetchApps(); }} style={{ gap:8 }}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom:24 }}>
        {statCards.map(s => (
          <div key={s.label} className="stat-card" style={{ borderColor:s.border }}>
            <div className="stat-num" style={{ color:s.color }}>{s.val}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        {['all','pending','approved','rejected'].map(f => (
          <button key={f} className="btn" onClick={() => { setFilter(f); setPage(1); }} style={{
            padding:'7px 16px', fontSize:'.8rem', borderRadius:9,
            background: filter===f ? 'rgba(0,229,160,0.12)' : 'rgba(255,255,255,0.04)',
            color: filter===f ? 'var(--green)' : 'var(--muted)',
            border:`1px solid ${filter===f ? 'rgba(0,229,160,0.3)' : 'var(--border)'}`,
          }}>
            {f==='approved'?'Verified':f==='rejected'?'Failed':f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Doc Type</th><th>Submitted</th>
              <th>Auto Result</th><th>Issues</th><th>View</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ textAlign:'center', padding:32 }}>
                <div className="spinner" style={{ width:30, height:30, borderWidth:3, display:'inline-block' }} />
              </td></tr>
            )}
            {!loading && apps.length===0 && (
              <tr><td colSpan={6} style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>
                <Users size={28} style={{ marginBottom:8, opacity:.35, display:'block', margin:'0 auto 8px' }} />
                No records found
              </td></tr>
            )}
            {!loading && apps.map(a => {
              const ar = a.userData?.autoResult || a.status;
              const docLabel = DOC_LABEL[a.userData?.docType||''] || 'Document';
              const issues = a.userData?.reasons?.length || 0;
              return (
                <tr key={a.id}>
                  <td style={{ fontFamily:'monospace', fontSize:'.75rem', color:'var(--muted)' }}>#{a.id.slice(-8)}</td>
                  <td style={{ fontSize:'.85rem', fontWeight:600 }}>{docLabel}</td>
                  <td style={{ fontSize:'.82rem', color:'var(--muted)', whiteSpace:'nowrap' }}>{fmt(a.timestamp)}</td>
                  <td><Badge s={ar}/></td>
                  <td style={{ fontSize:'.82rem', color: issues ? 'var(--red)' : 'var(--muted)' }}>
                    {issues ? `${issues} issue${issues>1?'s':''}` : '—'}
                  </td>
                  <td>
                    <button className="btn btn-ghost" style={{ padding:'6px 12px', fontSize:'.8rem', borderRadius:8, gap:5 }} onClick={() => setSelected(a)}>
                      <Eye size={13}/> View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:12, marginTop:16 }}>
          <button className="btn btn-ghost" style={{ padding:'7px 12px', borderRadius:9 }} disabled={page===1} onClick={() => setPage(p=>p-1)}><ChevronLeft size={15}/></button>
          <span style={{ fontSize:'.85rem', color:'var(--muted)' }}>Page {page} / {totalPages}</span>
          <button className="btn btn-ghost" style={{ padding:'7px 12px', borderRadius:9 }} disabled={page===totalPages} onClick={() => setPage(p=>p+1)}><ChevronRight size={15}/></button>
        </div>
      )}

      <AnimatePresence>
        {selected && <Modal app={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
};

export default AdminDash;
