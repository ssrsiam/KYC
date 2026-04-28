import React, { useState, useRef, useEffect } from 'react';
import * as faceapi from 'face-api.js';
import { createWorker } from 'tesseract.js';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, CheckCircle, AlertCircle, Loader2, RotateCcw, ChevronRight, ScanLine } from 'lucide-react';

type DocType = 'nid' | 'passport' | 'driving';
type Step = 'select' | 'capture-front' | 'capture-back' | 'capture-face' | 'processing' | 'result';

interface DocResult {
  ok: boolean;
  fields: Record<string, string>;
  faceMatch: boolean | null;
  reasons: string[];
}

// ── OCR parsers ──────────────────────────────────────────────────────────────
const parseNID = (text: string) => {
  const fields: Record<string, string> = {};
  const nidMatch = text.match(/\b(\d{10}|\d{13}|\d{17})\b/);
  if (nidMatch) fields['NID Number'] = nidMatch[1];
  const nameMatch = text.match(/Name[:\s]+([A-Za-z ]{3,50})/i);
  if (nameMatch) fields['Name'] = nameMatch[1].trim();
  const dobMatch = text.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/);
  if (dobMatch) fields['Date of Birth'] = dobMatch[1];
  return fields;
};

const parsePassport = (text: string) => {
  const fields: Record<string, string> = {};
  // MRZ line pattern
  const mrzLines = text.match(/[A-Z0-9<]{20,44}/g);
  if (mrzLines && mrzLines.length >= 2) {
    const line1 = mrzLines[mrzLines.length - 2];
    const line2 = mrzLines[mrzLines.length - 1];
    const passNum = line2.substring(0, 9).replace(/</g, '');
    if (passNum) fields['Passport No'] = passNum;
    const dob = line2.substring(13, 19);
    if (dob) fields['DOB (YYMMDD)'] = dob;
    const expiry = line2.substring(19, 25);
    if (expiry) fields['Expiry (YYMMDD)'] = expiry;
    const namePart = line1.substring(5).replace(/</g, ' ').trim();
    if (namePart) fields['Name'] = namePart.replace(/\s+/g, ' ').substring(0, 40);
  }
  if (!fields['Passport No']) {
    const m = text.match(/[A-Z]{1,2}\d{7}/);
    if (m) fields['Passport No'] = m[0];
  }
  return fields;
};

const parseDriving = (text: string) => {
  const fields: Record<string, string> = {};
  const dlMatch = text.match(/(?:DL|No|Lic)[#:\s]*([A-Z0-9\-]{5,20})/i);
  if (dlMatch) fields['License No'] = dlMatch[1];
  const nameMatch = text.match(/Name[:\s]+([A-Za-z ]{3,50})/i);
  if (nameMatch) fields['Name'] = nameMatch[1].trim();
  const dobMatch = text.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
  if (dobMatch) fields['Date of Birth'] = dobMatch[1];
  const expMatch = text.match(/(?:Exp|Expiry)[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  if (expMatch) fields['Expiry'] = expMatch[1];
  return fields;
};

const parseDoc = (docType: DocType, text: string) => {
  if (docType === 'nid')      return parseNID(text);
  if (docType === 'passport') return parsePassport(text);
  return parseDriving(text);
};

const validateDoc = (docType: DocType, fields: Record<string, string>): string[] => {
  const reasons: string[] = [];
  if (docType === 'nid') {
    if (!fields['NID Number']) reasons.push('NID number could not be extracted');
    else if (![10,13,17].includes(fields['NID Number'].length)) reasons.push('NID number format invalid');
  }
  if (docType === 'passport') {
    if (!fields['Passport No']) reasons.push('Passport number not detected');
  }
  if (docType === 'driving') {
    if (!fields['License No']) reasons.push('License number not detected');
  }
  return reasons;
};

const DOC_LABELS: Record<DocType, { name: string; needBack: boolean; icon: string }> = {
  nid:      { name: 'National ID (NID)',    needBack: true,  icon: '🪪' },
  passport: { name: 'Passport',             needBack: false, icon: '📕' },
  driving:  { name: 'Driving Licence',      needBack: false, icon: '🚗' },
};

const anim = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -14 }, transition: { duration: 0.28 } };

const KYCFlow: React.FC = () => {
  const [docType, setDocType]   = useState<DocType>('nid');
  const [step, setStep]         = useState<Step>('select');
  const [modelsReady, setReady] = useState(false);
  const [modelMsg, setModelMsg] = useState('Loading AI models…');
  const [imgFront, setFront]    = useState<string | null>(null);
  const [imgBack,  setBack]     = useState<string | null>(null);
  const [imgFace,  setFace]     = useState<string | null>(null);
  const [result,   setResult]   = useState<DocResult | null>(null);
  const [camErr,   setCamErr]   = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const M = '/models';
        setModelMsg('Loading face detector…');
        await faceapi.nets.tinyFaceDetector.loadFromUri(M);
        setModelMsg('Loading landmark model…');
        await faceapi.nets.faceLandmark68Net.loadFromUri(M);
        setModelMsg('Loading recognition model…');
        await faceapi.nets.faceRecognitionNet.loadFromUri(M);
        setReady(true);
      } catch { setModelMsg('Face model error – continuing without face match'); setReady(true); }
    })();
  }, []);

  const startCam = async (facing: ConstrainDOMString = 'environment') => {
    setCamErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } } });
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setCamErr('Camera access denied. Please enable camera permissions.'); }
  };

  const stopCam = () => {
    (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const shoot = (): string | null => {
    const v = videoRef.current;
    if (!v) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  };

  const captureAndGo = (setter: (s: string) => void, next: Step, facing?: ConstrainDOMString) => {
    const img = shoot(); if (!img) return;
    setter(img); stopCam();
    setStep(next);
    if (facing) setTimeout(() => startCam(facing), 80);
  };

  const runVerification = async () => {
    setStep('processing');
    let ocrText = '';
    try {
      const worker = await createWorker('eng');
      const { data } = await worker.recognize(imgFront!);
      ocrText = data.text;
      if (imgBack) {
        const { data: d2 } = await worker.recognize(imgBack);
        ocrText += ' ' + d2.text;
      }
      await worker.terminate();
    } catch (e) { console.error('OCR error', e); }

    const fields  = parseDoc(docType, ocrText);
    const reasons = validateDoc(docType, fields);

    // Face match
    let faceMatch: boolean | null = null;
    try {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
      const imgA = await faceapi.fetchImage(imgFront!);
      const imgB = await faceapi.fetchImage(imgFace!);
      const dA = await faceapi.detectSingleFace(imgA, opts).withFaceLandmarks(true).withFaceDescriptor();
      const dB = await faceapi.detectSingleFace(imgB, opts).withFaceLandmarks(true).withFaceDescriptor();
      if (dA && dB) faceMatch = faceapi.euclideanDistance(dA.descriptor, dB.descriptor) < 0.6;
      else { faceMatch = false; reasons.push('Face not clearly detected in one of the images'); }
    } catch { faceMatch = null; }

    if (faceMatch === false) reasons.push('Face on document does not match live selfie');

    const ok = reasons.length === 0 && faceMatch !== false;

    // Save to backend
    try {
      const fd = new FormData();
      const b64 = async (s: string) => (await fetch(s)).blob();
      fd.append('idFront', await b64(imgFront!), 'front.jpg');
      if (imgBack) fd.append('idBack', await b64(imgBack), 'back.jpg');
      else fd.append('idBack', await b64(imgFront!), 'back.jpg'); // use front as placeholder
      fd.append('selfie',  await b64(imgFace!),  'selfie.jpg');
      fd.append('userData', JSON.stringify({ docType, fields, autoResult: ok ? 'verified' : 'failed', reasons }));
      await fetch('http://localhost:5000/api/verify', { method: 'POST', body: fd });
    } catch {}

    setResult({ ok, fields, faceMatch, reasons });
    setStep('result');
  };

  const restart = () => { stopCam(); setFront(null); setBack(null); setFace(null); setResult(null); setCamErr(null); setStep('select'); };

  const needBack = DOC_LABELS[docType].needBack;

  const CamView = ({ title, overlay, onCapture, onBack }: { title: string; overlay: 'id'|'face'; onCapture: ()=>void; onBack: ()=>void }) => (
    <motion.div {...anim} key={step} style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>
      <div className="card" style={{ padding: 28 }}>
        <p style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.15em', marginBottom: 6 }}>{title}</p>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 20 }}>
          {overlay === 'id' ? 'Align document in frame' : 'Position your face'}
        </h2>
        <div className="cam-wrap" style={{ marginBottom: 16 }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {overlay === 'id'   && <div className="cam-overlay-id">PLACE DOCUMENT HERE</div>}
          {overlay === 'face' && <div className="cam-overlay-face" />}
          <div className="cam-footer">
            <button className="shutter" onClick={onCapture}><div className="shutter-inner" /></button>
          </div>
        </div>
        {camErr && <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: 'var(--red)', fontSize: '.85rem', marginBottom: 12 }}>{camErr}</div>}
        <button className="btn btn-ghost" style={{ fontSize: '.85rem' }} onClick={onBack}>← Back</button>
      </div>
    </motion.div>
  );

  return (
    <div style={{ minHeight: '100vh', padding: '16px 0' }}>
      <AnimatePresence mode="wait">

        {/* SELECT */}
        {step === 'select' && (
          <motion.div {...anim} key="sel" style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
            <div className="card" style={{ padding: '44px 36px', textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, background: 'var(--green-dim)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <ShieldCheck size={36} color="var(--green)" />
              </div>
              <h1 style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-.04em', marginBottom: 8 }}>Document Verification</h1>
              <p style={{ color: 'var(--muted)', marginBottom: 28, lineHeight: 1.7, fontSize: '.9rem' }}>Select your document type. OCR will automatically extract and validate your data — no manual review required.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                {(Object.entries(DOC_LABELS) as [DocType, typeof DOC_LABELS[DocType]][]).map(([k, v]) => (
                  <button key={k} onClick={() => setDocType(k)} className="btn" style={{
                    padding: '14px 20px', justifyContent: 'flex-start', gap: 14, fontSize: '.95rem',
                    background: docType === k ? 'rgba(0,229,160,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${docType === k ? 'rgba(0,229,160,0.35)' : 'var(--border)'}`,
                    color: docType === k ? 'var(--green)' : 'var(--text)',
                  }}>
                    <span style={{ fontSize: '1.4rem' }}>{v.icon}</span>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 700 }}>{v.name}</div>
                      <div style={{ fontSize: '.75rem', color: 'var(--muted)', fontWeight: 400 }}>{v.needBack ? 'Front + Back required' : 'Single side required'}</div>
                    </div>
                    {docType === k && <CheckCircle size={18} style={{ marginLeft: 'auto' }} />}
                  </button>
                ))}
              </div>

              <button className="btn btn-green btn-full" style={{ fontSize: '1rem', padding: '16px' }}
                disabled={!modelsReady}
                onClick={() => { setStep('capture-front'); setTimeout(() => startCam('environment'), 80); }}>
                {modelsReady ? <><ScanLine size={18} /> Begin Automated Scan <ChevronRight size={18} /></> : <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {modelMsg}</>}
              </button>
            </div>
          </motion.div>
        )}

        {/* CAPTURE FRONT */}
        {step === 'capture-front' && (
          <CamView key="cf" title={`${DOC_LABELS[docType].name} — Front`} overlay="id"
            onCapture={() => captureAndGo(setFront, needBack ? 'capture-back' : 'capture-face', needBack ? 'environment' : 'user')}
            onBack={() => { stopCam(); setStep('select'); }} />
        )}

        {/* CAPTURE BACK (NID only) */}
        {step === 'capture-back' && (
          <CamView key="cb" title={`${DOC_LABELS[docType].name} — Back`} overlay="id"
            onCapture={() => captureAndGo(setBack, 'capture-face', 'user')}
            onBack={() => { stopCam(); setStep('capture-front'); setTimeout(() => startCam('environment'), 80); }} />
        )}

        {/* CAPTURE FACE */}
        {step === 'capture-face' && (
          <CamView key="face" title="Biometric Capture" overlay="face"
            onCapture={() => { const img = shoot(); if (!img) return; setFace(img); stopCam(); runVerification(); }}
            onBack={() => { stopCam(); setStep(needBack ? 'capture-back' : 'capture-front'); setTimeout(() => startCam('environment'), 80); }} />
        )}

        {/* PROCESSING */}
        {step === 'processing' && (
          <motion.div {...anim} key="proc" style={{ maxWidth: 480, margin: '80px auto', padding: '0 16px', textAlign: 'center' }}>
            <div className="card" style={{ padding: '60px 40px' }}>
              <div className="spinner" style={{ marginBottom: 28 }} />
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 10 }}>Auto Verifying…</h2>
              <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>Running OCR extraction → document validation → biometric face match</p>
            </div>
          </motion.div>
        )}

        {/* RESULT */}
        {step === 'result' && result && (
          <motion.div {...anim} key="res" style={{ maxWidth: 600, margin: '40px auto', padding: '0 16px' }}>
            <div className="card" style={{ padding: '40px 32px' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                {result.ok
                  ? <CheckCircle size={64} color="var(--green)" />
                  : <AlertCircle size={64} color="var(--red)" />}
                <h2 style={{ fontSize: '2rem', fontWeight: 900, marginTop: 16 }}>
                  {result.ok ? 'VERIFIED ✓' : 'FAILED ✗'}
                </h2>
                <p style={{ color: 'var(--muted)', marginTop: 6 }}>
                  {result.ok ? 'Document and biometrics verified automatically.' : 'Verification could not be completed.'}
                </p>
              </div>

              {/* Extracted fields */}
              {Object.keys(result.fields).length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: '16px 20px', marginBottom: 16, border: '1px solid var(--border)' }}>
                  <p style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12 }}>Extracted Data</p>
                  {Object.entries(result.fields).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.875rem' }}>
                      <span style={{ color: 'var(--muted)' }}>{k}</span>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Face match status */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: '12px 16px', borderRadius: 12, background: result.faceMatch ? 'rgba(0,229,160,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${result.faceMatch ? 'rgba(0,229,160,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                  <p style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, color: 'var(--muted)' }}>Biometric Match</p>
                  <p style={{ fontWeight: 700, color: result.faceMatch ? 'var(--green)' : 'var(--red)' }}>
                    {result.faceMatch === null ? 'Skipped' : result.faceMatch ? 'Confirmed ✓' : 'Failed ✗'}
                  </p>
                </div>
                <div style={{ flex: 1, padding: '12px 16px', borderRadius: 12, background: result.ok ? 'rgba(0,229,160,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${result.ok ? 'rgba(0,229,160,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                  <p style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, color: 'var(--muted)' }}>Overall Status</p>
                  <p style={{ fontWeight: 700, color: result.ok ? 'var(--green)' : 'var(--red)' }}>{result.ok ? 'Verified ✓' : 'Not Verified ✗'}</p>
                </div>
              </div>

              {/* Failure reasons */}
              {result.reasons.length > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
                  <p style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Issues Found</p>
                  {result.reasons.map((r, i) => <p key={i} style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: 4 }}>• {r}</p>)}
                </div>
              )}

              <button className="btn btn-ghost btn-full" onClick={restart}><RotateCcw size={15} /> Verify Again</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default KYCFlow;
