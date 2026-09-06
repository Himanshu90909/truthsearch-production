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
type Attachment = { id: string; file: File; preview?: string; error?: string };

function fileToDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("We couldn't read that file. Try another file.")); r.readAsDataURL(file); }); }
async function resizeToDataUrl(file: File, max: number): Promise<string> { const dataUrl = await fileToDataUrl(file); try { const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("bad image")); i.src = dataUrl; }); const scale = Math.min(1, max / Math.max(img.width, img.height)); const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale); const ctx = canvas.getContext("2d"); if (!ctx) return dataUrl; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/jpeg", 0.85); } catch { return dataUrl; } }
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
  const start = trpc.research.start.useMutation({ onSuccess: (data) => setSessionId(data.id) });
  const attachImage = trpc.research.attachImage.useMutation();
  const extractDocument = trpc.research.extractDocument.useMutation();
  const followUp = trpc.research.followUp.useMutation({ onSuccess: (data) => { setFollowups((items) => [...items, followup.trim()]); setFollowup(""); setSessionId(data.id); } });
  const session = trpc.research.get.useQuery({ id: sessionId || 0 }, { enabled: Boolean(sessionId), refetchInterval: (query) => query.state.data?.session.status === "completed" || query.state.data?.session.status === "failed" ? false : 1200 });
  const plan = trpc.research.plan.useQuery({ question: question || "Research a question with live sources" }, { enabled: question.length >= 8 });
  const providerStatus = trpc.research.providers.useQuery();
  const data = session.data as any;
  const sources = (data?.sources || []) as Source[];
  const evidence = (data?.session?.plan?.evidence || data?.evidence || []) as Evidence[];
  const conflicts = (data?.session?.plan?.conflicts || []) as Conflict[];
  const latestProgress = data?.messages?.filter((m: any) => m.role === "system").at(-1)?.content || "Ready for a question";
  const activeStage = Math.max(0, stages.findIndex((s) => latestProgress.toLowerCase().includes(s)));
  const confidence = Math.round(evidence.length ? evidence.slice(0, 6).reduce((sum, item) => sum + (item.supportScore || item.qualityScore || 70), 0) / Math.min(evidence.length, 6) : 0);

  useEffect(() => { if (start.error) setSessionId(null); }, [start.error]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); document.getElementById("research-input")?.focus(); } if (e.key === "Escape") { setSelectedSource(null); setSidebarOpen(false); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (start.isPending || attachmentsProcessing) return;
    const q = question.trim();
    if (q.length < 8) return;
    if (!attachments.length) { setSessionId(null); start.mutate({ question: q }); return; }
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
        } else {
          const dataUrl = await fileToDataUrl(item.file);
          const result = await extractDocument.mutateAsync({ filename: item.file.name, dataUrl });
          documentTexts.push(`--- ${item.file.name} ---\n${result.text}`);
        }
      }
      setSessionId(null);
      start.mutate({ question: q, ...(documentTexts.length ? { contextText: documentTexts.join("\n\n").slice(0, 60000) } : {}), ...(imageUrls.length ? { imageUrls } : {}) });
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

  return <div className={dark ? "app dark" : "app"}>
    <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><Logo /><nav aria-label="Primary navigation"><a href="#research">Research</a><a href="#history">History</a><a href="#about">About</a><button type="button" className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button></nav></header>
    {!sessionId ? <main className="landing" id="research">
      <section className="hero"><div className="eyebrow">Evidence before certainty</div><h1>Research anything.<br /><em>Verify everything.</em></h1><p>Search the web, compare evidence, and understand what the sources actually say.</p><form className={`search-shell composer ${attachmentMenuOpen ? "menu-open" : ""}`} onSubmit={submit} onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("drag-over")} onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); addFiles(e.dataTransfer.files); }}><input ref={fileInputRef} hidden type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xlsx" onChange={(e) => addFiles(e.target.files)} /><input ref={photoInputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => addFiles(e.target.files, "photo")} /><input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => addFiles(e.target.files, "photo")} />{attachments.length > 0 && <div className="attachment-list">{attachments.slice(0, 4).map((item) => <div className="attachment-chip" key={item.id}>{item.preview ? <button type="button" onClick={() => setPreviewAttachment(item)} aria-label={`Preview ${item.file.name}`}><img src={item.preview} alt="" /></button> : <FileUp size={16} />}<span title={item.file.name}>{item.file.name}</span><small>{formatBytes(item.file.size)}</small><button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Remove attachment ${item.file.name}`}><X size={14} /></button></div>)}{attachments.length > 4 && <span className="more-attachments">+{attachments.length - 4} more</span>}</div>}<div className="composer-row"><div className="attach-wrap"><button type="button" className="attach-button" onClick={() => setAttachmentMenuOpen(!attachmentMenuOpen)} aria-label="Add attachment" aria-expanded={attachmentMenuOpen}><Plus size={19} /></button>{attachmentMenuOpen && <div className="attachment-menu" role="menu"><button type="button" onClick={() => fileInputRef.current?.click()}><FileUp size={16} /> Add document</button><button type="button" onClick={() => photoInputRef.current?.click()}><Paperclip size={16} /> Select photo</button><button type="button" onClick={() => { setAttachmentMenuOpen(false); setCameraOpen(true); }}><CameraIcon /> Take photo</button><span>Files stay in this composer until research starts.</span></div>}</div><textarea id="research-input" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder={attachments.length ? "Ask anything about these files..." : "Ask anything..."} aria-label="Research question" rows={1} />{question && <button type="button" className="clear-search" onClick={() => setQuestion("")} aria-label="Clear research question"><X size={15} /></button>}<button type="submit" disabled={start.isPending || attachmentsProcessing || question.trim().length < 8}>{start.isPending || attachmentsProcessing ? <Loader2 className="spin" size={17} /> : <ArrowUpRight size={18} />}<span>Research</span></button></div>{attachmentsProcessing && <div className="attachment-processing" role="status"><Loader2 className="spin" size={14} />Processing attachments — uploading images and extracting document text…</div>}{attachmentError && <div className="attachment-error" role="alert"><CircleAlert size={14} />{attachmentError}</div>}</form>{start.error && <div className="error-message"><CircleAlert size={15} />{start.error.message}</div>}<div className="suggestions"><span>Try asking</span>{examples.map((x) => <button key={x} onClick={() => setQuestion(x)} type="button">{x}</button>)}</div></section>
      <section className="pipeline" id="how-it-works"><div className="eyebrow">A transparent research process</div>{[[BookOpen, "Question", "Define what needs to be known."], [Search, "Search", "Find relevant live sources."], [ShieldCheck, "Verify", "Check claims against passages."], [FlaskConical, "Synthesize", "Make uncertainty visible."]].map(([Icon, label, detail]) => { const I = Icon as typeof BookOpen; return <div className="pipeline-step" key={label as string}><div className="pipeline-icon"><I size={17} /></div><div><strong>{label as string}</strong><p>{detail as string}</p></div></div>; })}</section>
      <section className="landing-foot" id="about"><span>Evidence before certainty.</span><span>{providerStatus.data?.knowledge?.filter((p: any) => p.enabled).length || 0} knowledge providers ready</span>{plan.data && <span>{plan.data.queries.length} queries previewed</span>}</section>
    </main> : <main className="workspace">
      <div className="workspace-head"><button className="back-button" onClick={() => { setSessionId(null); setQuestion(""); }}><ArrowLeft size={16} /> New research</button><div className="status-pill"><span className="status-dot" />{data?.session?.status === "completed" ? "Research complete" : data?.session?.status === "failed" ? "Research interrupted" : `Researching ${sources.length ? `· ${sources.length} sources` : ""}`}</div></div>
      <div className="question-row"><div><div className="eyebrow">Current research question</div><h1>{data?.session?.question || question}</h1></div><span className="session-label">Session {sessionId}</span></div>
      <div className="workspace-grid"><aside className="workspace-sidebar"><button className="sidebar-new" onClick={() => { setSessionId(null); setQuestion(""); setFollowups([]); }}><Sparkles size={15} /> New research</button><div className="sidebar-section"><div className="eyebrow">Recent research</div><p className="sidebar-empty">Your completed research will appear here.</p></div><Progress data={data} latestProgress={latestProgress} activeStage={activeStage} />{data?.session?.plan?.queries?.length > 0 && <div className="mini-card"><div className="eyebrow">Search plan</div>{data.session.plan.queries.map((q: string) => <p key={q}>{q}</p>)}</div>}</aside><section className="results thread">
        <div className="thread-user"><div className="eyebrow">You</div><p>{followups.length ? followups[followups.length - 1] : data?.session?.question || question}</p>{attachments.length > 0 && <div className="thread-attachments">{attachments.map((item) => <span key={item.id}>{item.preview ? <img src={item.preview} alt="" /> : <FileText size={13} />} {item.file.name}</span>)}</div>}</div>
        <div className="thread-ai"><div className="ai-byline"><span className="brand-mark"><Sparkles size={13} /></span><strong>TruthSearch</strong><span>{data?.session?.status === "completed" ? "Research answer" : "Researching..."}</span></div>
        {data?.session?.status === "failed" && <div className="alert-card error-card"><CircleAlert size={19} /><div><strong>Research couldn’t be completed.</strong><p>Some sources could not be retrieved. Your available evidence is still shown below.</p><button onClick={() => submit()}>Retry</button></div></div>}
        {data?.session?.answer && sources.length > 0 && <div className="source-strip"><span className="eyebrow">Sources</span>{sources.slice(0, 5).map((source) => <button key={source.id} onClick={() => setSelectedSource(source)}>{source.domain}</button>)}{sources.length > 5 && <span>+{sources.length - 5}</span>}</div>}
        {data?.session?.answer && <article className="answer-panel document-answer"><div className="panel-heading"><div><div className="eyebrow">Answer</div><h2>Evidence-backed conclusion</h2></div><div className="confidence"><span>Overall confidence</span><strong>{confidence}%</strong><div className="confidence-bar"><i style={{ width: `${confidence}%` }} /></div></div></div><div className="answer-copy"><Streamdown>{data.session.answer}</Streamdown></div></article>}
        {data?.session?.answer && <div className="section-heading"><div><div className="eyebrow">Claim-level verification</div><h2>What the evidence says</h2></div><span>{evidence.length} verified passages</span></div>}
        {data?.session?.answer && <div className="claims">{evidence.slice(0, 5).map((item, i) => <details key={`${item.title}-${i}`}><summary><span className="verified"><Check size={13} /> Verified</span><span>{item.claim || item.quote}</span><ChevronDown size={16} /></summary><div className="claim-detail"><strong>Claim #{i + 1}</strong><p>{item.quote}</p><span>Supported by a verified passage · {item.supportScore || item.qualityScore || confidence}% confidence</span></div></details>)}</div>}
        {conflicts.length > 0 && <div className="conflict-card"><div className="conflict-title"><CircleAlert size={18} /><div><div className="eyebrow">Conflicting evidence</div><h2>Sources disagree</h2></div></div><p>{conflicts[0].description}</p><div className="conflict-columns"><div><strong>Supporting</strong>{(conflicts[0].supporting || []).map((x, i) => <span key={i}><Check size={13} />{x.title || x.url}</span>)}</div><div><strong>Contradicting</strong>{(conflicts[0].contradicting || []).map((x, i) => <span key={i}><CircleAlert size={13} />{x.title || x.url}</span>)}</div></div></div>}
        {sources.length > 0 ? <section className="evidence-section"><div className="section-heading"><div><div className="eyebrow">Evidence library</div><h2>Sources behind the answer</h2></div><span>{sources.length} sources</span></div><div className="evidence-grid">{sources.map((source, i) => { const item = evidence.find((e) => e.url === source.canonicalUrl || e.url === source.url || e.title === source.title); return <article className="evidence-card" key={source.id}><div className="source-meta"><span>{source.sourceType}</span><Quality score={source.qualityScore} onClick={() => setSelectedSource(source)} /></div><h3>{source.title}</h3><p className="domain">{source.domain}{source.publicationDate ? ` · ${source.publicationDate}` : ""}</p>{item?.quote && <blockquote>{item.quote}</blockquote>}<div className="card-actions"><button onClick={() => setSelectedSource(source)}><FileText size={14} /> Inspect evidence</button><a href={source.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={14} /></a><button aria-label="Copy citation" onClick={() => navigator.clipboard?.writeText(`${source.title} — ${source.url}`)}><Clipboard size={14} /></button></div></article>; })}</div></section> : data?.session?.status !== "failed" && <div className="empty-state"><Loader2 className="spin" size={22} /><h2>Researching in the open</h2><p>{latestProgress}</p></div>}
        {data?.session?.answer && <div className="trace-wrap"><button className="trace-toggle" onClick={() => setShowTrace(!showTrace)}><GitBranch size={16} />View research process<ChevronDown className={showTrace ? "rotate" : ""} size={16} /></button>{showTrace && <div className="trace"><span>Question</span><span>Research plan</span><span>Search queries</span><span>Sources found</span><span>Evidence extracted</span><span>Claim verification</span><span>Final answer</span></div>}</div>}
        </div>
        {data?.session?.answer && <div className="followup-area"><div className="eyebrow">Continue the research</div><div className="followup-suggestions">{["What are the strongest sources?", "Which sources disagree?", "Can you explain this simply?", "What has changed recently?"].map((suggestion) => <button key={suggestion} onClick={() => submitFollowup(suggestion)} disabled={followUp.isPending}>{suggestion}</button>)}</div><form className="followup-composer" onSubmit={(e) => { e.preventDefault(); submitFollowup(); }}><textarea value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Ask a follow-up..." aria-label="Ask a follow-up question" rows={1} /><button type="submit" disabled={followUp.isPending || followup.trim().length < 8}>{followUp.isPending ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={17} />}</button></form></div>}
      </section></div>
    </main>}
    {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)}><aside className="mobile-sidebar" onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button><Logo /><button className="sidebar-new" onClick={() => { setSessionId(null); setQuestion(""); setSidebarOpen(false); }}><Sparkles size={15} /> New research</button><div className="eyebrow">Recent research</div><p className="sidebar-empty">Your completed research will appear here.</p></aside></div>}
    {cameraOpen && <CameraCapture onClose={() => setCameraOpen(false)} onPickImage={() => { setCameraOpen(false); photoInputRef.current?.click(); }} onCapture={(file) => { setCameraOpen(false); addFiles([file], "photo"); }} />}
    {previewAttachment?.preview && <div className="preview-backdrop" onClick={() => setPreviewAttachment(null)}><div className="image-preview" role="dialog" aria-modal="true" aria-label={`Preview ${previewAttachment.file.name}`} onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setPreviewAttachment(null)} aria-label="Close image preview"><X size={18} /></button><img src={previewAttachment.preview} alt={previewAttachment.file.name} /><strong>{previewAttachment.file.name}</strong><span>{formatBytes(previewAttachment.file.size)}</span><button className="remove-preview" onClick={() => { removeAttachment(previewAttachment.id); setPreviewAttachment(null); }}>Remove attachment</button></div></div>}
    {selectedSource && <div className="drawer-backdrop" onClick={() => setSelectedSource(null)}><aside className="inspector" onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setSelectedSource(null)} aria-label="Close source inspector"><X size={18} /></button><div className="eyebrow">Source inspector</div><h2>{selectedSource.title}</h2><p className="domain">{selectedSource.domain} · {selectedSource.sourceType}</p><Quality score={selectedSource.qualityScore} /><hr /><div className="eyebrow">Relevant passage</div><blockquote>{sourceEvidence?.quote || "No verified exact passage was mapped to this source."}</blockquote>{sourceEvidence?.claim && <><div className="eyebrow">Claim supported</div><p>{sourceEvidence.claim}</p></>}<button className="primary-link" onClick={() => navigator.clipboard?.writeText(`${selectedSource.title} — ${selectedSource.url}`)}><Clipboard size={14} /> Copy citation</button><a className="primary-link" href={selectedSource.url} target="_blank" rel="noreferrer">Open original source <ArrowUpRight size={15} /></a></aside></div>}
  </div>;
}
