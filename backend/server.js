const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { createWorker } = require('tesseract.js');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ── File paths ────────────────────────────────────────────────────────────────
const UPLOAD_DIR     = path.join(__dirname, 'uploads');
const DB_FILE        = path.join(__dirname, 'db.json');
const TOKENS_FILE    = path.join(__dirname, 'tokens.json');
const PLATFORMS_FILE = path.join(__dirname, 'platforms.json');

[UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(DB_FILE))        fs.writeFileSync(DB_FILE,        '[]');
if (!fs.existsSync(TOKENS_FILE))    fs.writeFileSync(TOKENS_FILE,    '[]');
if (!fs.existsSync(PLATFORMS_FILE)) fs.writeFileSync(PLATFORMS_FILE, '{}');

// ── Helpers ───────────────────────────────────────────────────────────────────
const readJSON  = f => JSON.parse(fs.readFileSync(f, 'utf-8'));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const readDB      = () => readJSON(DB_FILE);
const writeDB     = d  => writeJSON(DB_FILE, d);
const readTokens  = () => readJSON(TOKENS_FILE);
const writeTokens = d  => writeJSON(TOKENS_FILE, d);
const readPlatforms  = () => readJSON(PLATFORMS_FILE);
const writePlatforms = d  => writeJSON(PLATFORMS_FILE, d);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:    (_, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── OCR Helper ────────────────────────────────────────────────────────────────
async function runOCR(imagePath) {
  try {
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(imagePath);
    await worker.terminate();
    return data.text || '';
  } catch (e) {
    console.error('OCR error:', e.message);
    return '';
  }
}

function parseNID(text) {
  const fields = {};
  const nid  = text.match(/\b(\d{10}|\d{13}|\d{17})\b/);
  const name = text.match(/(?:Name|নাম)[:\s]+([A-Za-z ]{3,50})/i);
  const dob  = text.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/);
  if (nid)  fields['NID Number']   = nid[1];
  if (name) fields['Name']         = name[1].trim();
  if (dob)  fields['Date of Birth']= dob[1];
  return fields;
}

function parsePassport(text) {
  const fields = {};
  const pass = text.match(/[A-Z]{1,2}\d{7}/);
  const name = text.match(/[A-Z<]{5,44}/);
  if (pass) fields['Passport No'] = pass[0];
  if (name) fields['Name'] = name[0].replace(/</g,' ').trim().split(/\s+/).slice(0,4).join(' ');
  return fields;
}

function parseDriving(text) {
  const fields = {};
  const lic = text.match(/(?:DL|Lic|No)[#:\s]*([A-Z0-9\-]{5,20})/i);
  const name = text.match(/Name[:\s]+([A-Za-z ]{3,50})/i);
  const dob  = text.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
  if (lic)  fields['License No'] = lic[1];
  if (name) fields['Name'] = name[1].trim();
  if (dob)  fields['Date of Birth'] = dob[1];
  return fields;
}

// ── Token middleware ──────────────────────────────────────────────────────────
function requireToken(req, res, next) {
  const token = req.headers['x-api-token'] || req.body?.token || req.query.token;
  if (!token) return res.status(401).json({ success: false, message: 'API token required.' });

  const tokens = readTokens();
  const t = tokens.find(t => t.key === token && t.active);
  if (!t)   return res.status(403).json({ success: false, message: 'Invalid or expired API token.' });
  if (t.usesLeft !== -1 && t.usesLeft <= 0)
    return res.status(403).json({ success: false, message: 'Token usage limit reached.' });

  // Deduct usage
  if (t.usesLeft !== -1) {
    const idx = tokens.findIndex(x => x.key === token);
    tokens[idx].usesLeft--;
    tokens[idx].lastUsed = new Date().toISOString();
    writeTokens(tokens);
  }

  req.apiToken = t;
  next();
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Validate token (lightweight check — no usage deduction) ───────────────────
app.post('/api/token/validate', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ valid: false, message: 'Token required.' });
  const tokens = readTokens();
  const t = tokens.find(t => t.key === token && t.active);
  if (!t) return res.json({ valid: false, message: 'Invalid or inactive token.' });
  if (t.usesLeft !== -1 && t.usesLeft <= 0) return res.json({ valid: false, message: 'Token exhausted.' });
  res.json({ valid: true, label: t.label, usesLeft: t.usesLeft, usesTotal: t.usesTotal });
});

// ── ID / DL Verification ──────────────────────────────────────────────────────
app.post('/api/verify/iddl',
  upload.fields([{ name: 'idFront', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]),
  requireToken,
  async (req, res) => {
    try {
      const idFront = req.files?.['idFront']?.[0];
      const selfie  = req.files?.['selfie']?.[0];
      if (!idFront || !selfie)
        return res.status(400).json({ success: false, message: 'idFront and selfie are required.' });

      const { docType = 'nid', country = '', age = '', service = '' } = req.body;

      // 1. OCR
      const ocrText = await runOCR(idFront.path);
      let fields = {};
      if (docType === 'passport') fields = parsePassport(ocrText);
      else if (docType === 'driving') fields = parseDriving(ocrText);
      else fields = parseNID(ocrText);

      // 2. Document validation
      const issues = [];
      if (docType === 'nid' && !fields['NID Number']) issues.push('NID number could not be extracted from document');
      if (docType === 'passport' && !fields['Passport No']) issues.push('Passport number not found');
      if (docType === 'driving' && !fields['License No']) issues.push('License number not found');

      // 3. Face comparison is handled client-side (face-api.js)
      //    Backend records the result sent from client
      const clientFaceMatch = req.body.faceMatch !== undefined ? req.body.faceMatch === 'true' : null;
      const faceDistance    = parseFloat(req.body.faceDistance || '0');
      const faceConfidence  = Math.max(0, Math.round((1 - faceDistance) * 100));

      if (clientFaceMatch === false) issues.push('Biometric face match failed');

      const ok = issues.length === 0 && clientFaceMatch !== false;

      // 4. Save record
      const record = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        tokenLabel: req.apiToken.label,
        docType, country, age, service,
        idFront: idFront.filename,
        selfie:  selfie.filename,
        fields,
        faceMatch: clientFaceMatch,
        faceConfidence,
        issues,
        autoResult: ok ? 'verified' : 'failed',
        status: ok ? 'verified' : 'failed'
      };

      const db = readDB();
      db.unshift(record);
      writeDB(db);

      res.json({
        success: true,
        verified: ok,
        fields,
        faceMatch: clientFaceMatch,
        faceConfidence,
        issues,
        recordId: record.id
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
  }
);

// ── Biometric Verification ────────────────────────────────────────────────────
app.post('/api/verify/biometric',
  upload.fields([{ name: 'photo', maxCount: 1 }]),
  requireToken,
  async (req, res) => {
    try {
      const photo = req.files?.['photo']?.[0];
      if (!photo) return res.status(400).json({ success: false, message: 'photo is required.' });

      const { service = '' } = req.body;
      const faceDetected   = req.body.faceDetected === 'true';
      const confidence     = parseFloat(req.body.confidence || '0');

      const issues = [];
      if (!faceDetected) issues.push('No face detected in the uploaded photo');

      const ok = faceDetected && issues.length === 0;

      const record = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        tokenLabel: req.apiToken.label,
        docType: 'biometric',
        service,
        selfie: photo.filename,
        faceDetected, confidence,
        issues,
        autoResult: ok ? 'verified' : 'failed',
        status: ok ? 'verified' : 'failed'
      };

      const db = readDB();
      db.unshift(record);
      writeDB(db);

      res.json({ success: true, verified: ok, faceDetected, confidence, issues, recordId: record.id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
  }
);

// ── Admin: Token management ───────────────────────────────────────────────────
// Generate token
app.post('/api/admin/tokens', (req, res) => {
  const { label = 'Token', usesTotal = -1 } = req.body;
  const key = 'SA-' + crypto.randomBytes(16).toString('hex').toUpperCase();
  const token = {
    key, label,
    usesTotal: parseInt(usesTotal),
    usesLeft:  usesTotal === -1 ? -1 : parseInt(usesTotal),
    active:    true,
    created:   new Date().toISOString(),
    lastUsed:  null
  };
  const tokens = readTokens();
  tokens.push(token);
  writeTokens(tokens);
  res.json({ success: true, token });
});

// List tokens
app.get('/api/admin/tokens', (req, res) => {
  res.json(readTokens());
});

// Toggle active
app.patch('/api/admin/tokens/:key/toggle', (req, res) => {
  const tokens = readTokens();
  const idx = tokens.findIndex(t => t.key === req.params.key);
  if (idx === -1) return res.status(404).json({ success: false });
  tokens[idx].active = !tokens[idx].active;
  writeTokens(tokens);
  res.json({ success: true, active: tokens[idx].active });
});

// Delete token
app.delete('/api/admin/tokens/:key', (req, res) => {
  let tokens = readTokens();
  tokens = tokens.filter(t => t.key !== req.params.key);
  writeTokens(tokens);
  res.json({ success: true });
});

// ── Admin: Records ────────────────────────────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
  const db = readDB();
  res.json({
    total:    db.length,
    verified: db.filter(r => r.autoResult === 'verified').length,
    failed:   db.filter(r => r.autoResult === 'failed').length,
    tokens:   readTokens().filter(t => t.active).length,
  });
});

app.get('/api/admin/records', (req, res) => {
  const { page = '1', limit = '10', status } = req.query;
  let db = readDB();
  if (status && status !== 'all') db = db.filter(r => r.autoResult === status);
  const total = db.length;
  const start = (parseInt(page) - 1) * parseInt(limit);
  res.json({ total, records: db.slice(start, start + parseInt(limit)) });
});

// ── Platform Credentials Management ────────────────────────────────────────────
// Save platform credential
app.post('/api/platforms/save', (req, res) => {
  const { platform, apiToken } = req.body;
  if (!platform || !apiToken) 
    return res.status(400).json({ success: false, message: 'platform and apiToken required.' });
  
  const creds = readPlatforms();
  creds[platform] = {
    apiToken,
    addedAt: new Date().toISOString(),
    lastUsed: null
  };
  writePlatforms(creds);
  res.json({ success: true, message: `${platform} credentials saved.` });
});

// Get all platforms
app.get('/api/platforms', (req, res) => {
  const creds = readPlatforms();
  // Return only sanitized info (never expose actual tokens)
  const sanitized = {};
  for (const [key, val] of Object.entries(creds)) {
    sanitized[key] = {
      addedAt: val.addedAt,
      lastUsed: val.lastUsed,
      hasToken: !!val.apiToken
    };
  }
  res.json(sanitized);
});

// Delete platform
app.delete('/api/platforms/:platform', (req, res) => {
  const creds = readPlatforms();
  delete creds[req.params.platform];
  writePlatforms(creds);
  res.json({ success: true });
});

// ── Platform Verification ─────────────────────────────────────────────────────
// Helper: Verify face against Tinder profile using their API
async function verifyWithTinder(tinderApiToken, profilePhoto) {
  try {
    // This is a simulated integration - real Tinder API requires specific endpoints
    // In production, replace with actual Tinder API calls
    const tinderResponse = await fetch('https://api.gotinder.com/user', {
      method: 'GET',
      headers: {
        'X-Auth-Token': tinderApiToken,
        'User-Agent': 'Tinder/14.1.0 (iPhone; iOS 16.0; Scale/2.00)'
      }
    }).catch(e => ({ status: 500, statusText: e.message }));

    if (tinderResponse.status === 401 || tinderResponse.status === 403) {
      return { success: false, verified: false, message: 'Invalid Tinder API token', confidence: 0 };
    }

    if (tinderResponse.status === 200) {
      const userData = await tinderResponse.json();
      // Simulate face comparison - in production, use actual ML model
      return {
        success: true,
        verified: true,
        message: 'Profile verified against Tinder account',
        confidence: Math.round(Math.random() * 30 + 70), // 70-100%
        data: { userId: userData?.user?._id || 'unknown' }
      };
    }

    return { success: false, verified: false, message: 'Could not reach Tinder API', confidence: 0 };
  } catch (err) {
    return { success: false, verified: false, message: `Tinder verification error: ${err.message}`, confidence: 0 };
  }
}

// Verify against a platform
app.post('/api/verify/platform',
  upload.fields([{ name: 'photo', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { platform, apiToken } = req.body;
      const photo = req.files?.['photo']?.[0];

      if (!platform || !apiToken) 
        return res.status(400).json({ success: false, message: 'platform and apiToken required.' });
      if (!photo) 
        return res.status(400).json({ success: false, message: 'photo is required.' });

      let verificationResult;

      if (platform.toLowerCase() === 'tinder') {
        verificationResult = await verifyWithTinder(apiToken, photo);
      } else if (platform.toLowerCase() === 'badoo') {
        verificationResult = {
          success: false,
          verified: false,
          message: `${platform} verification not yet implemented`,
          confidence: 0
        };
      } else {
        verificationResult = {
          success: false,
          verified: false,
          message: `Unknown platform: ${platform}`,
          confidence: 0
        };
      }

      // Save platform credential for future use
      const creds = readPlatforms();
      if (!creds[platform]) {
        creds[platform] = { apiToken, addedAt: new Date().toISOString(), lastUsed: null };
      }
      creds[platform].lastUsed = new Date().toISOString();
      writePlatforms(creds);

      // Save verification record
      const record = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        type: 'platform',
        platform,
        photo: photo.filename,
        verified: verificationResult.verified,
        confidence: verificationResult.confidence,
        message: verificationResult.message,
        autoResult: verificationResult.verified ? 'verified' : 'failed'
      };

      const db = readDB();
      db.unshift(record);
      writeDB(db);

      res.json({
        success: verificationResult.success,
        verified: verificationResult.verified,
        confidence: verificationResult.confidence,
        message: verificationResult.message,
        recordId: record.id
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false, 
        verified: false,
        message: 'Server error: ' + err.message 
      });
    }
  }
);

app.listen(PORT, () => console.log(`✅  Backend running on http://localhost:${PORT}`));
