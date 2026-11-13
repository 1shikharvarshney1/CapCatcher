import { useState, useRef } from 'react';

const SAMPLE_JOB = {
  _id: 'sample',
  status: 'done',
  transcript: 'This is a sample transcript. The Earth is flat according to some people. COVID-19 vaccines contain microchips. The Great Wall of China is visible from space.',
  ocrText: [
    '[8.0s] VIRAL CLAIM: The Great Wall of China is visible from space'
  ],
  claims: [
    {
      text: 'The Earth is flat according to some people',
      timestamp: 2.1,
      origin: 'speech',
      verdict: 'false',
      explanation: 'Extensive astronomical, physical, and satellite observations definitively prove Earth is an oblate spheroid.',
      sources: [
        { id: 'S1', title: 'NASA: Earth Shape and Planetary Science', url: 'https://science.nasa.gov', domain: 'nasa.gov', tier: 1 }
      ],
      citationValid: true
    },
    {
      text: 'COVID-19 vaccines contain microchips',
      timestamp: 5.4,
      origin: 'speech',
      verdict: 'false',
      explanation: 'Multiple independent fact-checkers and public health agencies confirm that vaccines do not contain microchips or tracking devices.',
      sources: [
        { id: 'S2', title: 'FactCheck.org: Microchip Vaccine Conspiracy Debunked', url: 'https://factcheck.org', domain: 'factcheck.org', tier: 1 },
        { id: 'S3', title: 'CDC: COVID-19 Vaccine Myths and Facts', url: 'https://cdc.gov', domain: 'cdc.gov', tier: 1 }
      ],
      citationValid: true
    },
    {
      text: 'The Great Wall of China is visible from space',
      timestamp: 8.7,
      origin: 'screen',
      verdict: 'misleading',
      explanation: 'Astronauts and NASA confirm the Great Wall is not visible to the unaided human eye from low Earth orbit without specialized optical lenses.',
      sources: [
        { id: 'S4', title: 'Scientific American: Visibility of Human Structures from Space', url: 'https://scientificamerican.com', domain: 'scientificamerican.com', tier: 2 }
      ],
      citationValid: true
    }
  ]
};

export default function App() {
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return setError('Please select an mp4 file.');
    setError('');
    setUploading(true);
    setJob(null);
    try {
      const form = new FormData();
      form.append('video', file);
      const res = await fetch('/api/jobs', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const { jobId } = data;
      setJob({ _id: jobId, status: 'processing' });
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/jobs/${jobId}`);
          const j = await r.json();
          setJob(j);
          if (j.status === 'done' || j.status === 'failed') stopPolling();
        } catch {}
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function loadSample() {
    stopPolling();
    setJob(SAMPLE_JOB);
    setError('');
  }

  const verdictColor = { true: '#22c55e', false: '#ef4444', misleading: '#f97316', unverified: '#94a3b8' };

  return (
    <div className="container">
      <header>
        <h1>🎯 CapCatcher</h1>
        <p className="tagline">Catch the cap in any reel.</p>
      </header>

      <form onSubmit={handleUpload} className="upload-form">
        <input
          type="file"
          accept="video/mp4"
          onChange={e => setFile(e.target.files[0])}
        />
        <button type="submit" disabled={uploading || !file}>
          {uploading ? 'Uploading...' : 'Upload & Check'}
        </button>
        <button type="button" className="sample-btn" onClick={loadSample}>
          Sample result
        </button>
      </form>

      {error && <div className="error-box">{error}</div>}

      {job && (
        <div className="result-section">
          <div className={`status-badge status-${job.status}`}>
            {job.status === 'processing' && '⏳ Processing your video...'}
            {job.status === 'done' && '✅ Analysis complete'}
            {job.status === 'failed' && `❌ Failed: ${job.error}`}
          </div>

          {job.status === 'done' && job.transcript && (
            <div className="transcript-box">
              <h2>📝 Transcript</h2>
              <p>{job.transcript}</p>
            </div>
          )}

          {job.status === 'done' && Array.isArray(job.ocrText) && job.ocrText.filter(Boolean).length > 0 && (
            <div className="transcript-box ocr-box">
              <h2>📺 On-Screen Text (OCR)</h2>
              <ul className="ocr-list">
                {job.ocrText.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {job.status === 'done' && (!job.claims || job.claims.length === 0) && (
            <div className="info-box">ℹ️ No claims detected in this video.</div>
          )}

          {job.claims && job.claims.length > 0 && (
            <div className="claims-section">
              <h2>🔍 Claims ({job.claims.length})</h2>
              {job.claims.map((claim, i) => (
                <div key={i} className="claim-card">
                  <div className="claim-header">
                    <span className={`origin-badge origin-${claim.origin}`}>
                      {claim.origin === 'screen' ? '🖥️ screen' : '🎙️ speech'}
                    </span>
                    <span className="timestamp">{claim.timestamp != null && typeof claim.timestamp === 'number' ? `${claim.timestamp.toFixed(1)}s` : ''}</span>
                    <span className="verdict-badge" style={{ background: verdictColor[claim.verdict] || '#94a3b8' }}>
                      {claim.verdict}
                    </span>
                  </div>
                  <p className="claim-text"><strong>{claim.text}</strong></p>
                  {claim.explanation && <p className="explanation">{claim.explanation}</p>}
                  {claim.sources && claim.sources.length > 0 && (
                    <div className="sources">
                      {claim.sources.map((s, j) => (
                        <a key={j} href={s.url} target="_blank" rel="noreferrer" className="source-link">
                          [{s.id}] {s.title || s.domain || s.url} {s.tier != null && <span className="tier">Tier {s.tier}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                  {!claim.citationValid && <div className="flag-warning">⚠️ Citation flagged</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
