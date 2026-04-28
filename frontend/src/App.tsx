// Vercel Rebuild Trigger
import { useState, useRef, useEffect } from 'react';
import * as faceapi from 'face-api.js';
import { Image, Zap, CheckCircle, XCircle } from 'lucide-react';

type Tab = 'iddl' | 'biometric';
type RunState = 'idle' | 'running' | 'done' | 'error';

const API = ''; // Use relative path for production/Vercel
const ID_DL_SERVICES = ['MegaPersonals','Grindr','Badoo','Hinge','Match','Bumble','Facebook','Instagram','OnlyFans','Other'];
const BIO_SERVICES   = ['Tinder','Hinge','Bumble','Badoo','Grindr','MegaPersonals','Facebook','Instagram','Other'];
const COUNTRIES      = ['Bangladesh','United States','United Kingdom','India','Pakistan','Canada','Australia','Germany','France','Saudi Arabia','UAE','Singapore','Malaysia','Other'];
const DOC_TYPES      = [{ v:'nid', l:'National ID (NID)' }, { v:'passport', l:'Passport' }, { v:'driving', l:'Driving Licence' }];


interface ResultData { verified?: boolean; fields?: Record<string,string>; faceMatch?: boolean|null; faceConfidence?: number; issues?: string[]; message?: string }

export default function App() {
  // ── Common ──
  const [tab, setTab]             = useState<Tab>('iddl');
  const [token, setToken]         = useState('');
  const [tokenInfo, setTokenInfo] = useState<{ valid:boolean; label?:string; usesLeft?:number }|null>(null);
  const [modelsOk, setModelsOk]   = useState(false);
  const [statusMsg, setStatusMsg] = useState('Loading AI models…');

  // ── ID/DL ──
  const [country, setCountry]     = useState('Bangladesh');
  const [age, setAge]             = useState('');
  const [service, setService]     = useState(ID_DL_SERVICES[0]);
  const [docType, setDocType]     = useState('nid');
  const [imgId, setImgId]         = useState<string|null>(null);
  const [imgSelfie, setImgSelfie] = useState<string|null>(null);

  // ── Biometric ──
  const [bioService, setBioService] = useState(BIO_SERVICES[0]);
  const [imgBio, setImgBio]         = useState<string|null>(null);

  // ── Result / progress ──
  const [runState, setRunState]   = useState<RunState>('idle');
  const [progress, setProgress]   = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [result, setResult]       = useState<ResultData|null>(null);



  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);

  // ── Load models ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const M = '/models';
        setStatusMsg('Loading face detector…');
        await faceapi.nets.tinyFaceDetector.loadFromUri(M);
        setStatusMsg('Loading landmark model…');
        await faceapi.nets.faceLandmark68Net.loadFromUri(M);
        setStatusMsg('Loading recognition model…');
        await faceapi.nets.faceRecognitionNet.loadFromUri(M);
        setModelsOk(true);
        setStatusMsg('Ready — enter API token to begin');
      } catch { setModelsOk(true); setStatusMsg('Models loaded (limited)'); }
    })();
  }, []);

  // ── Token validation ──────────────────────────────────────────────────────
  const validateToken = async () => {
    if (!token.trim()) return;
    try {
      const r = await fetch(`${API}/api/token/validate`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token })
      });
      const j = await r.json();
      setTokenInfo(j.valid ? { valid:true, label:j.label, usesLeft:j.usesLeft } : { valid:false });
      setStatusMsg(j.valid ? `Token valid: ${j.label}` : 'Invalid token');
    } catch { setStatusMsg('Cannot connect to server'); }
  };

  // ── Progress helpers ──────────────────────────────────────────────────────
  const startProgress = (secs: number) => {
    setProgress(0); setRemaining(secs); let e=0;
    timerRef.current = setInterval(() => {
      e++;
      setProgress(Math.min(95, Math.round((e/secs)*100)));
      setRemaining(Math.max(0, secs-e));
      if (e>=secs) clearInterval(timerRef.current!);
    }, 1000);
  };
  const finishProgress = (ok: boolean) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100); setRemaining(0);
    setRunState(ok ? 'done' : 'error');
  };

  const readFile = (f: File): Promise<string> =>
    new Promise(r => { const rd=new FileReader(); rd.onload=e=>r(e.target!.result as string); rd.readAsDataURL(f); });

  // ── Load image element from data URL ─────────────────────────────────────
  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((res, rej) => {
      const img = document.createElement('img') as HTMLImageElement;
      img.onload  = () => res(img);
      img.onerror = () => rej(new Error('Image load failed'));
      img.src = src;
    });

  // ── Face comparison (real, client-side) ───────────────────────────────────
  const compareFaces = async (imgA: string, imgB: string): Promise<{ match:boolean; distance:number }> => {
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize:416, scoreThreshold:0.5 });
    const [iA, iB] = await Promise.all([loadImg(imgA), loadImg(imgB)]);
    const [dA, dB] = await Promise.all([
      faceapi.detectSingleFace(iA, opts).withFaceLandmarks().withFaceDescriptor(),
      faceapi.detectSingleFace(iB, opts).withFaceLandmarks().withFaceDescriptor(),
    ]);
    if (!dA || !dB) return { match:false, distance:1 };
    const distance = faceapi.euclideanDistance(dA.descriptor, dB.descriptor);
    return { match: distance < 0.6, distance };
  };

  // ── ID/DL Run ─────────────────────────────────────────────────────────────
  const runIdDl = async () => {
    if (!tokenInfo?.valid) { setStatusMsg('⚠ Invalid or missing API token'); return; }
    if (!imgId || !imgSelfie) { setStatusMsg('⚠ Upload both ID card and selfie'); return; }
    setRunState('running'); setResult(null); startProgress(25);

    try {
      // Real face comparison
      setStatusMsg('Comparing biometrics…');
      const { match, distance } = await compareFaces(imgId, imgSelfie);

      // Send to backend for OCR + storage
      setStatusMsg('Running OCR extraction…');
      const fd = new FormData();
      const b = async (s:string) => (await fetch(s)).blob();
      fd.append('idFront', await b(imgId), 'front.jpg');
      fd.append('selfie',  await b(imgSelfie), 'selfie.jpg');
      fd.append('docType',    docType);
      fd.append('country',    country);
      fd.append('age',        age);
      fd.append('service',    service);
      fd.append('faceMatch',  String(match));
      fd.append('faceDistance', String(distance));

      const res = await fetch(`${API}/api/verify/iddl`, {
        method: 'POST',
        headers: { 'x-api-token': token },
        body: fd
      });
      const json = await res.json();

      if (!res.ok) {
        setResult({ message: json.message || 'Verification failed' });
        setStatusMsg('Error: ' + (json.message || 'Unknown error'));
        finishProgress(false); return;
      }

      setResult({
        verified: json.verified,
        fields: json.fields,
        faceMatch: json.faceMatch,
        faceConfidence: json.faceConfidence,
        issues: json.issues
      });
      setStatusMsg(json.verified ? '✓ Verification successful' : '✗ Verification failed');
      finishProgress(json.verified);
    } catch (e) {
      console.error(e);
      setResult({ message: 'Connection error — is the backend running?' });
      setStatusMsg('Connection error');
      finishProgress(false);
    }
  };

  // ── Biometric Run ─────────────────────────────────────────────────────────
  const runBiometric = async () => {
    if (!tokenInfo?.valid) { setStatusMsg('⚠ Invalid or missing API token'); return; }
    if (!imgBio) { setStatusMsg('⚠ Upload a photo first'); return; }
    setRunState('running'); setResult(null); startProgress(15);

    try {
      setStatusMsg('Detecting face…');
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize:416, scoreThreshold:0.5 });
      const imgEl = await loadImg(imgBio);
      const det   = await faceapi.detectSingleFace(imgEl, opts);
      const detected = !!det;
      const conf = det ? Math.round(det.score * 100) : 0;

      setStatusMsg('Uploading result…');
      const fd = new FormData();
      fd.append('photo', await (await fetch(imgBio)).blob(), 'photo.jpg');
      fd.append('service',      bioService);
      fd.append('faceDetected', String(detected));
      fd.append('confidence',   String(conf));

      const res = await fetch(`${API}/api/verify/biometric`, {
        method: 'POST',
        headers: { 'x-api-token': token },
        body: fd
      });
      const json = await res.json();

      if (!res.ok) {
        setResult({ message: json.message }); setStatusMsg(json.message || 'Error'); finishProgress(false); return;
      }

      setResult({ verified: json.verified, faceMatch: detected, faceConfidence: conf, issues: json.issues });
      setStatusMsg(json.verified ? '✓ Face verified' : '✗ Face not verified');
      finishProgress(json.verified);
    } catch {
      setResult({ message: 'Connection error' });
      setStatusMsg('Connection error');
      finishProgress(false);
    }
  };

  const handleRun = () => {
    if (runState==='running') return;
    if (tab==='iddl') runIdDl();
    else if (tab==='biometric') runBiometric();
  };

  // ── UI helpers ────────────────────────────────────────────────────────────
  const dotClass = runState==='idle'?'dot-idle':runState==='running'?'dot-running':runState==='done'?'dot-ok':'dot-fail';

  const ImgPanel = ({ label, img, onImg }: { label:string; img:string|null; onImg:(s:string)=>void }) => (
    <div className="img-panel">
      <div className="img-panel-header">
        <span className="img-panel-title">{label}</span>
        <label className="browse-btn" style={{cursor:'pointer'}}>
          Browse
          <input type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{
            const f=e.target.files?.[0]; if(!f) return; onImg(await readFile(f));
          }}/>
        </label>
      </div>
      <label className="img-drop-zone">
        <input type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{
          const f=e.target.files?.[0]; if(!f) return; onImg(await readFile(f));
        }}/>
        {img
          ? <img src={img} alt={label} />
          : <div className="img-placeholder">
              <Image size={48} /><p>Click or drop image</p>
            </div>
        }
        {img && result?.faceMatch !== undefined && label.includes('Selfie') && (
          <div className="img-status-overlay" style={{color:result.faceMatch?'#10b981':'#ef4444'}}>
            {result.faceMatch?<CheckCircle size={14}/>:<XCircle size={14}/>}
            Face: {result.faceConfidence}% match
          </div>
        )}
      </label>
    </div>
  );

  const ResultPanel = () => (
    <div className="result-panel">
      <div className="result-header">Result</div>
      <div className="result-body">
        {/* Loading state */}
        {runState === 'running' && !result && (
          <div style={{textAlign:'center',marginTop:28,display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
            <div style={{width:28,height:28,border:'3px solid rgba(99,102,241,0.2)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spinr 1s linear infinite'}}/>
            <p style={{color:'var(--muted)',fontSize:'11px'}}>{statusMsg}</p>
          </div>
        )}
        {/* Idle state */}
        {runState === 'idle' && !result && (
          <p style={{color:'var(--muted)',fontSize:'11px',textAlign:'center',marginTop:24}}>Enter token &amp; upload image, then click Run</p>
        )}
        {/* Error message */}
        {result?.message && (
          <div style={{color:'var(--red)',fontSize:'12px',background:'rgba(239,68,68,0.08)',padding:'12px',borderRadius:8,border:'1px solid rgba(239,68,68,0.2)',lineHeight:1.6}}>
            ⚠ {result.message}
          </div>
        )}
        {result && !result.message && (

          <>
            <div className="result-field">
              <span className="result-key">Status</span>
              <span className={`result-val ${result.verified?'result-ok':'result-fail'}`} style={{fontSize:'15px',fontWeight:900}}>
                {result.verified ? '✓ VERIFIED' : '✗ FAILED'}
              </span>
            </div>
            {result.faceMatch !== undefined && (
              <div className="result-field">
                <span className="result-key">Face Match</span>
                <span className={`result-val ${result.faceMatch?'result-ok':'result-fail'}`}>
                  {result.faceMatch?'Yes ✓':'No ✗'}{result.faceConfidence?` (${result.faceConfidence}%)`:''}
                </span>
              </div>
            )}
            {result.fields && Object.entries(result.fields).map(([k,v]) => (
              <div className="result-field" key={k}>
                <span className="result-key">{k}</span>
                <span className="result-val">{v}</span>
              </div>
            ))}
            {result.issues && result.issues.length>0 && (
              <div className="result-field">
                <span className="result-key" style={{color:'var(--red)'}}>Issues</span>
                {result.issues.map((i,x)=><span key={x} className="result-val result-fail" style={{fontSize:'11px'}}>• {i}</span>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* Title bar */}
      <div className="title-bar">
        <div className="title-bar-icon">SA</div>
        <span className="title-bar-text">Smart Authentication</span>
        <div className="title-bar-controls">
          <div className="wc wc-red"/><div className="wc wc-yellow"/><div className="wc wc-green"/>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {(['iddl','biometric'] as Tab[]).map(t => (
          <div key={t} className={`tab ${tab===t?'active':''}`}
            onClick={()=>{setTab(t);setResult(null);setRunState('idle');setProgress(0);setRemaining(0);}}>
            {t==='iddl'?'ID/DL Verification':'Biometric Verification'}
          </div>
        ))}
      </div>

      {/* ── ID / DL & Biometric tabs ─────────────────────────────────────── */}
      {(tab==='iddl'||tab==='biometric') && (
        <div className="tab-content">
          {/* Sidebar */}
          <div className="sidebar">
            {/* Token */}
            <div className="form-group">
              <label className="form-label">API Token</label>
              <input className="form-input" type="password" placeholder="SA-XXXX…"
                value={token} onChange={e=>{setToken(e.target.value);setTokenInfo(null);}}
                onBlur={validateToken}
                style={{borderColor: tokenInfo?.valid===false?'var(--red)':tokenInfo?.valid?'var(--green)':'var(--border)'}}
              />
              {tokenInfo?.valid===false && <span style={{fontSize:'10px',color:'var(--red)'}}>Invalid token</span>}
              {tokenInfo?.valid && <span style={{fontSize:'10px',color:'var(--green)'}}>✓ {tokenInfo.label} {tokenInfo.usesLeft!==-1?`(${tokenInfo.usesLeft} uses left)`:''}</span>}
            </div>

            {tab==='iddl' && <>
              <div className="form-group">
                <label className="form-label">Document Type</label>
                <select className="form-select" value={docType} onChange={e=>setDocType(e.target.value)}>
                  {DOC_TYPES.map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Country</label>
                <select className="form-select" value={country} onChange={e=>setCountry(e.target.value)}>
                  {COUNTRIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Age</label>
                <input className="form-input" type="number" placeholder="18" value={age} min={18} max={99} onChange={e=>setAge(e.target.value)}/>
              </div>
              <div className="form-group">
                <label className="form-label">Service</label>
                <select className="form-select" value={service} onChange={e=>setService(e.target.value)}>
                  {ID_DL_SERVICES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </>}

            {tab==='biometric' && (
              <div className="form-group">
                <label className="form-label">Service</label>
                <select className="form-select" value={bioService} onChange={e=>setBioService(e.target.value)}>
                  {BIO_SERVICES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            )}

            <button className="run-btn" onClick={handleRun}
              disabled={runState==='running'||!modelsOk||!tokenInfo?.valid}>
              {runState==='running'
                ? <><span className="spin">◌</span> Running…</>
                : <><Zap size={14}/> Run</>}
            </button>
          </div>

          {/* Image panels + result */}
          <div className="main-area">
            <div className="img-panels">
              {tab==='iddl' && <>
                <ImgPanel label="ID Card"   img={imgId}     onImg={setImgId}     />
                <ImgPanel label="Selfie"    img={imgSelfie} onImg={setImgSelfie} />
              </>}
              {tab==='biometric' && (
                <ImgPanel label="Photo" img={imgBio} onImg={setImgBio} />
              )}
            </div>
            <ResultPanel/>
          </div>
        </div>
      )}



      {/* Status bar */}
      <div className="status-bar">
        <div className={`status-dot ${dotClass}`}/>
        <span style={{fontSize:'11px',color:'var(--muted)',minWidth:200}}>{statusMsg}</span>
        <div className="progress-wrap">
          <div className="progress-fill" style={{width:`${progress}%`}}/>
        </div>
        <span className="progress-pct">{progress}%</span>
        <span className="remaining">Remaining: {remaining}s</span>
      </div>
    </div>
  );
}
