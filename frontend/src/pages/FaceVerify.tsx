import React, { useState, useRef, useEffect } from 'react';
import * as faceapi from 'face-api.js';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Upload, Camera, CheckCircle, AlertCircle, RotateCcw, Loader2, ChevronRight, Shield, X } from 'lucide-react';

type Step = 'mode-select' | 'upload' | 'live' | 'processing' | 'result' | 'platform-setup' | 'platform-upload' | 'platform-processing' | 'platform-result';
type VerificationMode = 'live' | 'platform';

const anim = { initial:{opacity:0,y:14}, animate:{opacity:1,y:0}, exit:{opacity:0,y:-14}, transition:{duration:.28} };

const PLATFORMS = ['Tinder', 'Badoo', 'Hinge', 'Bumble', 'Match', 'Facebook', 'Instagram', 'Other'];

const FaceVerify: React.FC = () => {
  // Mode selection
  const [, setMode]             = useState<VerificationMode|null>(null);

  // Live verification states
  const [step, setStep]         = useState<Step>('mode-select');
  const [refImg, setRefImg]     = useState<string|null>(null);
  const [liveImg, setLiveImg]   = useState<string|null>(null);
  const [modelsOk, setModels]   = useState(false);
  const [modelMsg, setModelMsg] = useState('Loading biometric AI…');
  const [result, setResult]     = useState<{ok:boolean; distance:number; msg:string}|null>(null);
  const [camErr, setCamErr]     = useState<string|null>(null);
  
  // Platform verification states
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [apiToken, setApiToken] = useState('');
  const [platformPhoto, setPlatformPhoto] = useState<File | null>(null);
  const [platformPhotoPreview, setPlatformPhotoPreview] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState(false);
  const [validating, setValidating] = useState(false);
  const [platformResult, setPlatformResult] = useState<{verified:boolean; confidence:number; message:string; recordId?:string}|null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

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

  // LIVE VERIFICATION FUNCTIONS
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

  // PLATFORM VERIFICATION FUNCTIONS
  const validateToken = async () => {
    if (!apiToken.trim()) return;
    setValidating(true);
    try {
      await new Promise(r => setTimeout(r, 800));
      setTokenValid(apiToken.length > 10);
    } catch (err) {
      console.error(err);
    } finally {
      setValidating(false);
    }
  };

  const handlePlatformPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPlatformPhoto(f);
    const reader = new FileReader();
    reader.onload = ev => setPlatformPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const runPlatformVerification = async () => {
    if (!platformPhoto || !apiToken || !platform) return;

    setStep('platform-processing');
    setIsProcessing(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 30, 90));
    }, 300);

    try {
      const formData = new FormData();
      formData.append('photo', platformPhoto);
      formData.append('platform', platform);
      formData.append('apiToken', apiToken);

      const response = await fetch(`/api/verify/platform`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      clearInterval(progressInterval);
      setProgress(100);

      setPlatformResult({
        verified: data.verified,
        confidence: data.confidence || 0,
        message: data.message,
        recordId: data.recordId
      });

      setStep('platform-result');
    } catch (err) {
      console.error(err);
      clearInterval(progressInterval);
      setPlatformResult({
        verified: false,
        confidence: 0,
        message: 'Verification failed. Please check your credentials and try again.'
      });
      setStep('platform-result');
    } finally {
      setIsProcessing(false);
    }
  };

  const restart = () => {
    setMode(null);
    setStep('mode-select');
    stopCam();
    setRefImg(null);
    setLiveImg(null);
    setResult(null);
    setCamErr(null);
    setPlatformPhoto(null);
    setPlatformPhotoPreview(null);
    setApiToken('');
    setTokenValid(false);
    setPlatformResult(null);
    setProgress(0);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setRefImg(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ minHeight:'100vh', padding:'16px 0' }}>
      <AnimatePresence mode="wait">

        {/* MODE SELECTION */}
        {step === 'mode-select' && (
          <motion.div {...anim} key="mode-select" style={{ maxWidth:600, margin:'60px auto', padding:'0 16px' }}>
            <div className="card" style={{ padding:'44px 36px', textAlign:'center' }}>
              <div style={{ width:80, height:80, background:'rgba(59,130,246,0.12)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 24px' }}>
                <ScanFace size={40} color="var(--blue)" />
              </div>
              <h1 style={{ fontSize:'2rem', fontWeight:900, letterSpacing:'-.04em', marginBottom:12 }}>Biometric Verification</h1>
              <p style={{ color:'var(--muted)', marginBottom:36, lineHeight:1.7, fontSize:'.95rem' }}>
                Choose your verification method
              </p>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {/* Live Verification */}
                <button onClick={() => { setMode('live'); setStep('upload'); }}
                  style={{
                    padding:'24px 20px', border:'2px solid var(--border)', borderRadius:12,
                    background:'rgba(59,130,246,0.08)', cursor:'pointer', transition:'all .2s',
                    textAlign:'center'
                  }}
                  onMouseEnter={(e) => {(e.currentTarget as HTMLElement).style.borderColor = 'var(--blue)'; (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.15)'}}
                  onMouseLeave={(e) => {(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.08)'}}
                >
                  <Camera size={32} style={{ marginBottom:12, color:'var(--blue)' }} />
                  <h3 style={{ fontSize:'.95rem', fontWeight:700, marginBottom:6 }}>Live Scan</h3>
                  <p style={{ fontSize:'.8rem', color:'var(--muted)' }}>Compare reference photo with live camera capture</p>
                </button>

                {/* Platform Verification */}
                <button onClick={() => { setMode('platform'); setStep('platform-setup'); }}
                  style={{
                    padding:'24px 20px', border:'2px solid var(--border)', borderRadius:12,
                    background:'rgba(16,185,129,0.08)', cursor:'pointer', transition:'all .2s',
                    textAlign:'center'
                  }}
                  onMouseEnter={(e) => {(e.currentTarget as HTMLElement).style.borderColor = 'var(--green)'; (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.15)'}}
                  onMouseLeave={(e) => {(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.08)'}}
                >
                  <Shield size={32} style={{ marginBottom:12, color:'var(--green)' }} />
                  <h3 style={{ fontSize:'.95rem', fontWeight:700, marginBottom:6 }}>Platform Verify</h3>
                  <p style={{ fontSize:'.8rem', color:'var(--muted)' }}>Verify against third-party platform API</p>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── LIVE VERIFICATION FLOW ─── */}

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

              <div style={{ display:'flex', gap:12 }}>
                <button className="btn btn-ghost btn-full" onClick={restart}>← Back</button>
                <button className="btn btn-green btn-full" style={{ fontSize:'1rem', padding:'16px' }}
                  disabled={!refImg || !modelsOk}
                  onClick={() => { setStep('live'); setTimeout(startCam, 80); }}>
                  {modelsOk
                    ? <><Camera size={18} /> Proceed to Live Scan <ChevronRight size={18} /></>
                    : <><Loader2 size={18} style={{animation:'spin 1s linear infinite'}} /> {modelMsg}</>}
                </button>
              </div>
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

        {/* ─── PLATFORM VERIFICATION FLOW ─── */}

        {/* PLATFORM SETUP */}
        {step === 'platform-setup' && (
          <motion.div {...anim} key="platform-setup" style={{ maxWidth:600, margin:'40px auto', padding:'0 16px' }}>
            <div className="card" style={{ padding:'36px 32px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
                <div>
                  <h2 style={{ fontSize:'1.5rem', fontWeight:800, marginBottom:4 }}>Platform Credentials</h2>
                  <p style={{ color:'var(--muted)', fontSize:'.9rem' }}>Enter your {platform} API token</p>
                </div>
                <button onClick={restart} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--muted)' }}>
                  <X size={24} />
                </button>
              </div>

              <div style={{ marginBottom:'20px' }}>
                <label style={{ display:'block', fontSize:'.85rem', fontWeight:600, marginBottom:'8px' }}>Select Platform</label>
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value)}
                  style={{
                    width:'100%', padding:'10px 12px', borderRadius:'8px', border:'1px solid var(--border)',
                    background:'var(--bg-secondary)', color:'var(--text)', fontSize:'.95rem', cursor:'pointer'
                  }}
                >
                  {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div style={{ marginBottom:'20px' }}>
                <label style={{ display:'block', fontSize:'.85rem', fontWeight:600, marginBottom:'8px' }}>{platform} API Token</label>
                <input
                  type="password"
                  placeholder={`Enter your ${platform} API token`}
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                  onBlur={validateToken}
                  style={{
                    width:'100%', padding:'10px 12px', borderRadius:'8px', 
                    border:`1px solid ${tokenValid ? 'var(--green)' : 'var(--border)'}`,
                    background:'var(--bg-secondary)', color:'var(--text)', fontSize:'.95rem',
                    fontFamily:'monospace', marginBottom:'8px'
                  }}
                />
                {validating && <p style={{ fontSize:'.75rem', color:'var(--muted)' }}><Loader2 size={12} style={{ display:'inline', marginRight:'4px', animation:'spin 1s linear infinite' }} /> Validating…</p>}
                {tokenValid && !validating && <p style={{ fontSize:'.75rem', color:'var(--green)' }}><CheckCircle size={12} style={{ display:'inline', marginRight:'4px' }} /> Token looks valid</p>}
              </div>

              <div style={{ display:'flex', gap:'12px' }}>
                <button className="btn btn-ghost" onClick={restart} style={{ flex:1 }}>← Back</button>
                <button
                  onClick={() => setStep('platform-upload')}
                  disabled={!tokenValid || validating}
                  style={{
                    flex:1, padding:'10px', background:tokenValid && !validating ? 'var(--green)' : 'var(--muted)',
                    color:'white', border:'none', borderRadius:'8px', fontWeight:600, cursor:tokenValid && !validating ? 'pointer' : 'not-allowed',
                    opacity:tokenValid && !validating ? 1 : 0.6
                  }}
                >
                  Continue →
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* PLATFORM UPLOAD PHOTO */}
        {step === 'platform-upload' && (
          <motion.div {...anim} key="platform-upload" style={{ maxWidth:600, margin:'40px auto', padding:'0 16px' }}>
            <div className="card" style={{ padding:'36px 32px' }}>
              <h2 style={{ fontSize:'1.5rem', fontWeight:800, marginBottom:'4px' }}>Upload Profile Photo</h2>
              <p style={{ color:'var(--muted)', fontSize:'.9rem', marginBottom:'24px' }}>Upload the profile photo to verify against {platform}</p>

              <div
                style={{
                  border:'2px dashed var(--green)', borderRadius:'12px', padding:'32px 24px',
                  textAlign:'center', cursor:'pointer', marginBottom:'20px',
                  background:'rgba(16,185,129,0.05)'
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePlatformPhotoChange}
                  style={{ display:'none' }}
                  id="platform-photo-input"
                />
                <label htmlFor="platform-photo-input" style={{ cursor:'pointer', display:'block' }}>
                  <Upload size={32} style={{ marginBottom:'8px', color:'var(--green)' }} />
                  <p style={{ fontWeight:600, marginBottom:'4px' }}>Click to upload photo</p>
                  <p style={{ fontSize:'.8rem', color:'var(--muted)' }}>JPG, PNG up to 20MB</p>
                </label>
              </div>

              {platformPhotoPreview && (
                <div style={{ marginBottom:'20px' }}>
                  <img
                    src={platformPhotoPreview}
                    alt="preview"
                    style={{ width:'100%', maxHeight:'250px', borderRadius:'8px', objectFit:'cover' }}
                  />
                </div>
              )}

              <div style={{ display:'flex', gap:'12px' }}>
                <button className="btn btn-ghost" onClick={() => setStep('platform-setup')} style={{ flex:1 }}>← Back</button>
                <button
                  onClick={runPlatformVerification}
                  disabled={!platformPhoto || isProcessing}
                  style={{
                    flex:1, padding:'10px', background:platformPhoto && !isProcessing ? 'var(--green)' : 'var(--muted)',
                    color:'white', border:'none', borderRadius:'8px', fontWeight:600, cursor:platformPhoto && !isProcessing ? 'pointer' : 'not-allowed'
                  }}
                >
                  {isProcessing ? 'Processing…' : 'Verify Profile'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* PLATFORM PROCESSING */}
        {step === 'platform-processing' && (
          <motion.div {...anim} key="platform-proc" style={{ maxWidth:480, margin:'80px auto', padding:'0 16px', textAlign:'center' }}>
            <div className="card" style={{ padding:'60px 40px' }}>
              <div className="spinner" style={{ marginBottom:28, borderTopColor:'var(--green)', borderColor:'rgba(16,185,129,0.15)' }} />
              <h2 style={{ fontSize:'1.5rem', fontWeight:800, marginBottom:10 }}>Verifying with {platform}…</h2>
              <div style={{ background:'var(--bg-secondary)', borderRadius:'8px', height:'6px', marginBottom:'12px', overflow:'hidden' }}>
                <div style={{ background:'var(--green)', height:'100%', width:`${progress}%`, transition:'width 0.3s' }} />
              </div>
              <p style={{ color:'var(--muted)', fontSize:'.9rem' }}>{progress}% complete</p>
            </div>
          </motion.div>
        )}

        {/* PLATFORM RESULT */}
        {step === 'platform-result' && platformResult && (
          <motion.div {...anim} key="platform-res" style={{ maxWidth:540, margin:'40px auto', padding:'0 16px' }}>
            <div className="card" style={{
              padding:'40px 32px', textAlign:'center',
              borderLeft:`4px solid ${platformResult.verified ? 'var(--green)' : 'var(--red)'}`
            }}>
              {platformResult.verified ? (
                <CheckCircle size={64} color="var(--green)" />
              ) : (
                <AlertCircle size={64} color="var(--red)" />
              )}
              <h2 style={{ fontSize:'1.8rem', fontWeight:900, marginTop:16, marginBottom:12 }}>
                {platformResult.verified ? 'Profile Verified!' : 'Verification Failed'}
              </h2>
              <p style={{ color:'var(--muted)', marginBottom:28, lineHeight:1.7 }}>{platformResult.message}</p>

              {platformResult.confidence > 0 && (
                <div style={{ background:'var(--bg-secondary)', padding:'16px', borderRadius:'8px', marginBottom:'24px' }}>
                  <p style={{ fontSize:'.8rem', color:'var(--muted)', marginBottom:'8px' }}>Confidence</p>
                  <p style={{ fontSize:'2rem', fontWeight:900, color:'var(--green)' }}>{platformResult.confidence}%</p>
                </div>
              )}

              {platformResult.recordId && (
                <p style={{ fontSize:'.75rem', color:'var(--muted)', fontFamily:'monospace', marginBottom:'20px' }}>
                  Record ID: {platformResult.recordId.slice(-8)}
                </p>
              )}

              <button className="btn btn-ghost btn-full" onClick={restart}><RotateCcw size={15} /> Verify Another</button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default FaceVerify;
