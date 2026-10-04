import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Camera as CameraIcon,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  FileUp,
  FileText,
  FlaskConical,
  GitBranch,
  Loader2,
  Menu,
  Moon,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { rankSources as rlRank, reward as rlReward, summary as rlSummary } from "@/learning/bandit";
import CameraCapture from "@/components/CameraCapture";

const examples = [
  "Latest AI research",
  "How reliable are AI agents?",
  "Explain RAG",
  "Why do LLMs hallucinate?",
];
const stages = ["planning", "searching", "fetching", "ranking", "verifying", "completed"];
const stageLabels: Record<string, string> = {
  planning: "Planning research",
  searching: "Searching sources",
  fetching: "Fetching evidence",
  ranking: "Ranking sources",
  verifying: "Verifying claims",
  completed: "Synthesis complete",
};
const stageIcons = [BookOpen, Search, FileText, GitBranch, ShieldCheck, Check];

type Source = { id: number; title: string; url: string; canonicalUrl?: string; domain: string; sourceType: string; qualityScore: number; author?: string | null; publicationDate?: string | null };
type Evidence = { quote?: string; url?: string; title?: string; supportScore?: number; qualityScore?: number; claim?: string };
type Conflict = { description: string; supporting?: Array<{ url?: string; title?: string }>; contradicting?: Array<{ url?: string; title?: string }> };
type ResearchMode = "quick" | "deep" | "academic" | "verify" | "image";
type ClaimStatus = "verified" | "partial" | "conflicting" | "insufficient";
const modes: Array<{ id: ResearchMode; label: string; hint: string }> = [
  { id: "quick", label: "Quick search", hint: "Fast multi-source answer" },
  { id: "deep", label: "Deep research", hint: "More queries, more sources" },
  { id: "academic", label: "Academic", hint: "Papers and scholarly sources" },
  { id: "verify", label: "Verify a claim", hint: "Fact-check with a verdict" },
  { id: "image", label: "Generate image", hint: "Create a picture from a prompt" },
];
const statusLabels: Record<ClaimStatus, string> = { verified: "Verified", partial: "Partially supported", conflicting: "Conflicting evidence", insufficient: "Insufficient evidence" };
type Attachment = { id: string; file: File; preview?: string; error?: string };

function fileToDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("We couldn't read that file. Try another file.")); r.readAsDataURL(file); }); }
// Keyless in-browser OCR (Tesseract WASM, no API key, nothing leaves the
// device except the research question itself) so photos of text — LeetCode
// screenshots, problem statements, slides — are readable even when no vision
// model is configured on the server. Best effort: failures just skip OCR.
let ocrWorker: { recognize: (img: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null = null;
async function ocrImageText(dataUrl: string): Promise<string> {
  try {
    if (!ocrWorker) {
      const mod: any = await import("tesseract.js");
      ocrWorker = await mod.createWorker("eng");
    }
    const { data } = await ocrWorker.recognize(dataUrl);
    return (data?.text || "").trim();
  } catch {
    return "";
  }
}

async function resizeToDataUrl(file: File, max: number): Promise<string> { const dataUrl = await fileToDataUrl(file); try { const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("bad image")); i.src = dataUrl; }); const scale = Math.min(1, max / Math.max(img.width, img.height)); const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale); const ctx = canvas.getContext("2d"); if (!ctx) return dataUrl; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/jpeg", 0.85); } catch { return dataUrl; } }
function escapeHtml(text: string) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function Quality({ score, onClick }: { score: number; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="quality-score" aria-label={`Source quality ${score} out of 100`}><span>{score}</span><small>/100</small></button>;
}

function Logo() {
  return <div className="brand"><span className="brand-mark"><Sparkles size={16} /></span><span>TruthSearch</span></div>;
}

function Progress({ data, latestProgress, activeStage }: { data: any; latestProgress: string; activeStage: number }) {
  return <div className="progress-card" aria-live="polite">
    <div className="eyebrow">Research progress</div>
    <div className="progress-list">
      {stages.map((stage, i) => { const Icon = stageIcons[i]; const done = data?.session?.status === "completed" || i < activeStage; const active = !done && i === activeStage; return <div className={`progress-item ${done ? "done" : ""} ${active ? "active" : ""}`} key={stage}><span className="progress-icon">{done ? <Check size={14} /> : active ? <Loader2 size={14} className="spin" /> : <Icon size={14} />}</span><div><strong>{stageLabels[stage]}</strong><p>{active ? latestProgress : done ? "Evidence step complete" : i === activeStage + 1 ? "Waiting for verification" : "Queued"}</p></div></div>; })}
    </div>
  </div>;
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<ResearchMode>("quick");
  const [followup, setFollowup] = useState("");
  const [followups, setFollowups] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [expandedSource, setExpandedSource] = useState<number | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [attachmentsProcessing, setAttachmentsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<"" | "up" | "down">("");
  const start = trpc.research.start.useMutation({ onSuccess: (data) => { setFeedback(""); setSessionId(data.id); } });
  const attachImage = trpc.research.attachImage.useMutation();
  const extractDocument = trpc.research.extractDocument.useMutation();
  const followUp = trpc.research.followUp.useMutation({ onSuccess: (data) => { setFollowups((items) => [...items, followup.trim()]); setFollowup(""); setSessionId(data.id); } });
  const history = trpc.research.list.useQuery({ limit: 20 });
  const session = trpc.research.get.useQuery({ id: sessionId || 0 }, { enabled: Boolean(sessionId), refetchInterval: (query) => query.state.data?.session.status === "completed" || query.state.data?.session.status === "failed" ? false : 1200 });
  const plan = trpc.research.plan.useQuery({ question: question || "Research a question with live sources", mode }, { enabled: question.length >= 8 });
  const providerStatus = trpc.research.providers.useQuery();
  const [authModal, setAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const [assignMenuId, setAssignMenuId] = useState<number | null>(null);
  const me = trpc.auth.me.useQuery();
  const user = me.data ?? null;
  const login = trpc.auth.login.useMutation({ onSuccess: () => { setAuthModal(false); setAuthEmail(""); setAuthPassword(""); setAuthName(""); void me.refetch(); void history.refetch(); } });
  const register = trpc.auth.register.useMutation({ onSuccess: () => { setAuthModal(false); setAuthEmail(""); setAuthPassword(""); setAuthName(""); void me.refetch(); void history.refetch(); } });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { void me.refetch(); setSelectedCollection(null); } });
  const collections = trpc.collections.list.useQuery(undefined, { enabled: Boolean(user) });
  const createCollectionMut = trpc.collections.create.useMutation({ onSuccess: () => void collections.refetch() });
  const removeCollection = trpc.collections.remove.useMutation({ onSuccess: () => void collections.refetch() });
  const assignToCollection = trpc.collections.assign.useMutation({ onSuccess: () => { void collections.refetch(); void history.refetch(); } });
  const data = session.data as any;
  const sources = (data?.sources || []) as Source[];
  const evidence = (data?.session?.plan?.evidence || data?.evidence || []) as Evidence[];
  const rankedSources = rlRank(sources);
  const rankedEvidence = rlRank(evidence as unknown as { domain?: string; qualityScore?: number }[]) as unknown as Evidence[];
  const conflicts = (data?.session?.plan?.conflicts || []) as Conflict[];
  const claimStatuses = ((data?.session?.plan?.claimStatuses as ClaimStatus[] | undefined) || evidence.map(() => "verified" as ClaimStatus));
  const latestProgress = data?.messages?.filter((m: any) => m.role === "system").at(-1)?.content || "Ready for a question";
  const activeStage = Math.max(0, stages.findIndex((s) => latestProgress.toLowerCase().includes(s)));
  const visibleHistory = (history.data || []).filter((item) => selectedCollection === null || item.collectionId === selectedCollection);
  const confidence = Math.round(evidence.length ? evidence.slice(0, 6).reduce((sum, item) => sum + (item.supportScore || item.qualityScore || 70), 0) / Math.min(evidence.length, 6) : 0);

  useEffect(() => { if (start.error) setSessionId(null); }, [start.error]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); document.getElementById("research-input")?.focus(); } if (e.key === "Escape") { setSelectedSource(null); setSidebarOpen(false); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (start.isPending || attachmentsProcessing) return;
    const q = question.trim();
    if (q.length < 8) return;
    if (!attachments.length) { setSessionId(null); start.mutate({ question: q, mode }); return; }
    void processAndStart(q);
  };
  const processAndStart = async (q: string) => {
    setAttachmentsProcessing(true);
    setAttachmentError("");
    try {
      const imageUrls: string[] = [];
      const documentTexts: string[] = [];
      for (const item of attachments) {
        if (item.file.type.startsWith("image/")) {
          const dataUrl = await resizeToDataUrl(item.file, 1568);
          const result = await attachImage.mutateAsync({ filename: item.file.name, dataUrl });
          if (result.url) imageUrls.push(result.url);
          // Extract any text in the photo with in-browser OCR so the research
          // pipeline can read the question even without a vision model key.
          if (typeof document !== "undefined") {
            const ocrText = await ocrImageText(dataUrl);
            if (ocrText.length > 30) documentTexts.push(`--- OCR text extracted from image "${item.file.name}" in the browser (may contain recognition errors) ---\n${ocrText.slice(0, 20000)}`);
          }
        } else {
          const dataUrl = await fileToDataUrl(item.file);
          const result = await extractDocument.mutateAsync({ filename: item.file.name, dataUrl });
          documentTexts.push(`--- ${item.file.name} ---\n${result.text}`);
        }
      }
      setSessionId(null);
      start.mutate({ question: q, mode, ...(documentTexts.length ? { contextText: documentTexts.join("\n\n").slice(0, 60000) } : {}), ...(imageUrls.length ? { imageUrls } : {}) });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "We couldn't process the attachments. Try again.");
    } finally { setAttachmentsProcessing(false); }
  };
  const submitFollowup = (text = followup) => { if (sessionId && text.trim().length >= 8) followUp.mutate({ id: sessionId, question: text.trim() }); };
  const sourceEvidence = selectedSource ? evidence.find((item) => item.url === selectedSource.canonicalUrl || item.url === selectedSource.url || item.title === selectedSource.title) : null;
  const addFiles = (fileList: FileList | File[] | null, kind: "document" | "photo" = "document") => {
    if (!fileList) return;
    setAttachmentError("");
    const next: Attachment[] = [];
    Array.from(fileList as ArrayLike<File>).forEach((file) => {
      const isPhoto = file.type.startsWith("image/");
      const allowed = kind === "photo" ? ["image/jpeg", "image/png", "image/webp"] : ["application/pdf", "text/plain", "text/csv", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
      if (!allowed.includes(file.type) && !(kind === "document" && /\.(pdf|txt|csv|doc|docx|xlsx)$/i.test(file.name))) { setAttachmentError(`${file.name}: That file type isn't supported yet.`); return; }
      if (file.size > 20 * 1024 * 1024) { setAttachmentError(`${file.name}: Files must be smaller than 20 MB.`); return; }
      next.push({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, preview: isPhoto ? URL.createObjectURL(file) : undefined });
    });
    setAttachments((current) => [...current, ...next].slice(0, 8));
    setAttachmentMenuOpen(false);
  };
  const removeAttachment = (id: string) => setAttachments((current) => { const item = current.find((x) => x.id === id); if (item?.preview) URL.revokeObjectURL(item.preview); return current.filter((x) => x.id !== id); });
  const exportReport = () => {
    const sessionData = data?.session; if (!sessionData?.answer) return;
    const summary = sessionData.plan?.claimSummary as { verified: number; partial: number; conflicting: number; insufficient: number } | undefined;
    const audit = sessionData.plan?.citationAudit as { citationCoverage?: number; invalidReferences?: number[] } | undefined;
    const provenance = sessionData.plan?.answerProvenance as string | undefined;
    const modeLabel = (sessionData.plan?.modeLabel as string) || "Quick search";
    const claimRows = evidence.map((item, i) => `<li><strong>[${i + 1}] ${escapeHtml(statusLabels[claimStatuses[i] || "verified"])}</strong> — ${escapeHtml(String(item.claim || item.quote || "").slice(0, 300))}<br/><small>Source: ${escapeHtml(String(item.title || ""))} — ${escapeHtml(String(item.url || ""))}</small></li>`).join("");
    const sourceRows = sources.map((src) => `<li>${escapeHtml(src.title)} — ${escapeHtml(src.domain)} (quality ${src.qualityScore}/100)<br/><small>${escapeHtml(src.url)}</small></li>`).join("");
    const conflictRows = conflicts.map((c) => `<p>${escapeHtml(c.description)}</p>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>TruthSearch Research Report</title><style>
      body { font-family: Georgia, 'Times New Roman', serif; max-width: 760px; margin: 0 auto; padding: 48px 24px; color: #1a1a2e; line-height: 1.6; }
      h1 { font-size: 26px; margin-bottom: 4px; } h2 { font-size: 17px; margin-top: 32px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      .meta { color: #666; font-size: 13px; font-family: -apple-system, sans-serif; }
      .answer { background: #f7f8fa; padding: 20px 24px; border-radius: 8px; font-size: 14.5px; }
      .answer pre { white-space: pre-wrap; font-family: inherit; }
      ul, ol { padding-left: 20px; } li { margin: 8px 0; }
      .verdict { padding: 10px 14px; border-left: 3px solid #4f46e5; background: #f4f4fb; font-family: -apple-system, sans-serif; font-size: 13px; }
      @media print { body { padding: 0; } }
    </style></head><body>
      <h1>TruthSearch Research Report</h1>
      <p class="meta">${escapeHtml(sessionData.question)} · ${modeLabel} · generated ${new Date().toLocaleString()} · session #${sessionId}</p>
      <h2>Answer</h2>
      ${provenance === "model_knowledge" ? '<p class="verdict">Answered from the model\u2019s knowledge — no usable web sources were retrieved, so nothing is web-cited.</p>' : ""}
      <div class="answer"><pre>${escapeHtml(sessionData.answer)}</pre></div>
      <h2>Evidence trail</h2>
      ${summary ? `<p class="meta">${summary.verified} verified · ${summary.partial} partially supported · ${summary.conflicting} conflicting${summary.insufficient ? " · insufficient evidence" : ""}</p>` : ""}
      <ol>${claimRows || "<li>No verified evidence passages were retrieved.</li>"}</ol>
      ${conflictRows ? `<h2>Conflicting evidence</h2>${conflictRows}` : ""}
      <h2>Sources</h2>
      <ol>${sourceRows || "<li>None</li>"}</ol>
      <p class="meta">Citation audit: ${(audit?.citationCoverage ? Math.round(audit.citationCoverage * 100) : 0)}% of factual lines carry citations${audit?.invalidReferences?.length ? "; invalid references were rejected before delivery" : "; no invalid references"}. Report generated by TruthSearch — evidence before certainty.</p>
    </body></html>`;
    const win = window.open("", "_blank");
    if (!win) { window.alert("Allow pop-ups to export the report, then use your browser\u2019s Print → Save as PDF."); return; }
    win.document.write(html); win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch { /* user can print manually */ } }, 400);
  };

  return <div className={dark ? "app dark chat-shell" : "app chat-shell"}>
    <aside className="chat-sidebar" aria-label="Saved research">
      <div className="chat-sidebar-head"><Logo /><button type="button" className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button></div>
      <button className="sidebar-new" onClick={() => { setSessionId(null); setQuestion(""); setFollowups([]); }}><Plus size={15} /> New research</button>
      {user ? <div className="account-row"><div className="account-avatar">{(user.name || user.email || "?").slice(0, 1).toUpperCase()}</div><div className="account-info"><strong>{user.name}</strong><small>{user.email}</small></div><button type="button" className="account-signout" onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</button></div> : <button type="button" className="signin-button" onClick={() => setAuthModal(true)}>Sign in · save your research</button>}
      <nav className="sidebar-section sidebar-scroll" aria-label="Recent research">{user ? <div className="collections-block"><div className="eyebrow">Collections</div><div className="collection-list"><button type="button" className={`collection-item ${selectedCollection === null ? "active" : ""}`} onClick={() => setSelectedCollection(null)}>All research</button>{(collections.data || []).map((c) => <div className={`collection-item ${selectedCollection === c.id ? "active" : ""}`} key={c.id} onClick={() => setSelectedCollection(c.id)}><span>{c.name}</span><small>{c.sessionCount}</small><button type="button" className="collection-delete" onClick={(e) => { e.stopPropagation(); removeCollection.mutate({ id: c.id }); if (selectedCollection === c.id) setSelectedCollection(null); }} aria-label={`Delete collection ${c.name}`}><X size={11} /></button></div>)}<form className="collection-new" onSubmit={(e) => { e.preventDefault(); const el = e.currentTarget.elements.namedItem("name") as HTMLInputElement | null; if (el?.value.trim()) { createCollectionMut.mutate({ name: el.value.trim() }); el.value = ""; } }}><input name="name" placeholder="New collection…" maxLength={120} aria-label="New collection name" /><button type="submit" aria-label="Create collection"><Plus size={13} /></button></form></div></div> : null}<div className="eyebrow">Saved research</div>{visibleHistory.length ? <div className="history-list">{visibleHistory.map((item) => <div className={`history-row ${item.id === sessionId ? "active" : ""}`} key={item.id}><button type="button" className="history-item" onClick={() => { setSessionId(item.id); setQuestion(item.title); setSidebarOpen(false); }}><strong>{item.title}</strong><small>{item.status === "completed" ? "Completed" : item.status === "failed" ? "Failed" : "In progress"}</small></button>{user && <button type="button" className="history-assign" onClick={() => setAssignMenuId(assignMenuId === item.id ? null : item.id)} aria-label="Move to collection"><Plus size={12} /></button>}{assignMenuId === item.id && <div className="assign-menu" role="menu">{collections.data?.length ? collections.data.map((c) => <button type="button" key={c.id} onClick={() => { assignToCollection.mutate({ sessionId: item.id, collectionId: c.id }); setAssignMenuId(null); }}>{item.collectionId === c.id ? "✓ " : ""}{c.name}</button>) : <span>Create a collection first.</span>}{item.collectionId !== null && item.collectionId !== undefined && <button type="button" onClick={() => { assignToCollection.mutate({ sessionId: item.id, collectionId: null }); setAssignMenuId(null); }}>Remove from collection</button>}</div>}</div>)}</div> : <p className="sidebar-empty">{user ? "Your prompts and answers are saved here automatically after each research." : "Sign in to keep your research history and collections synced across devices."}</p>}</nav>
      <div className="sidebar-foot">
        <div className="sidebar-section"><div className="eyebrow">RL learning</div>{(() => { const s = rlSummary(); return s.samples > 0 ? <p className="sidebar-empty">{s.samples} feedback {s.samples === 1 ? "sample" : "samples"} · best source: {s.top}</p> : <p className="sidebar-empty">Rate answers with Helpful / Not helpful — the app learns which sources to trust.</p>; })()}</div>
        <p className="sidebar-foot-meta">Evidence before certainty · {providerStatus.data?.knowledge?.filter((p: any) => p.enabled).length || 0} providers ready</p>
      </div>
    </aside>
    <button className="mobile-menu icon-button chat-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
    <main className="chat-main">
      {!sessionId ? <div className="chat-landing" id="research">
        <div className="chat-hero"><div className="eyebrow">Evidence before certainty</div><h1>Research anything.<br /><em>Verify everything.</em></h1><p>Search live sources, save every prompt, and verify what the sources actually say. Every prompt and answer is stored in your sidebar.</p></div>
      <section className="hero"><div className="eyebrow">Evidence before certainty</div><h1>Research anything.<br /><em>Verify everything.</em></h1><p>Search the web, compare evidence, and understand what the sources actually say.</p><form className={`search-shell composer ${attachmentMenuOpen ? "menu-open" : ""}`} onSubmit={submit} onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("drag-over")} onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); addFiles(e.dataTransfer.files); }}><input ref={fileInputRef} hidden type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xlsx" onChange={(e) => addFiles(e.target.files)} /><input ref={photoInputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => addFiles(e.target.files, "photo")} /><input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => addFiles(e.target.files, "photo")} />{attachments.length > 0 && <div className="attachment-list">{attachments.slice(0, 4).map((item) => <div className="attachment-chip" key={item.id}>{item.preview ? <button type="button" onClick={() => setPreviewAttachment(item)} aria-label={`Preview ${item.file.name}`}><img src={item.preview} alt="" /></button> : <FileUp size={16} />}<span title={item.file.name}>{item.file.name}</span><small>{formatBytes(item.file.size)}</small><button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Remove attachment ${item.file.name}`}><X size={14} /></button></div>)}{attachments.length > 4 && <span className="more-attachments">+{attachments.length - 4} more</span>}</div>}<div className="composer-row"><div className="attach-wrap"><button type="button" className="attach-button" onClick={() => setAttachmentMenuOpen(!attachmentMenuOpen)} aria-label="Add attachment" aria-expanded={attachmentMenuOpen}><Plus size={19} /></button>{attachmentMenuOpen && <div className="attachment-menu" role="menu"><button type="button" onClick={() => fileInputRef.current?.click()}><FileUp size={16} /> Add document</button><button type="button" onClick={() => photoInputRef.current?.click()}><Paperclip size={16} /> Select photo</button><button type="button" onClick={() => { setAttachmentMenuOpen(false); setCameraOpen(true); }}><CameraIcon /> Take photo</button><span>Files stay in this composer until research starts.</span></div>}</div><textarea id="research-input" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder={attachments.length ? "Ask anything about these files..." : "Ask anything..."} aria-label="Research question" rows={1} />{question && <button type="button" className="clear-search" onClick={() => setQuestion("")} aria-label="Clear research question"><X size={15} /></button>}<button type="submit" disabled={start.isPending || attachmentsProcessing || question.trim().length < 8}>{start.isPending || attachmentsProcessing ? <Loader2 className="spin" size={17} /> : <ArrowUpRight size={18} />}<span>Research</span></button></div><div className="mode-chips" role="radiogroup" aria-label="Research mode">{modes.map((m) => <button type="button" key={m.id} className={m.id === mode ? "mode-chip active" : "mode-chip"} onClick={() => setMode(m.id)} role="radio" aria-checked={m.id === mode} title={m.hint}>{m.label}</button>)}</div>{attachmentsProcessing && <div className="attachment-processing" role="status"><Loader2 className="spin" size={14} />Processing attachments — uploading images, running in-browser OCR and extracting document text…</div>}{attachmentError && <div className="attachment-error" role="alert"><CircleAlert size={14} />{attachmentError}</div>}</form>{start.error && <div className="error-message"><CircleAlert size={15} />{start.error.message}</div>}<div className="suggestions"><span>Try asking</span>{examples.map((x) => <button key={x} onClick={() => setQuestion(x)} type="button">{x}</button>)}</div></section>
        {start.error && <div className="error-message"><CircleAlert size={15} />{start.error.message}</div>}
        <section className="pipeline" id="how-it-works">{[[BookOpen, "Question", "Define what needs to be known."], [Search, "Search", "Find relevant live sources."], [ShieldCheck, "Verify", "Check claims against passages."], [FlaskConical, "Synthesize", "Make uncertainty visible."]].map(([Icon, label, detail]) => { const I = Icon as typeof BookOpen; return <div className="pipeline-step" key={label as string}><div className="pipeline-icon"><I size={17} /></div><div><strong>{label as string}</strong><p>{detail as string}</p></div></div>; })}</section>
      </div> : <div className="chat-workspace">
      <div className="workspace-head"><button className="back-button" onClick={() => { setSessionId(null); setQuestion(""); }}><ArrowLeft size={16} /> New research</button><div className="status-pill"><span className="status-dot" />{data?.session?.status === "completed" ? "Research complete" : data?.session?.status === "failed" ? "Research interrupted" : `Researching ${sources.length ? `· ${sources.length} sources` : ""}`}</div>{data?.session?.status === "completed" && <button type="button" className="export-report" onClick={exportReport}><FileText size={14} /> Export report</button>}</div>
      <div className="question-row"><div><div className="eyebrow">Current research question</div><h1>{data?.session?.question || question}</h1></div><span className="session-label">Session {sessionId}</span></div>
        <div className="chat-progress"><Progress data={data} latestProgress={latestProgress} activeStage={activeStage} />{data?.session?.plan?.queries?.length > 0 && <div className="mini-card"><div className="eyebrow">Search plan</div>{data.session.plan.queries.map((q: string) => <p key={q}>{q}</p>)}</div>}</div>
        <section className="results thread">
        <div className="thread-user"><div className="eyebrow">You</div><p>{followups.length ? followups[followups.length - 1] : data?.session?.question || question}</p>{attachments.length > 0 && <div className="thread-attachments">{attachments.map((item) => <span key={item.id}>{item.preview ? <img src={item.preview} alt="" /> : <FileText size={13} />} {item.file.name}</span>)}</div>}</div>
        <div className="thread-ai"><div className="ai-byline"><span className="brand-mark"><Sparkles size={13} /></span><strong>TruthSearch</strong><span>{data?.session?.status === "completed" ? "Research answer" : "Researching..."}</span></div>
        {data?.session?.plan?.answerProvenance === "model_knowledge" && <div className="alert-card conflict-card"><CircleAlert size={19} /><div><strong>Answered from model knowledge.</strong><p>Web research found no usable sources for this question, so the answer is not web-cited. Verify important facts independently.</p></div></div>}
        {data?.session?.plan?.answerProvenance === "technical_direct" && <div className="alert-card conflict-card"><FlaskConical size={19} /><div><strong>Technical answer with research.</strong><p>Answered from the model\u2019s expertise with retrieved evidence cited where it helps.</p></div></div>}
        {data?.session?.status === "failed" && <div className="alert-card error-card"><CircleAlert size={19} /><div><strong>Research couldn’t be completed.</strong><p>Some sources could not be retrieved. Your available evidence is still shown below.</p><button onClick={() => submit()}>Retry</button></div></div>}
        {data?.session?.answer && rankedSources.length > 0 && <div className="source-strip"><span className="eyebrow">Sources</span>{rankedSources.slice(0, 5).map((source) => <button key={source.id} onClick={() => setSelectedSource(source)}>{source.domain}</button>)}{sources.length > 5 && <span>+{sources.length - 5}</span>}</div>}
        {data?.session?.answer && <article className="answer-panel document-answer"><div className="panel-heading"><div><div className="eyebrow">Answer</div><h2>Evidence-backed conclusion</h2></div><div className="confidence"><span>Overall confidence</span><strong>{confidence}%</strong><div className="confidence-bar"><i style={{ width: `${confidence}%` }} /></div></div></div><div className="answer-copy"><Streamdown>{data.session.answer}</Streamdown></div></article>}{data?.session?.answer && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="eyebrow mr-1">Rate this answer — the app learns from it</span>
              <button type="button" disabled={!!feedback} onClick={() => { rlReward(rankedSources.map((s) => s.domain), 1); setFeedback("up"); }} className="inline-flex items-center gap-1.5 rounded-full border border-input bg-card px-4 py-1.5 hover:bg-accent disabled:opacity-50"><Check size={14} /> Helpful</button>
              <button type="button" disabled={!!feedback} onClick={() => { rlReward(rankedSources.map((s) => s.domain), -1); setFeedback("down"); }} className="inline-flex items-center gap-1.5 rounded-full border border-input bg-card px-4 py-1.5 hover:bg-accent disabled:opacity-50"><X size={14} /> Not helpful</button>
              {feedback === "up" && <span className="text-xs opacity-70">Saved — sources like these will rank higher next time.</span>}
              {feedback === "down" && <span className="text-xs opacity-70">Saved — these sources will rank lower next time.</span>}
            </div>}
        {data?.session?.answer && <div className="section-heading"><div><div className="eyebrow">Claim-level verification</div><h2>What the evidence says</h2></div><span>{(() => { const sum = data?.session?.plan?.claimSummary as { verified: number; partial: number; conflicting: number } | undefined; return sum ? `${sum.verified} verified · ${sum.partial} partial · ${sum.conflicting} conflicting` : `${evidence.length} verified passages`; })()}</span></div>}
        {data?.session?.answer && <div className="claims">{rankedEvidence.slice(0, 5).map((item, i) => { const status = claimStatuses[i] || "verified"; return <details key={`${item.title}-${i}`}><summary><span className={`claim-status ${status}`}>{status === "verified" ? <Check size={13} /> : status === "conflicting" ? <CircleAlert size={13} /> : <FlaskConical size={13} />}{statusLabels[status]}</span><span>{item.claim || item.quote}</span><ChevronDown size={16} /></summary><div className="claim-detail"><strong>Claim #{i + 1}</strong><p>{item.quote}</p><span>{status === "verified" ? "Supported by a verified passage" : status === "partial" ? "Supported with partial evidence" : status === "conflicting" ? "Sources disagree on this claim" : "Not enough evidence"} · {item.supportScore || item.qualityScore || confidence}% confidence</span></div></details>; })}</div>}
        {conflicts.length > 0 && <div className="conflict-card"><div className="conflict-title"><CircleAlert size={18} /><div><div className="eyebrow">Conflicting evidence</div><h2>Sources disagree</h2></div></div><p>{conflicts[0].description}</p><div className="conflict-columns"><div><strong>Supporting</strong>{(conflicts[0].supporting || []).map((x, i) => <span key={i}><Check size={13} />{x.title || x.url}</span>)}</div><div><strong>Contradicting</strong>{(conflicts[0].contradicting || []).map((x, i) => <span key={i}><CircleAlert size={13} />{x.title || x.url}</span>)}</div></div></div>}
        {sources.length > 0 ? <section className="evidence-section"><div className="section-heading"><div><div className="eyebrow">Evidence library</div><h2>Sources behind the answer</h2></div><span>{sources.length} sources</span></div><div className="evidence-grid">{sources.map((source, i) => { const item = evidence.find((e) => e.url === source.canonicalUrl || e.url === source.url || e.title === source.title); return <article className="evidence-card" key={source.id}><div className="source-meta"><span>{source.sourceType}</span><Quality score={source.qualityScore} onClick={() => setSelectedSource(source)} /></div><h3>{source.title}</h3><p className="domain">{source.domain}{source.publicationDate ? ` · ${source.publicationDate}` : ""}</p>{item?.quote && <blockquote>{item.quote}</blockquote>}<div className="card-actions"><button onClick={() => setSelectedSource(source)}><FileText size={14} /> Inspect evidence</button><a href={source.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={14} /></a><button aria-label="Copy citation" onClick={() => navigator.clipboard?.writeText(`${source.title} — ${source.url}`)}><Clipboard size={14} /></button></div></article>; })}</div></section> : data?.session?.status !== "failed" && <div className="empty-state"><Loader2 className="spin" size={22} /><h2>Researching in the open</h2><p>{latestProgress}</p></div>}
        {data?.session?.answer && <div className="trace-wrap"><button className="trace-toggle" onClick={() => setShowTrace(!showTrace)}><GitBranch size={16} />View research process<ChevronDown className={showTrace ? "rotate" : ""} size={16} /></button>{showTrace && <div className="trace"><span>Question</span><span>Research plan</span><span>Search queries</span><span>Sources found</span><span>Evidence extracted</span><span>Claim verification</span><span>Final answer</span></div>}</div>}
        </div>
        {data?.session?.answer && <div className="followup-area"><div className="eyebrow">Continue the research</div><div className="followup-suggestions">{["What are the strongest sources?", "Which sources disagree?", "Can you explain this simply?", "What has changed recently?"].map((suggestion) => <button key={suggestion} onClick={() => submitFollowup(suggestion)} disabled={followUp.isPending}>{suggestion}</button>)}</div><form className="followup-composer" onSubmit={(e) => { e.preventDefault(); submitFollowup(); }}><textarea value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Ask a follow-up..." aria-label="Ask a follow-up question" rows={1} /><button type="submit" disabled={followUp.isPending || followup.trim().length < 8}>{followUp.isPending ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={17} />}</button></form></div>}
        </section>
      </div>}
    </main>
    {authModal && <div className="auth-backdrop" onClick={() => setAuthModal(false)}><div className="auth-modal" onClick={(e) => e.stopPropagation()}>
      <div className="eyebrow">{authMode === "login" ? "Welcome back" : "Create your account"}</div>
      <h3>{authMode === "login" ? "Sign in to TruthSearch" : "Save your research, forever"}</h3>
      <p>Accounts keep your research history, collections, and feedback synced across devices.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (authMode === "login") login.mutate({ email: authEmail, password: authPassword }); else register.mutate({ email: authEmail, password: authPassword, ...(authName.trim() ? { name: authName.trim() } : {}) }); }}>
        {authMode === "register" && <input type="text" placeholder="Name (optional)" value={authName} onChange={(e) => setAuthName(e.target.value)} autoComplete="name" maxLength={80} />}
        <input type="email" required placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} autoComplete="email" />
        <input type="password" required minLength={authMode === "register" ? 8 : 1} placeholder={authMode === "register" ? "Password (8+ characters)" : "Password"} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} />
        {(login.error || register.error) && <div className="auth-error" role="alert">{login.error?.message || register.error?.message}</div>}
        <button type="submit" disabled={login.isPending || register.isPending}>{login.isPending || register.isPending ? "One moment…" : authMode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <button type="button" className="auth-switch" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>{authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
    </div></div>}
    {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)}><aside className="mobile-sidebar" onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button><Logo /><button className="sidebar-new" onClick={() => { setSessionId(null); setQuestion(""); setSidebarOpen(false); }}><Sparkles size={15} /> New research</button><div className="eyebrow">Recent research</div>{history.data?.length ? <div className="history-list">{history.data.map((item) => <button type="button" className="history-item" key={item.id} onClick={() => { setSessionId(item.id); setSidebarOpen(false); }}><strong>{item.title}</strong><small>{item.status === "completed" ? "Completed" : item.status === "failed" ? "Failed" : "In progress"}</small></button>)}</div> : <p className="sidebar-empty">Your completed research will appear here.</p>}</aside></div>}
    {cameraOpen && <CameraCapture onClose={() => setCameraOpen(false)} onPickImage={() => { setCameraOpen(false); photoInputRef.current?.click(); }} onCapture={(file) => { setCameraOpen(false); addFiles([file], "photo"); }} />}
    {previewAttachment?.preview && <div className="preview-backdrop" onClick={() => setPreviewAttachment(null)}><div className="image-preview" role="dialog" aria-modal="true" aria-label={`Preview ${previewAttachment.file.name}`} onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setPreviewAttachment(null)} aria-label="Close image preview"><X size={18} /></button><img src={previewAttachment.preview} alt={previewAttachment.file.name} /><strong>{previewAttachment.file.name}</strong><span>{formatBytes(previewAttachment.file.size)}</span><button className="remove-preview" onClick={() => { removeAttachment(previewAttachment.id); setPreviewAttachment(null); }}>Remove attachment</button></div></div>}
    {selectedSource && <div className="drawer-backdrop" onClick={() => setSelectedSource(null)}><aside className="inspector" onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setSelectedSource(null)} aria-label="Close source inspector"><X size={18} /></button><div className="eyebrow">Source inspector</div><h2>{selectedSource.title}</h2><p className="domain">{selectedSource.domain} · {selectedSource.sourceType}</p><Quality score={selectedSource.qualityScore} /><hr /><div className="eyebrow">Relevant passage</div><blockquote>{sourceEvidence?.quote || "No verified exact passage was mapped to this source."}</blockquote>{sourceEvidence?.claim && <><div className="eyebrow">Claim supported</div><p>{sourceEvidence.claim}</p></>}<button className="primary-link" onClick={() => navigator.clipboard?.writeText(`${selectedSource.title} — ${selectedSource.url}`)}><Clipboard size={14} /> Copy citation</button><a className="primary-link" href={selectedSource.url} target="_blank" rel="noreferrer">Open original source <ArrowUpRight size={15} /></a></aside></div>}
  </div>;
}
