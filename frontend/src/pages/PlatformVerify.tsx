import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, Loader2, RotateCcw, Upload, Key, Shield, ArrowRight } from 'lucide-react';

type Step = 'setup' | 'upload' | 'processing' | 'result';

const anim = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -14 }, transition: { duration: 0.28 } };

interface VerifyResult {
  verified: boolean;
  confidence: number;
  message: string;
  recordId?: string;
}

const PLATFORMS = ['Tinder', 'Badoo', 'Hinge', 'Bumble', 'Match', 'Facebook', 'Instagram', 'Other'];

const PlatformVerify: React.FC<{ API: string }> = ({ API }) => {
  const [step, setStep] = useState<Step>('setup');
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [apiToken, setApiToken] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState(false);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const validateToken = async () => {
    if (!apiToken.trim()) return;
    setValidating(true);
    try {
      // Simulate validation - in production, add actual endpoint
      await new Promise(r => setTimeout(r, 800));
      setTokenValid(apiToken.length > 10);
    } catch (err) {
      console.error(err);
    } finally {
      setValidating(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const runVerification = async () => {
    if (!photo || !apiToken || !platform) return;

    setStep('processing');
    setIsProcessing(true);
    setProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 30, 90));
    }, 300);

    try {
      const formData = new FormData();
      formData.append('photo', photo);
      formData.append('platform', platform);
      formData.append('apiToken', apiToken);

      const response = await fetch(`${API}/api/verify/platform`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      clearInterval(progressInterval);
      setProgress(100);

      setResult({
        verified: data.verified,
        confidence: data.confidence || 0,
        message: data.message,
        recordId: data.recordId
      });

      setStep('result');
    } catch (err) {
      console.error(err);
      clearInterval(progressInterval);
      setResult({
        verified: false,
        confidence: 0,
        message: 'Verification failed. Please check your credentials and try again.'
      });
      setStep('result');
    } finally {
      setIsProcessing(false);
    }
  };

  const restart = () => {
    setStep('setup');
    setPhoto(null);
    setPhotoPreview(null);
    setResult(null);
    setProgress(0);
  };

  return (
    <div style={{ padding: '2rem' }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <Shield size={28} style={{ display: 'inline-block', marginRight: '0.75rem', verticalAlign: 'middle' }} />
          Platform Profile Verification
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>
          Verify your profile against third-party dating platforms using their API
        </p>
      </motion.div>

      <AnimatePresence mode="wait">
        {/* SETUP STEP */}
        {step === 'setup' && (
          <motion.div key="setup" {...anim} style={{ maxWidth: 600 }}>
            <div className="card">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>
                <Key size={18} style={{ display: 'inline-block', marginRight: '0.5rem' }} />
                Step 1: Platform Credentials
              </h2>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Select Platform
                </label>
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text)',
                    fontSize: '0.95rem'
                  }}
                >
                  {PLATFORMS.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  {platform} API Token
                </label>
                <input
                  type="password"
                  placeholder={`Enter your ${platform} API token`}
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                  onBlur={validateToken}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    border: `1px solid ${tokenValid ? 'var(--success)' : 'var(--border)'}`,
                    background: 'var(--bg-secondary)',
                    color: 'var(--text)',
                    fontSize: '0.95rem',
                    marginBottom: '0.5rem',
                    fontFamily: 'monospace'
                  }}
                />
                {validating && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    <Loader2 size={14} style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginRight: '0.25rem' }} />
                    Validating token…
                  </p>
                )}
                {tokenValid && !validating && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--success)' }}>
                    <CheckCircle size={14} style={{ display: 'inline-block', marginRight: '0.25rem' }} />
                    Token looks valid
                  </p>
                )}
              </div>

              <button
                onClick={() => setStep('upload')}
                disabled={!tokenValid || validating}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  background: tokenValid && !validating ? 'var(--primary)' : 'var(--muted)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontWeight: 600,
                  cursor: tokenValid && !validating ? 'pointer' : 'not-allowed',
                  opacity: tokenValid && !validating ? 1 : 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                Continue <ArrowRight size={18} />
              </button>
            </div>
          </motion.div>
        )}

        {/* UPLOAD STEP */}
        {step === 'upload' && (
          <motion.div key="upload" {...anim} style={{ maxWidth: 600 }}>
            <div className="card">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>
                <Upload size={18} style={{ display: 'inline-block', marginRight: '0.5rem' }} />
                Step 2: Upload Profile Photo
              </h2>

              <div
                style={{
                  border: '2px dashed var(--primary)',
                  borderRadius: '0.75rem',
                  padding: '2rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  marginBottom: '1.5rem',
                  background: 'rgba(var(--primary-rgb), 0.05)',
                  transition: 'all 0.2s'
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  style={{ display: 'none' }}
                  id="photo-input"
                />
                <label htmlFor="photo-input" style={{ cursor: 'pointer', display: 'block' }}>
                  <Upload size={32} style={{ marginBottom: '0.5rem', color: 'var(--primary)' }} />
                  <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Click to upload photo</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>JPG, PNG up to 20MB</p>
                </label>
              </div>

              {photoPreview && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <img
                    src={photoPreview}
                    alt="preview"
                    style={{
                      width: '100%',
                      maxHeight: '300px',
                      borderRadius: '0.5rem',
                      objectFit: 'cover'
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => setStep('setup')}
                  style={{
                    flex: 1,
                    padding: '0.85rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>
                <button
                  onClick={runVerification}
                  disabled={!photo || isProcessing}
                  style={{
                    flex: 1,
                    padding: '0.85rem',
                    background: photo && !isProcessing ? 'var(--success)' : 'var(--muted)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.5rem',
                    fontWeight: 600,
                    cursor: photo && !isProcessing ? 'pointer' : 'not-allowed'
                  }}
                >
                  {isProcessing ? 'Processing…' : 'Verify Profile'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* PROCESSING STEP */}
        {step === 'processing' && (
          <motion.div key="processing" {...anim} style={{ maxWidth: 600, textAlign: 'center' }}>
            <div className="card">
              <Loader2 size={48} style={{ margin: '0 auto 1rem', animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>Verifying Profile…</h2>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '0.5rem', height: '8px', marginBottom: '0.5rem', overflow: 'hidden' }}>
                <div
                  style={{
                    background: 'var(--primary)',
                    height: '100%',
                    width: `${progress}%`,
                    transition: 'width 0.3s'
                  }}
                />
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{progress}% complete</p>
            </div>
          </motion.div>
        )}

        {/* RESULT STEP */}
        {step === 'result' && result && (
          <motion.div key="result" {...anim} style={{ maxWidth: 600 }}>
            <div
              className="card"
              style={{
                borderLeft: `4px solid ${result.verified ? 'var(--success)' : 'var(--danger)'}`
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                {result.verified ? (
                  <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: '1rem' }} />
                ) : (
                  <AlertCircle size={48} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
                )}
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                  {result.verified ? 'Profile Verified!' : 'Verification Failed'}
                </h2>
                <p style={{ fontSize: '0.95rem', color: 'var(--muted)', marginBottom: '1rem' }}>
                  {result.message}
                </p>
                {result.confidence > 0 && (
                  <div style={{
                    background: 'var(--bg-secondary)',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    marginBottom: '1rem'
                  }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Confidence</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
                      {result.confidence}%
                    </p>
                  </div>
                )}
                {result.recordId && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
                    Record ID: {result.recordId.slice(-8)}
                  </p>
                )}
              </div>

              <button
                onClick={restart}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <RotateCcw size={18} />
                Verify Another Profile
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PlatformVerify;
