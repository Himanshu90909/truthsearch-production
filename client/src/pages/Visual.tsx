// TruthSearch Visual Intelligence — full user journey in one page:
// upload (drag/paste/file/camera) -> preview editor (crop/zoom/rotate) ->
// streaming analysis (SSE) -> annotated overlay + steps + diagram ->
// follow-ups, OCR, feedback, TruthSearch verification, history, delete.

import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  Crop as CropIcon,
  Download,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Loader2,
  Menu,
  RotateCw,
  ScanText,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

type Region = { id: number; label: string; kind: string; bbox: [number, number, number, number]; note?: string; confidence?: number };
type Analysis = {
  imageType: string; summary: string; regions: Array<{ label: string; kind: string; bbox: number[]; note?: string; confidence?: number }>;
  objects: Array<{ name: string; regionIndex?: number; inferred: boolean }>;
  textRegions: Array<{ text: string; regionIndex?: number; ambiguous: boolean }>;
  steps: Array<{ n: number; text: string; regionIndex?: number }>;
  visible: string[]; inferred: string[]; uncertainties: string[]; diagram?: unknown;
  followUpQuestions: string[];
};
type FollowupItem = { question: string; answer: string; uncertainties: string[] | null; createdAt: string };

const MODES: Array<{ id: "explain" | "analyze" | "annotate" | "simplify" | "compare" | "teach"; label: string; hint: string }> = [
  { id: "explain", label: "Explain", hint: "What is this and how does it work?" },
  { id: "analyze", label: "Analyze", hint: "Structure, patterns, critical read" },
  { id: "annotate", label: "Annotate", hint: "Label the important regions" },
  { id: "simplify", label: "Simplify", hint: "Jargon-free mental model" },
  { id: "compare", label: "Compare", hint: "Contrast elements in the image" },
  { id: "teach", label: "Teach", hint: "Step-by-step lesson" },
];
const DEPTHS: Array<{ id: "beginner" | "intermediate" | "advanced" | "technical"; label: string }> = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
  { id: "technical", label: "Technical" },
];
const PALETTE = ["#20808d", "#d97706", "#7c3aed", "#dc2626", "#059669", "#2563eb"];

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("We couldn't read that image."));
    reader.readAsDataURL(file);
  });
}
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a displayable image."));
    img.src = src;
  });
}

// Bake editor transforms (rotate/flip-safe bake with optional crop) into a
// final JPEG data URL capped at 1600px — uploads stay small and sharp.
async function bakeTransform(src: string, rotation: number, crop: { x: number; y: number; w: number; h: number } | null): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src);
  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const fullW = swap ? img.height : img.width;
  const fullH = swap ? img.width : img.height;
  const sx = crop ? crop.x / 100 * img.width : 0;
  const sy = crop ? crop.y / 100 * img.height : 0;
  const sw = crop ? crop.w / 100 * img.width : img.width;
  const sh = crop ? crop.h / 100 * img.height : img.height;
  const baseW = crop ? (swap ? sh : sw) : fullW;
  const baseH = crop ? (swap ? sw : sh) : fullH;
  const scale = Math.min(1, 1600 / Math.max(baseW, baseH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.round(baseW * scale));
  canvas.height = Math.max(16, Math.round(baseH * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(swap ? -1 : 1, 1); // account for the dimension swap when sampling rotated
  ctx.drawImage(img, sx, sy, sw, sh, -((swap ? baseH : baseW) * scale) / 2 * (swap ? -1 : 1) * (swap ? -1 : 1) || -((swap ? baseH : baseW) * scale) / 2, -((swap ? baseW : baseH) * scale) / 2, (swap ? sh : sw) * scale, (swap ? sw : sh) * scale);
  ctx.restore();
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width: canvas.width, height: canvas.height };
}

export default function Visual() {
  // ---------- upload + editor state ----------
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [cropping, setCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editorError, setEditorError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- analysis state ----------
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"explain" | "analyze" | "annotate" | "simplify" | "compare" | "teach">("explain");
  const [depth, setDepth] = useState<"beginner" | "intermediate" | "advanced" | "technical">("intermediate");
  const [language, setLanguage] = useState("en");
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ uploadId: number; mime: string; width: number; height: number } | null>(null);
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ analysisId: number; analysis: Analysis; overlaySvg: string; diagramSvg: string | null; provider: string; model: string } | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [view, setView] = useState<"annotated" | "original" | "side">("annotated");
  const [zoom, setZoom] = useState(1);
  const [streamError, setStreamError] = useState("");
  const [showOverlay, setShowOverlay] = useState(true);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [followupInput, setFollowupInput] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyQuestion, setVerifyQuestion] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const info = trpc.visual.info.useQuery();
  const me = trpc.auth.me.useQuery();
  const history = trpc.visual.list.useQuery({ limit: 30 });
  const startAnalysis = trpc.visual.start.useMutation();
  const followupMut = trpc.visual.followup.useMutation();
  const ocrMut = trpc.visual.ocr.useMutation();
  const feedbackMut = trpc.visual.feedback.useMutation();
  const deleteMut = trpc.visual.delete.useMutation();
  const verifyMut = trpc.visual.verify.useMutation();

  const esRef = useRef<EventSource | null>(null);
  useEffect(() => () => esRef.current?.close(), []);

  const acceptFile = useCallback(async (file: File | Blob | null | undefined) => {
    if (!file) return;
    setEditorError("");
    if (file.size > 8 * 1024 * 1024) { setEditorError("Images must be smaller than 8 MB."); return; }
    try {
      const src = await fileToDataUrl(file);
      await loadImage(src); // verify decodable
      setPendingSrc(src);
      setRotation(0); setCrop(null); setCropping(false); setResult(null); setStreamError("");
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "That file couldn't be read as an image.");
    }
  }, []);

  // Paste from clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) void acceptFile(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptFile]);

  const beginAnalysis = async () => {
    if (!pendingSrc || running) return;
    setStreamError(""); setResult(null); setOcrText(null); setRating(null);
    setRunning(true);
    setStreamStatus("Preparing image…");
    try {
      const baked = await bakeTransform(pendingSrc, rotation, crop);
      const { sessionId, uploadId, uploadToken: token, mime } = await startAnalysis.mutateAsync({
        dataUrl: baked.dataUrl,
        width: baked.width,
        height: baked.height,
        question: question.trim() || undefined,
        mode, depth, language,
      });
      setUploadToken(token);
      setImageMeta({ uploadId, mime, width: baked.width, height: baked.height });
      setStreamStatus("Analyzing image…");
      const es = new EventSource(`/api/visual/stream/${sessionId}`);
      esRef.current?.close();
      esRef.current = es;
      es.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "stage") setStreamStatus(payload.message);
        else if (payload.type === "done") {
          setResult({ analysisId: payload.analysisId, analysis: payload.analysis as Analysis, overlaySvg: payload.overlaySvg, diagramSvg: payload.diagramSvg, provider: payload.provider, model: payload.model });
          setStreamStatus("");
          setRunning(false);
          es.close();
          void history.refetch();
        } else if (payload.type === "error") {
          setStreamError(payload.message);
          setStreamStatus("");
          setRunning(false);
          es.close();
        } else if (payload.type === "cancelled") {
          setStreamStatus("");
          setRunning(false);
          es.close();
        }
      };
      es.onerror = () => { es.close(); setRunning(false); setStreamStatus(""); };
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "The analysis could not start.");
      setStreamStatus("");
      setRunning(false);
    }
  };

  const cancelAnalysis = () => { esRef.current?.close(); setRunning(false); setStreamStatus(""); };

  const runOcr = async () => {
    if (!imageMeta || !uploadToken) return;
    setOcrLoading(true);
    try {
      const out = await ocrMut.mutateAsync({ uploadId: imageMeta.uploadId, token: uploadToken });
      setOcrText(out.text || "(No readable text found)");
    } catch (error) {
      setOcrText(`OCR failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally { setOcrLoading(false); }
  };

  const submitFollowup = () => {
    if (!result || followupInput.trim().length < 3) return;
    followupMut.mutate({ sessionId: result.analysisId, question: followupInput.trim() });
    setFollowupInput("");
  };
  // followups are stored per session; we display them from the mutation cache
  const [followups, setFollowups] = useState<Array<{ question: string; answer: string; uncertainties: string[] }>>([]);
  useEffect(() => {
    if (followupMut.data) setFollowups((items) => items.some((i) => i.question === (followupMut.data as { answer: string }).answer) ? items : [...items, { question: followupMut.variables?.question ?? "", answer: followupMut.data.answer, uncertainties: followupMut.data.uncertainties }]);
  }, [followupMut.data]);

  const downloadAnnotated = () => {
    if (!result || !imageMeta || !uploadToken) return;
    // Compose original + SVG overlay on a canvas and export PNG.
    void (async () => {
      const img = await loadImage(`/api/visual/image/${imageMeta.uploadId}?t=${encodeURIComponent(uploadToken)}`);
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const svgBlob = new Blob([result.overlaySvg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(svgBlob);
      const overlay = await loadImage(url);
      URL.revokeObjectURL(url);
      ctx.drawImage(overlay, 0, 0);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "truthsearch-annotated.png";
      a.click();
    })();
  };
  const downloadDiagram = () => {
    if (!result?.diagramSvg) return;
    const a = document.createElement("a");
    a.href = `data:image/svg+xml;base64,${btoa(result.diagramSvg)}`;
    a.download = "truthsearch-diagram.svg";
    a.click();
  };

  const imageUrl = imageMeta && uploadToken ? `/api/visual/image/${imageMeta.uploadId}?t=${encodeURIComponent(uploadToken)}` : null;
  const regions: Region[] = result ? result.analysis.regions.map((r, i) => ({
    id: i, label: r.label, kind: r.kind, bbox: [r.bbox[0], r.bbox[1], r.bbox[2], r.bbox[3]] as [number, number, number, number], note: r.note, confidence: r.confidence,
  })) : [];

  const loadHistoryItem = async (id: number) => {
    setSidebarOpen(false);
    // Full fetch via tRPC get, then populate the state from the stored analysis.
    try {
      const data = await trpcUtils.visual.get.fetch({ id });
      if (data.image && data.analysis) {
        setImageMeta({ uploadId: data.image.uploadId, mime: data.image.mime, width: data.image.width, height: data.image.height });
        setUploadToken(null); // signed-in users access by id via cookie
        setPendingSrc(null);
        setResult({ analysisId: data.analysis.analysisId, analysis: data.analysis.parsed as Analysis, overlaySvg: data.analysis.overlaySvg ?? "", diagramSvg: data.analysis.diagramSvg ?? null, provider: data.analysis.provider, model: data.analysis.model });
      }
    } catch { setStreamError("That visual session could not be loaded."); }
  };

  const trpcUtils = trpc.useUtils();

  return (
    <div className="app visual-app">
      <aside className="chat-sidebar" aria-label="Saved visual sessions">
        <button className="sidebar-new" onClick={() => { setPendingSrc(null); setResult(null); setImageMeta(null); setUploadToken(null); }}><Sparkles size={15} /> New visual analysis</button>
        <div className="eyebrow">Saved visual sessions</div>
        <div className="history-list">
          {(history.data || []).map((item) => (
            <div className={`history-row ${result?.analysisId === item.id ? "active" : ""}`} key={item.id}>
              <button type="button" className="history-item" onClick={() => void loadHistoryItem(item.id)}>
                <strong>{item.question || `${item.mode} analysis`}</strong>
                <small>{item.status === "completed" ? "Completed" : item.status === "failed" ? "Failed" : item.status}</small>
              </button>
              <button type="button" className="history-assign" aria-label="Delete visual session" onClick={() => { deleteMut.mutate({ id: item.id }, { onSuccess: () => void history.refetch() }); }}><Trash2 size={12} /></button>
            </div>
          ))}
          {!history.data?.length && <p className="sidebar-empty">{me.data ? "Your visual analyses will appear here." : "Sign in to keep your visual sessions across devices."}</p>}
        </div>
      </aside>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)}>
          <aside className="mobile-sidebar" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
            <button className="sidebar-new" onClick={() => { setPendingSrc(null); setResult(null); setImageMeta(null); setUploadToken(null); setSidebarOpen(false); }}><Sparkles size={15} /> New visual analysis</button>
            <div className="eyebrow">Saved visual sessions</div>
            <div className="history-list">
              {(history.data || []).map((item) => (
                <button type="button" className="history-item" key={item.id} onClick={() => { void loadHistoryItem(item.id); setSidebarOpen(false); }}>
                  <strong>{item.question || `${item.mode} analysis`}</strong>
                  <small>{item.status === "completed" ? "Completed" : item.status === "failed" ? "Failed" : item.status}</small>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <main className="visual-main">
        <header className="visual-header">
          <button className="icon-button" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={18} /></button>
          <Link href="/" className="brand"><span className="brand-mark"><Sparkles size={16} /></span><span>TruthSearch</span></Link>
          <span className="visual-badge"><Eye size={13} /> Visual Intelligence</span>
          <div className="visual-header-right">
            <Link href="/" className="visual-nav-link">Research</Link>
          </div>
        </header>

        {!info.data?.configured && (
          <div className="notice-card" role="status">
            <ShieldCheck size={16} />
            <div><strong>No vision model configured on this deployment.</strong>
              <p>Set <code>GEMINI_API_KEY</code>, <code>HF_API_KEY</code>, <code>GROQ_API_KEY</code>, or <code>VISION_API_URL</code> + <code>VISION_API_KEY</code> + <code>VISION_MODEL</code> to enable analysis. Everything else (upload, storage, history) works.</p>
            </div>
          </div>
        )}

        <section className="visual-upload-zone" aria-label="Upload an image">
          {!pendingSrc ? (
            <div
              className={`dropzone ${running ? "disabled" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void acceptFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
              role="button" tabIndex={0} aria-label="Drop, paste or choose an image to analyse"
            >
              <ImageIcon size={30} />
              <strong>Drop an image, paste from clipboard, or click to choose</strong>
              <p>Diagrams, charts, screenshots, code, handwritten notes — JPEG, PNG, WebP or GIF up to 8 MB.</p>
            </div>
          ) : (
            <div className="editor-layout">
              <div className="editor-canvas" onPointerDown={(e) => { if (!cropping) return; const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setCropStart({ x: (e.clientX - rect.left) / rect.width * 100, y: (e.clientY - rect.top) / rect.height * 100 }); }}
                onPointerMove={(e) => { if (!cropping || !cropStart) return; const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const x = (e.clientX - rect.left) / rect.width * 100; const y = (e.clientY - rect.top) / rect.height * 100; setCrop({ x: Math.min(cropStart.x, x), y: Math.min(cropStart.y, y), w: Math.abs(x - cropStart.x), h: Math.abs(y - cropStart.y) }); }}
                onPointerUp={() => setCropStart(null)}>
                <img src={pendingSrc} alt="Image to analyse" style={{ transform: `rotate(${rotation}deg) scale(${zoom})` }} />
                {crop && <div className="crop-rect" style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }} />}
              </div>
              <div className="editor-tools" role="toolbar" aria-label="Image editing tools">
                <label className="tool-label">Zoom <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Preview zoom" /></label>
                <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate 90 degrees"><RotateCw size={15} /> Rotate</button>
                <button type="button" className={cropping ? "active" : ""} onClick={() => { setCropping(!cropping); if (cropping) setCrop(null); }} aria-pressed={cropping}><CropIcon size={15} /> Crop</button>
                {crop && <button type="button" onClick={() => setCrop(null)}>Clear crop</button>}
                <button type="button" onClick={() => { setPendingSrc(null); setCrop(null); setRotation(0); }} aria-label="Remove image"><X size={15} /> Remove</button>
              </div>
            </div>
          )}
          {editorError && <p className="visual-error" role="alert">{editorError}</p>}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="visually-hidden" onChange={(e) => void acceptFile(e.target.files?.[0])} aria-hidden tabIndex={-1} />
        </section>

        <section className="visual-controls" aria-label="Analysis settings">
          <input className="visual-question" placeholder="What would you like to understand about this image?" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} aria-label="Question about the image" />
          <div className="visual-selects">
            <div className="mode-row" role="radiogroup" aria-label="Explanation mode">
              {MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} title={m.hint} className={`chip ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)}>{m.label}</button>)}
            </div>
            <div className="visual-selects-row">
              <label>Depth
                <select value={depth} onChange={(e) => setDepth(e.target.value as "beginner" | "intermediate" | "advanced" | "technical")} aria-label="Explanation depth">
                  {DEPTHS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
              <label>Language
                <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Explanation language">
                  {(info.data?.languages ?? [{ code: "en", label: "English" }]).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </label>
              <button type="button" className="primary" disabled={!pendingSrc || running || !info.data?.configured} onClick={() => void beginAnalysis()}>
                {running ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {running ? "Analyzing…" : "Analyze image"}
              </button>
              {running && <button type="button" className="ghost" onClick={cancelAnalysis}>Cancel</button>}
            </div>
          </div>
          {streamStatus && <p className="visual-status" aria-live="polite"><Loader2 size={13} className="spin" /> {streamStatus}</p>}
          {streamError && <p className="visual-error" role="alert">{streamError}</p>}
        </section>

        {result && imageUrl && (
          <section className="visual-result" aria-label="Visual analysis result">
            <div className="result-grid">
              <div className="result-image-pane">
                <div className="image-view-toggle" role="tablist" aria-label="Image view">
                  {(["annotated", "original", "side"] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} className={`chip ${view === v ? "active" : ""}`} onClick={() => setView(v)}>{v === "annotated" ? "Annotated" : v === "original" ? "Original" : "Side by side"}</button>)}
                  <button type="button" className="chip" onClick={() => setShowOverlay(!showOverlay)} aria-pressed={showOverlay}>{showOverlay ? <EyeOff size={13} /> : <Eye size={13} />} {showOverlay ? "Hide labels" : "Show labels"}</button>
                </div>
                <div className={`image-stage ${view === "side" ? "side" : ""}`}>
                  <div className="stage-frame" style={{ transform: `scale(${zoom})` }}>
                    <img src={imageUrl} alt="Original" />
                    {showOverlay && view !== "original" && <div className="overlay-holder" aria-hidden dangerouslySetInnerHTML={{ __html: result.overlaySvg }} />}
                    {showOverlay && view !== "original" && regions.map((region, i) => (
                      <div key={i} className={`interactive-region ${highlight === i ? "hot" : ""} ${typeof region.confidence === "number" && region.confidence < 0.5 ? "uncertain" : ""}`}
                        style={{ left: `${region.bbox[0] * 100}%`, top: `${region.bbox[1] * 100}%`, width: `${region.bbox[2] * 100}%`, height: `${region.bbox[3] * 100}%`, borderColor: PALETTE[i % PALETTE.length] }}
                        onMouseEnter={() => setHighlight(i)} onMouseLeave={() => setHighlight(null)} role="button" tabIndex={0}
                        aria-label={`Region ${i + 1}: ${region.label}`}
                        onClick={() => setHighlight(i)} onKeyDown={(e) => { if (e.key === "Enter") setHighlight(i); }} />
                    ))}
                  </div>
                  {view === "side" && <div className="stage-frame"><img src={imageUrl} alt="Annotated original" /></div>}
                </div>
                <div className="image-tools">
                  <label className="tool-label">Zoom <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Result zoom" /></label>
                  <button type="button" onClick={downloadAnnotated}><Download size={15} /> Download annotated</button>
                  {result.diagramSvg && <button type="button" onClick={downloadDiagram}><Download size={15} /> Diagram SVG</button>}
                </div>
              </div>

              <div className="result-explanation-pane">
                <div className="result-meta"><span className={`provider-dot ${info.data?.configured ? "on" : ""}`} /> {result.provider} · {result.model} · {result.analysis.imageType}</div>
                <Streamdown className="visual-summary">{result.analysis.summary}</Streamdown>

                {result.analysis.steps.length > 0 && (
                  <ol className="step-list">
                    {result.analysis.steps.map((step) => (
                      <li key={step.n} className={highlight === (step.regionIndex ?? -1) && step.regionIndex != null ? "hot" : ""}
                        onMouseEnter={() => step.regionIndex != null && setHighlight(step.regionIndex)} onMouseLeave={() => setHighlight(null)}>
                        <span className="step-n">{step.n}</span>
                        <span><Streamdown>{step.text}</Streamdown></span>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="evidence-blocks">
                  {result.analysis.visible.length > 0 && <div className="evidence-block visible"><strong>Visible in the image</strong><ul>{result.analysis.visible.map((v, i) => <li key={i}>{v}</li>)}</ul></div>}
                  {result.analysis.inferred.length > 0 && <div className="evidence-block inferred"><strong>Inferred (not directly visible)</strong><ul>{result.analysis.inferred.map((v, i) => <li key={i}>{v}</li>)}</ul></div>}
                  {result.analysis.uncertainties.length > 0 && <div className="evidence-block uncertain"><strong>Uncertainties</strong><ul>{result.analysis.uncertainties.map((v, i) => <li key={i}>{v}</li>)}</ul></div>}
                </div>

                {result.analysis.textRegions.length > 0 && (
                  <details className="ocr-details"><summary><ScanText size={14} /> Text found in the image ({result.analysis.textRegions.length})</summary>
                    <ul className="text-region-list">{result.analysis.textRegions.map((t, i) => <li key={i} className={t.ambiguous ? "ambiguous" : ""}>{t.text}{t.ambiguous ? " (uncertain)" : ""}</li>)}</ul>
                  </details>
                )}

                {ocrText && (
                  <details className="ocr-details" open><summary><FileText size={14} /> Full OCR transcription</summary><pre className="ocr-output">{ocrText}</pre></details>
                )}
                <div className="ocr-actions">
                  {imageMeta && <button type="button" className="ghost" onClick={() => void runOcr()} disabled={ocrLoading || !info.data?.configured}>{ocrLoading ? <Loader2 size={14} className="spin" /> : <ScanText size={14} />} Extract all text (OCR)</button>}
                </div>

                {result.diagramSvg && (
                  <div className="diagram-card">
                    <div className="eyebrow">Simplified diagram</div>
                    <div className="diagram-holder" dangerouslySetInnerHTML={{ __html: result.diagramSvg }} />
                  </div>
                )}

                {result.analysis.followUpQuestions.length > 0 && (
                  <div className="followup-suggestions">
                    <div className="eyebrow">Keep exploring</div>
                    {result.analysis.followUpQuestions.map((q, i) => <button key={i} type="button" className="chip" onClick={() => { setFollowupInput(q); }}>{q}</button>)}
                  </div>
                )}

                <div className="followup-area">
                  {followups.map((f, i) => (
                    <div className="followup-item" key={i}>
                      <div className="followup-q">{f.question}</div>
                      <Streamdown>{f.answer}</Streamdown>
                      {f.uncertainties?.length ? <p className="followup-uncertain">Uncertainties: {f.uncertainties.join("; ")}</p> : null}
                    </div>
                  ))}
                  {followupMut.isPending && <p className="visual-status"><Loader2 size={13} className="spin" /> Thinking about your question…</p>}
                  <div className="followup-input-row">
                    <input value={followupInput} onChange={(e) => setFollowupInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitFollowup(); }} placeholder="Ask a follow-up about this image…" maxLength={1000} aria-label="Follow-up question" />
                    <button type="button" className="primary" onClick={submitFollowup} disabled={followupInput.trim().length < 3 || followupMut.isPending || !info.data?.configured}>Ask</button>
                  </div>
                </div>

                <div className="result-footer">
                  <div className="feedback-row" aria-label="Was this explanation helpful?">
                    <span>Helpful?</span>
                    {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`chip ${rating === n ? "active" : ""}`} aria-label={`Rate ${n} of 5`} onClick={() => { setRating(n); feedbackMut.mutate({ analysisId: result.analysisId, rating: n }); }}>{n}</button>)}
                  </div>
                  <button type="button" className="ghost" onClick={() => setVerifyOpen(!verifyOpen)}><Search size={14} /> Verify with TruthSearch</button>
                  {imageMeta && me.data && <button type="button" className="ghost danger" onClick={() => { deleteMut.mutate({ id: result.analysisId }, { onSuccess: () => { setResult(null); setImageMeta(null); void history.refetch(); } }); }}><Trash2 size={14} /> Delete session & image</button>}
                </div>
                {verifyOpen && (
                  <div className="verify-card">
                    <div className="eyebrow">Verify concepts from this image with live web research</div>
                    <div className="followup-input-row">
                      <input value={verifyQuestion} onChange={(e) => setVerifyQuestion(e.target.value)} placeholder="What should TruthSearch verify?" aria-label="Verification question" />
                      <button type="button" className="primary" disabled={verifyQuestion.trim().length < 8 || verifyMut.isPending} onClick={() => void verifyMut.mutateAsync({ sessionId: result.analysisId, question: verifyQuestion.trim() })}>{verifyMut.isPending ? "Researching…" : "Research"}</button>
                    </div>
                    {verifyMut.data && (
                      <div className="verify-result">
                        <Streamdown>{verifyMut.data.answer}</Streamdown>
                        <ul className="verify-sources">{verifyMut.data.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title} <small>{s.domain}</small></a></li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
