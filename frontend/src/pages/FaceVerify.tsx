import React, { useState, useRef, useEffect } from 'react';
import * as faceapi from 'face-api.js';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Upload, Camera, CheckCircle, AlertCircle, RotateCcw, Loader2, ChevronRight } from 'lucide-react';

type Step = 'upload' | 'live' | 'processing' | 'result';

const anim = { initial:{opacity:0,y:14}, animate:{opacity:1,y:0}, exit:{opacity:0,y:-14}, transition:{duration:.28} };

const FaceVerify: React.FC = () => {
  const [step, setStep]         = useState<Step>('upload');
  const [refImg, setRefImg]     = useState<string|null>(null);
  const [liveImg, setLiveImg]   = useState<string|null>(null);
  const [modelsOk, setModels]   = useState(false);
  const [modelMsg, setModelMsg] = useState('Loading biometric AI…');
  const [result, setResult]     = useState<{ok:boolean; distance:number; msg:string}|null>(null);
  const [camErr, setCamErr]     = useState<string|null>(null);
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
        setModels(true);
      } catch { setModelMsg('Model load error'); setModels(true); }
    })();
  }, []);

  const startCam = async () => {
    setCamErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width:{ideal:1280} } });
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setCamErr('Camera access denied. Please allow camera permissions.'); }
  };

  const stopCam = () => {
    (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const shoot = (): string|null => {
    const v = videoRef.current; if (!v) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v,0,0);
    return c.toDataURL('image/jpeg', 0.92);
  };

  const captureLive = () => {
    const img = shoot(); if (!img) return;
    setLiveImg(img); stopCam();
    runMatch(img);
  };

  const runMatch = async (live: string) => {
    setStep('processing');
    try {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize:416, scoreThreshold:0.5 });
      const imgA = await faceapi.fetchImage(refImg!);
      const imgB = await faceapi.fetchImage(live);
      const dA = await faceapi.detectSingleFace(imgA, opts).withFaceLandmarks(true).withFaceDescriptor();
      const dB = await faceapi.detectSingleFace(imgB, opts).withFaceLandmarks(true).withFaceDescriptor();

      if (!dA) { setResult({ok:false, distance:1, msg:'No face detected in the uploaded reference photo.'}); setStep('result'); return; }
      if (!dB) { setResult({ok:false, distance:1, msg:'No face detected in the live camera capture.'}); setStep('result'); return; }

      const dist = faceapi.euclideanDistance(dA.descriptor, dB.descriptor);
      const ok   = dist < 0.55;
      const confidence = Math.max(0, Math.round((1 - dist) * 100));

      setResult({
        ok,
        distance: dist,
        msg: ok
          ? `Face matched with ${confidence}% confidence.`
          : `Faces do not match (similarity ${confidence}%). Please try again with a clearer photo.`
      });
    } catch (e) {
      console.error(e);
      setResult({ok:false, distance:1, msg:'Biometric engine error. Please retry.'});
    }
    setStep('result');
  };

  const restart = () => { stopCam(); setRefImg(null); setLiveImg(null); setResult(null); setCamErr(null); setStep('upload'); };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setRefImg(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ minHeight:'100vh', padding:'16px 0' }}>
      <AnimatePresence mode="wait">

        {/* UPLOAD REFERENCE PHOTO */}
        {step === 'upload' && (
          <motion.div {...anim} key="upload" style={{ maxWidth:560, margin:'40px auto', padding:'0 16px' }}>
            <div className="card" style={{ padding:'44px 36px', textAlign:'center' }}>
              <div style={{ width:72, height:72, background:'rgba(59,130,246,0.12)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px' }}>
                <ScanFace size={36} color="var(--blue)" />
              </div>
              <h1 style={{ fontSize:'2rem', fontWeight:900, letterSpacing:'-.04em', marginBottom:8 }}>Face Verification</h1>
              <p style={{ color:'var(--muted)', marginBottom:32, lineHeight:1.7, fontSize:'.9rem' }}>
                Upload a reference photo (e.g. profile photo or ID photo), then capture a live selfie.
                The AI will automatically compare and verify your identity.
              </p>

              {/* Upload zone */}
              <label style={{ display:'block', position:'relative', cursor:'pointer' }}>
                <input type="file" accept="image/*" onChange={handleFile} style={{ position:'absolute', inset:0, opacity:0, cursor:'pointer' }} />
                <div style={{
                  border:`2px dashed ${refImg ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius:16, padding:'28px 20px',
                  background: refImg ? 'rgba(0,229,160,0.04)' : 'rgba(255,255,255,0.02)',
                  transition:'all .25s', marginBottom:20
                }}>
                  {refImg ? (
                    <>
                      <img src={refImg} alt="Reference" style={{ width:120, height:120, objectFit:'cover', borderRadius:'50%', border:'3px solid var(--green)', marginBottom:12 }} />
                      <p style={{ color:'var(--green)', fontWeight:700, fontSize:'.9rem' }}>Reference photo loaded ✓</p>
                      <p style={{ color:'var(--muted)', fontSize:'.78rem' }}>Click to change</p>
                    </>
                  ) : (
                    <>
                      <Upload size={40} color="var(--muted)" style={{ marginBottom:12 }} />
                      <p style={{ fontWeight:600, marginBottom:4 }}>Upload Reference Photo</p>
                      <p style={{ color:'var(--muted)', fontSize:'.8rem' }}>JPG, PNG — clear face photo required</p>
                    </>
                  )}
                </div>
              </label>

              <button className="btn btn-green btn-full" style={{ fontSize:'1rem', padding:'16px' }}
                disabled={!refImg || !modelsOk}
                onClick={() => { setStep('live'); setTimeout(startCam, 80); }}>
                {modelsOk
                  ? <><Camera size={18} /> Proceed to Live Scan <ChevronRight size={18} /></>
                  : <><Loader2 size={18} style={{animation:'spin 1s linear infinite'}} /> {modelMsg}</>}
              </button>
            </div>
          </motion.div>
        )}

        {/* LIVE CAMERA */}
        {step === 'live' && (
          <motion.div {...anim} key="live" style={{ maxWidth:680, margin:'0 auto', padding:'24px 16px' }}>
            <div className="card" style={{ padding:28 }}>
              <p style={{ fontSize:'.7rem', fontWeight:700, color:'var(--blue)', textTransform:'uppercase', letterSpacing:'.15em', marginBottom:6 }}>Live Biometric Scan</p>
              <h2 style={{ fontSize:'1.5rem', fontWeight:800, marginBottom:4 }}>Look directly at the camera</h2>
              <p style={{ color:'var(--muted)', fontSize:'.85rem', marginBottom:20 }}>Keep your face centred in the oval guide. Ensure good lighting.</p>

              <div className="cam-wrap" style={{ marginBottom:16 }}>
                <video ref={videoRef} autoPlay muted playsInline style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                <div className="cam-overlay-face" />
                {/* Reference thumbnail overlay */}
                {refImg && (
                  <div style={{ position:'absolute', top:12, right:12, width:60, height:60, borderRadius:'50%', overflow:'hidden', border:'2px solid var(--blue)', boxShadow:'0 4px 12px rgba(0,0,0,0.5)' }}>
                    <img src={refImg} alt="ref" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  </div>
                )}
                <div className="cam-footer">
                  <button className="shutter" onClick={captureLive}><div className="shutter-inner" style={{ background:'var(--blue)' }} /></button>
                </div>
              </div>

              {camErr && (
                <div style={{ padding:'10px 14px', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, color:'var(--red)', fontSize:'.85rem', marginBottom:12 }}>{camErr}</div>
              )}

              <div style={{ display:'flex', gap:12 }}>
                <button className="btn btn-ghost" style={{ fontSize:'.85rem' }} onClick={() => { stopCam(); setStep('upload'); }}>← Back</button>
              </div>
            </div>
          </motion.div>
        )}

        {/* PROCESSING */}
        {step === 'processing' && (
          <motion.div {...anim} key="proc" style={{ maxWidth:480, margin:'80px auto', padding:'0 16px', textAlign:'center' }}>
            <div className="card" style={{ padding:'60px 40px' }}>
              <div className="spinner" style={{ marginBottom:28, borderTopColor:'var(--blue)', borderColor:'rgba(59,130,246,0.15)' }} />
              <h2 style={{ fontSize:'1.5rem', fontWeight:800, marginBottom:10 }}>Matching Biometrics…</h2>
              <p style={{ color:'var(--muted)', fontSize:'.9rem' }}>Comparing 128-point facial landmark vectors</p>
            </div>
          </motion.div>
        )}

        {/* RESULT */}
        {step === 'result' && result && (
          <motion.div {...anim} key="res" style={{ maxWidth:540, margin:'40px auto', padding:'0 16px' }}>
            <div className="card" style={{ padding:'40px 32px', textAlign:'center' }}>
              {result.ok
                ? <CheckCircle size={64} color="var(--green)" />
                : <AlertCircle  size={64} color="var(--red)"  />}
              <h2 style={{ fontSize:'2rem', fontWeight:900, marginTop:16, marginBottom:8 }}>
                {result.ok ? 'Identity Confirmed' : 'Match Failed'}
              </h2>
              <p style={{ color:'var(--muted)', marginBottom:28, lineHeight:1.7 }}>{result.msg}</p>

              {/* Side by side preview */}
              {refImg && liveImg && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:24 }}>
                  <div>
                    <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', marginBottom:6 }}>Reference</p>
                    <div className="preview-box"><img src={refImg} alt="ref" /></div>
                  </div>
                  <div>
                    <p style={{ fontSize:'.65rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', marginBottom:6 }}>Live Capture</p>
                    <div className="preview-box"><img src={liveImg} alt="live" /></div>
                  </div>
                </div>
              )}

              {/* Confidence meter */}
              <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:'14px 18px', marginBottom:24, textAlign:'left' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:'.8rem', color:'var(--muted)', fontWeight:600 }}>Similarity Score</span>
                  <span style={{ fontSize:'.85rem', fontWeight:700, color: result.ok ? 'var(--green)' : 'var(--red)' }}>
                    {Math.max(0, Math.round((1 - result.distance) * 100))}%
                  </span>
                </div>
                <div style={{ height:6, background:'rgba(255,255,255,0.08)', borderRadius:99, overflow:'hidden' }}>
                  <div style={{
                    height:'100%', width:`${Math.max(0, Math.round((1 - result.distance) * 100))}%`,
                    background: result.ok ? 'var(--green)' : 'var(--red)',
                    borderRadius:99, transition:'width .6s ease'
                  }} />
                </div>
                <p style={{ fontSize:'.7rem', color:'var(--muted)', marginTop:6 }}>Threshold: 55% similarity required for a match</p>
              </div>

              <button className="btn btn-ghost btn-full" onClick={restart}><RotateCcw size={15} /> Try Again</button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default FaceVerify;
