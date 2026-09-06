import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  FileText,
  FlaskConical,
  GitBranch,
  Loader2,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const examples = [
  "Are AI agents reliable?",
  "How accurate are LLMs?",
  "What causes AI hallucinations?",
  "Latest research on RAG",
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
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [expandedSource, setExpandedSource] = useState<number | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [dark, setDark] = useState(false);
  const start = trpc.research.start.useMutation({ onSuccess: (data) => setSessionId(data.id) });
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
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); document.getElementById("research-input")?.focus(); } if (e.key === "Escape") setSelectedSource(null); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); if (question.trim().length >= 8) { setSessionId(null); start.mutate({ question: question.trim() }); } };
  const sourceEvidence = selectedSource ? evidence.find((item) => item.url === selectedSource.canonicalUrl || item.url === selectedSource.url || item.title === selectedSource.title) : null;

  return <div className={dark ? "app dark" : "app"}>
    <header className="topbar"><Logo /><nav aria-label="Primary navigation"><a href="#research">Research</a><a href="#how-it-works">How it works</a><a href="#about">About</a><button type="button" className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button></nav></header>
    {!sessionId ? <main className="landing" id="research">
      <section className="hero"><div className="eyebrow">AI-powered research engine</div><h1>Research the web.<br /><em>Verify what you find.</em></h1><p>Ask a question and follow the evidence from search to verified conclusion.</p><form className="search-shell" onSubmit={submit}><Search size={20} /><input id="research-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What would you like to research?" aria-label="Research question" /><kbd>/</kbd><button type="submit" disabled={start.isPending || question.trim().length < 8}>{start.isPending ? <Loader2 className="spin" size={17} /> : <ArrowUpRight size={18} />}<span>Research</span></button></form>{start.error && <div className="error-message"><CircleAlert size={15} />{start.error.message}</div>}<div className="suggestions"><span>Try a research topic</span>{examples.map((x) => <button key={x} onClick={() => setQuestion(x)} type="button">{x}</button>)}</div></section>
      <section className="pipeline" id="how-it-works"><div className="eyebrow">A transparent research process</div>{[[BookOpen, "Question", "Define what needs to be known."], [Search, "Search", "Find relevant live sources."], [ShieldCheck, "Verify", "Check claims against passages."], [FlaskConical, "Synthesize", "Make uncertainty visible."]].map(([Icon, label, detail]) => { const I = Icon as typeof BookOpen; return <div className="pipeline-step" key={label as string}><div className="pipeline-icon"><I size={17} /></div><div><strong>{label as string}</strong><p>{detail as string}</p></div></div>; })}</section>
      <section className="landing-foot" id="about"><span>Evidence before certainty.</span><span>{providerStatus.data?.knowledge?.filter((p: any) => p.enabled).length || 0} knowledge providers ready</span>{plan.data && <span>{plan.data.queries.length} queries previewed</span>}</section>
    </main> : <main className="workspace">
      <div className="workspace-head"><button className="back-button" onClick={() => { setSessionId(null); setQuestion(""); }}><ArrowLeft size={16} /> New research</button><div className="status-pill"><span className="status-dot" />{data?.session?.status === "completed" ? "Research complete" : data?.session?.status === "failed" ? "Research interrupted" : "Researching"}</div></div>
      <div className="question-row"><div><div className="eyebrow">Current research question</div><h1>{data?.session?.question || question}</h1></div><span className="session-label">Session {sessionId}</span></div>
      <div className="workspace-grid"><aside><Progress data={data} latestProgress={latestProgress} activeStage={activeStage} />{data?.session?.plan?.queries?.length > 0 && <div className="mini-card"><div className="eyebrow">Search plan</div>{data.session.plan.queries.map((q: string) => <p key={q}>{q}</p>)}</div>}</aside><section className="results">
        {data?.session?.status === "failed" && <div className="alert-card error-card"><CircleAlert size={19} /><div><strong>Research couldn’t be completed.</strong><p>Some sources could not be retrieved. Your available evidence is still shown below.</p><button onClick={() => submit()}>Retry</button></div></div>}
        {data?.session?.answer && <article className="answer-panel"><div className="panel-heading"><div><div className="eyebrow">Research answer</div><h2>Evidence-backed conclusion</h2></div><div className="confidence"><span>Overall confidence</span><strong>{confidence}%</strong><div className="confidence-bar"><i style={{ width: `${confidence}%` }} /></div></div></div><div className="answer-copy"><Streamdown>{data.session.answer}</Streamdown></div></article>}
        {data?.session?.answer && <div className="section-heading"><div><div className="eyebrow">Claim-level verification</div><h2>What the evidence says</h2></div><span>{evidence.length} verified passages</span></div>}
        {data?.session?.answer && <div className="claims">{evidence.slice(0, 5).map((item, i) => <details key={`${item.title}-${i}`}><summary><span className="verified"><Check size={13} /> Verified</span><span>{item.claim || item.quote}</span><ChevronDown size={16} /></summary><div className="claim-detail"><strong>Claim #{i + 1}</strong><p>{item.quote}</p><span>Supported by a verified passage · {item.supportScore || item.qualityScore || confidence}% confidence</span></div></details>)}</div>}
        {conflicts.length > 0 && <div className="conflict-card"><div className="conflict-title"><CircleAlert size={18} /><div><div className="eyebrow">Conflicting evidence</div><h2>Sources disagree</h2></div></div><p>{conflicts[0].description}</p><div className="conflict-columns"><div><strong>Supporting</strong>{(conflicts[0].supporting || []).map((x, i) => <span key={i}><Check size={13} />{x.title || x.url}</span>)}</div><div><strong>Contradicting</strong>{(conflicts[0].contradicting || []).map((x, i) => <span key={i}><CircleAlert size={13} />{x.title || x.url}</span>)}</div></div></div>}
        {sources.length > 0 ? <section className="evidence-section"><div className="section-heading"><div><div className="eyebrow">Evidence library</div><h2>Sources behind the answer</h2></div><span>{sources.length} sources</span></div><div className="evidence-grid">{sources.map((source, i) => { const item = evidence.find((e) => e.url === source.canonicalUrl || e.url === source.url || e.title === source.title); return <article className="evidence-card" key={source.id}><div className="source-meta"><span>{source.sourceType}</span><Quality score={source.qualityScore} onClick={() => setSelectedSource(source)} /></div><h3>{source.title}</h3><p className="domain">{source.domain}{source.publicationDate ? ` · ${source.publicationDate}` : ""}</p>{item?.quote && <blockquote>{item.quote}</blockquote>}<div className="card-actions"><button onClick={() => setSelectedSource(source)}><FileText size={14} /> Inspect evidence</button><a href={source.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={14} /></a><button aria-label="Copy citation" onClick={() => navigator.clipboard?.writeText(`${source.title} — ${source.url}`)}><Clipboard size={14} /></button></div></article>; })}</div></section> : data?.session?.status !== "failed" && <div className="empty-state"><Loader2 className="spin" size={22} /><h2>Researching in the open</h2><p>{latestProgress}</p></div>}
        {data?.session?.answer && <div className="trace-wrap"><button className="trace-toggle" onClick={() => setShowTrace(!showTrace)}><GitBranch size={16} />Research trace<ChevronDown className={showTrace ? "rotate" : ""} size={16} /></button>{showTrace && <div className="trace"><span>Query</span><span>Search plan</span><span>Searches performed</span><span>Sources discovered</span><span>Evidence extracted</span><span>Claims verified</span><span>Final synthesis</span></div>}</div>}
      </section></div>
    </main>}
    {selectedSource && <div className="drawer-backdrop" onClick={() => setSelectedSource(null)}><aside className="inspector" onClick={(e) => e.stopPropagation()}><button className="close-button" onClick={() => setSelectedSource(null)} aria-label="Close source inspector"><X size={18} /></button><div className="eyebrow">Source inspector</div><h2>{selectedSource.title}</h2><p className="domain">{selectedSource.domain} · {selectedSource.sourceType}</p><Quality score={selectedSource.qualityScore} /><hr /><div className="eyebrow">Relevant passage</div><blockquote>{sourceEvidence?.quote || "No verified exact passage was mapped to this source."}</blockquote>{sourceEvidence?.claim && <><div className="eyebrow">Claim supported</div><p>{sourceEvidence.claim}</p></>}<a className="primary-link" href={selectedSource.url} target="_blank" rel="noreferrer">Open original source <ArrowUpRight size={15} /></a></aside></div>}
  </div>;
}
