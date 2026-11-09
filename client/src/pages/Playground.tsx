import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { getApiBase } from "@/lib/apiOrigin";
import {
  ArrowLeft,
  ArrowUpRight,
  BrainCircuit,
  Camera as CameraIcon,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  ImagePlus,
  Loader2,
  Mic,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import CameraCapture from "@/components/CameraCapture";

/**
 * Playground — prompt, tune and run any model this deployment can serve.
 *
 * Isolated from the research pipeline: it talks to /api/playground/models and
 * /api/playground/chat, so the evidence workflow is untouched. Kept in the same
 * visual language as the research app (same ink, teal accent, compact rows).
 */

type ModelInfo = {
  id: string;
  label: string;
  family: string;
  note: string;
  reasoning: boolean;
  vision: boolean;
  provider: string;
  maxOutput: number;
  image?: boolean;
  available: boolean;
};

type Attachment = {
  id: string;
  kind: "image" | "doc";
  name: string;
  bytes: number;
  dataUrl?: string;
  thumb?: string;
  text?: string;
  pages?: number;
  chars?: number;
};

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type Msg = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  reasoning?: string;
  model?: string;
  seconds?: number;
  error?: string;
  imageUrl?: string;
};

type Settings = { system: string; temperature: number; maxTokens: number };

const SETTINGS_KEY = "truthsearch.playground.settings";
const MODEL_KEY = "truthsearch.playground.model";
const THEME_KEY = "truthsearch.playground.dark";
const MAX_ATTACHMENTS = 4;
const DOC_LIMIT = 20000;

const examples = [
  "Explain mixture-of-experts in 5 sentences",
  "Rewrite this paragraph to be 30% shorter",
  "Write a SQL query for monthly churn",
  "Critique this product name: Nightjar",
];

const defaultSettings: Settings = { system: "", temperature: 0.7, maxTokens: 2048 };

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 KB";
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function drawScaled(source: HTMLImageElement | HTMLVideoElement, max: number) {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image could not be opened."));
    img.src = src;
  });
}

let pdfJs: any = null;
async function loadPdfJs() {
  if (pdfJs) return pdfJs;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-pdfjs="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("The PDF reader did not load.")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
    script.async = true;
    script.dataset.pdfjs = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The PDF reader did not load."));
    document.head.appendChild(script);
  });
  const lib = (window as unknown as { pdfjsLib?: any }).pdfjsLib;
  if (!lib) throw new Error("The PDF reader did not load.");
  lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  pdfJs = lib;
  return lib;
}

async function pdfToText(file: File) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 40); i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let last: number | null = null;
    let text = "";
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      const str = item.str || "";
      if (!str) continue;
      if (last !== null && item.transform && Math.abs(item.transform[5] - last) > 2) text += "\n";
      text += str;
      last = item.transform ? item.transform[5] : last;
    }
    pages.push(text.trim());
  }
  return { text: pages.join("\n\n"), pages: doc.numPages };
}

function buildMessages(messages: Msg[]) {
  return messages.map((message) => {
    const attachments = message.attachments || [];
    const images = attachments.filter((a) => a.kind === "image");
    const docs = attachments.filter((a) => a.kind === "doc");
    const docPrefix = docs.map((d) => `Attached document "${d.name}":\n${d.text || ""}`).join("\n\n");
    const text = (message.content || "").trim();
    if (message.role !== "user") return { role: "assistant", content: message.content || "" };
    if (!images.length) return { role: "user", content: [docPrefix, text].filter(Boolean).join("\n\n") };
    const parts: ChatPart[] = [
      { type: "text", text: [docPrefix, text || "Look at the attached image."].filter(Boolean).join("\n\n") },
    ];
    images.forEach((image) => parts.push({ type: "image_url", image_url: { url: image.dataUrl || image.thumb || "" } }));
    return { role: "user", content: parts };
  });
}

const API_BASE = getApiBase(import.meta.env.VITE_API_ORIGIN);

export default function Playground() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [modelId, setModelId] = useState(() => localStorage.getItem(MODEL_KEY) || "mercury-3");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "1");
  const [settings, setSettings] = useState<Settings>(() => loadJson(SETTINGS_KEY, defaultSettings));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const [liveReasoning, setLiveReasoning] = useState("");
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => models.filter((m) => m.available), [models]);
  const activeModel = useMemo(
    () => models.find((m) => m.id === modelId) || available[0] || null,
    [models, modelId, available],
  );

  useEffect(() => {
    localStorage.setItem(THEME_KEY, dark ? "1" : "0");
  }, [dark]);
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem(MODEL_KEY, modelId);
  }, [modelId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/playground/models`, { cache: "no-store" });
        const data = (await res.json()) as { models?: ModelInfo[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || `Model list failed (${res.status})`);
        const list = data.models || [];
        setModels(list);
        const usable = list.filter((m) => m.available);
        if (!usable.length) setModelsError("No model keys are configured on this deployment.");
        else if (!usable.some((m) => m.id === modelId)) setModelId(usable[0].id);
      } catch (error) {
        if (!cancelled) setModelsError((error as Error).message || "Could not load models.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, live]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  const pickVisionModel = useCallback(() => {
    if (activeModel?.vision) return;
    const vision = available.find((m) => m.vision);
    if (!vision) return;
    setModelId(vision.id);
    setNotice(`Switched to ${vision.label} so it can read the image.`);
  }, [activeModel, available]);

  const addImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        setNotice(`Up to ${MAX_ATTACHMENTS} attachments per message.`);
        return;
      }
      const next: Attachment[] = [];
      for (const file of images.slice(0, room)) {
        try {
          const dataUrl = await readAsDataUrl(file);
          const img = await loadImageEl(dataUrl);
          next.push({
            id: uid(),
            kind: "image",
            name: file.name || "photo.jpg",
            bytes: file.size,
            dataUrl: drawScaled(img, 1400).toDataURL("image/jpeg", 0.85),
            thumb: drawScaled(img, 420).toDataURL("image/jpeg", 0.7),
          });
        } catch (error) {
          setNotice((error as Error).message || "That image could not be read.");
        }
      }
      if (next.length) {
        setAttachments((prev) => [...prev, ...next]);
        pickVisionModel();
      }
    },
    [attachments.length, pickVisionModel],
  );

  const addDocs = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        setNotice(`Up to ${MAX_ATTACHMENTS} attachments per message.`);
        return;
      }
      const next: Attachment[] = [];
      for (const file of files.slice(0, room)) {
        try {
          const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
          let text = "";
          let pages = 0;
          if (isPdf) {
            const parsed = await pdfToText(file);
            text = parsed.text;
            pages = parsed.pages;
          } else {
            text = (await file.text()).replace(/\r\n/g, "\n");
          }
          text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          if (!text) {
            setNotice(`${file.name} had no readable text. Scanned PDFs work when attached as a photo.`);
            continue;
          }
          next.push({
            id: uid(),
            kind: "doc",
            name: file.name,
            bytes: file.size,
            pages,
            chars: text.length,
            text: text.slice(0, DOC_LIMIT),
          });
        } catch (error) {
          setNotice((error as Error).message || `Could not read ${file.name}`);
        }
      }
      if (next.length) setAttachments((prev) => [...prev, ...next]);
    },
    [attachments.length],
  );

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  // Mic: record, normalise to 16 kHz mono WAV (Vachana STT needs a real
  // container) and drop the transcript straight into the composer.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toWav16k = async (blob: Blob): Promise<Blob> => {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const frames = Math.ceil(decoded.duration * rate);
    const offline = new OfflineAudioContext(1, frames, rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    await ctx.close();
    const samples = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  const uploadVoice = async (blob: Blob) => {
    setTranscribing(true);
    try {
      const wav = await toWav16k(blob);
      const res = await fetch(`${API_BASE}/api/playground/stt?language=hi-IN`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: wav,
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      const text = (data.text || "").trim();
      if (!text) {
        setNotice("Kuch sunai nahi diya — dobara boliye.");
        return;
      }
      setInput((prev) => (prev ? `${prev} ${text}` : text));
      setNotice("Mic transcript composer me aa gaya.");
      textareaRef.current?.focus();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setTranscribing(false);
    }
  };

  const toggleMic = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 2000) void uploadVoice(blob);
      };
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
      setNotice("");
    } catch {
      setNotice("Mic permission nahi mili. Browser settings me allow kijiye.");
    }
  };

  const readAloud = async (text: string, index: number) => {
    if (!text.trim()) return;
    if (speaking === index) {
      audioRef.current?.pause();
      setSpeaking(null);
      return;
    }
    try {
      setSpeaking(index);
      const res = await fetch(`${API_BASE}/api/playground/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 1200), language: "hi", voice: "Avinash" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Speech failed");
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => setSpeaking(null);
      await audio.play();
    } catch (error) {
      setSpeaking(null);
      setNotice((error as Error).message);
    }
  };

  const send = async (rawText?: string) => {
    if (busy) return;
    const text = (rawText ?? input).trim();
    if (!text && !attachments.length) return;
    if (!activeModel) {
      setNotice("No model is available right now.");
      return;
    }

    if (activeModel.image) {
      setMessages([...messages, { role: "user", content: text }]);
      setInput("");
      setAttachments([]);
      setBusy(true);
      const startedAt = Date.now();
      try {
        const res = await fetch(`${API_BASE}/api/playground/image`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: text, model: activeModel.id }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || `Image generation failed (${res.status}).`);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "",
            imageUrl: data.url,
            model: activeModel.label,
            seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", model: activeModel.label, error: (error as Error).message },
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    const queued = attachments;
    const userMessage: Msg = { role: "user", content: text, attachments: queued.length ? queued : undefined };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setAttachments([]);
    setLive("");
    setLiveReasoning("");
    setBusy(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    let answer = "";
    let reasoning = "";

    try {
      const res = await fetch(`${API_BASE}/api/playground/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: activeModel.id,
          messages: buildMessages(history),
          system: settings.system,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        let detail = "";
        try {
          const parsed = (await res.json()) as { error?: string };
          detail = parsed.error || "";
        } catch {
          /* ignore */
        }
        throw new Error(detail || `The model request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastPaint = 0;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          if (chunk.error) throw new Error(typeof chunk.error === "string" ? chunk.error : chunk.error.message || "The model returned an error.");
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) answer += delta.content;
          const think = delta?.reasoning_content || delta?.reasoning;
          if (think) reasoning += think;
          const now = Date.now();
          if (now - lastPaint > 60) {
            lastPaint = now;
            setLive(answer);
            setLiveReasoning(reasoning);
          }
        }
      }

      if (!answer.trim()) throw new Error("The model returned an empty answer. Try another model.");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: answer,
          reasoning: reasoning || undefined,
          model: activeModel.label,
          seconds: Math.max(1, Math.round((Date.now() - started) / 1000)),
        },
      ]);
    } catch (error) {
      const aborted = (error as Error).name === "AbortError";
      if (aborted && !answer.trim()) {
        setNotice("Stopped.");
      } else if (answer.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answer, reasoning: reasoning || undefined, model: activeModel.label },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", model: activeModel.label, error: aborted ? "Stopped." : (error as Error).message },
        ]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setLive("");
      setLiveReasoning("");
    }
  };

  const newChat = () => {
    if (busy) stop();
    setMessages([]);
    setAttachments([]);
    setInput("");
    setNotice("");
  };

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    models.forEach((model) => {
      if (!model.available) return;
      const list = groups.get(model.family) || [];
      list.push(model);
      groups.set(model.family, list);
    });
    return Array.from(groups.entries());
  }, [models]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const grow = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    const el = event.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  };

  return (
    <div className={`pg-shell ${dark ? "dark" : ""}`}>
      <header className="pg-head">
        <a href="/#research" className="pg-back">
          <ArrowLeft size={15} /> Research
        </a>
        <div className="pg-brand">
          <span className="pg-mark">T</span> TruthSearch <span className="pg-tag">playground</span>
        </div>
        <div className="pg-actions">
          <div className="pg-model-wrap">
            <button
              type="button"
              className="pg-model"
              onClick={() => setPickerOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              disabled={!available.length}
            >
              <span className="pg-model-label">{activeModel ? activeModel.label : modelsError ? "No model" : "Loading…"}</span>
              {activeModel && <span className="pg-model-family">{activeModel.family}</span>}
              <ChevronDown size={13} />
            </button>
            {pickerOpen && (
              <div className="pg-picker" role="listbox" aria-label="Models">
                {groupedModels.map(([family, list]) => (
                  <div key={family} className="pg-picker-group">
                    <div className="pg-picker-label">{family}</div>
                    {list.map((model: ModelInfo) => (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={model.id === activeModel?.id}
                        className={`pg-picker-option ${model.id === activeModel?.id ? "active" : ""}`}
                        onClick={() => {
                          setModelId(model.id);
                          setPickerOpen(false);
                        }}
                      >
                        <span className="pg-picker-name">
                          {model.label}
                          {model.reasoning && <span className="pg-badge">thinking</span>}
                          {model.vision && <span className="pg-badge accent">vision</span>}
                        </span>
                        <span className="pg-picker-note">
                          {model.note} · {model.id}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                {!groupedModels.length && <p className="pg-picker-empty">{modelsError || "No models available."}</p>}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`pg-icon ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Model settings"
            title="System prompt, temperature, output length"
          >
            <SlidersHorizontal size={16} />
          </button>
          <button type="button" className="pg-icon" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button type="button" className="pg-icon" onClick={newChat} aria-label="New chat" title="New chat">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <section className="pg-settings" aria-label="Model settings">
          <label className="pg-field pg-field-wide">
            <span>System prompt</span>
            <textarea
              value={settings.system}
              onChange={(event) => setSettings((prev) => ({ ...prev, system: event.target.value }))}
              placeholder="Optional. Sets the model's role and rules for this chat."
              rows={3}
              maxLength={4000}
            />
          </label>
          <label className="pg-field">
            <span>
              Temperature <strong>{settings.temperature.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={settings.temperature}
              onChange={(event) => setSettings((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
            />
          </label>
          <label className="pg-field">
            <span>Max output tokens</span>
            <input
              type="number"
              min={64}
              max={activeModel?.maxOutput || 8192}
              step={64}
              value={settings.maxTokens}
              onChange={(event) => setSettings((prev) => ({ ...prev, maxTokens: Math.max(64, Number(event.target.value) || 64) }))}
            />
          </label>
        </section>
      )}

      <div className="pg-thread" ref={threadRef}>
        <div className="pg-thread-inner">
          {!messages.length && !live && (
            <div className="pg-empty">
              <div className="pg-eyebrow">Prompt, tune, run</div>
              <h1>Talk to the models directly.</h1>
              <p>
                Same keys, same account as research, without retrieval. Pick a model, set a system prompt, attach a photo or PDF.
                Every answer here is raw model output — no sources, no citations.
              </p>
              <div className="pg-examples">
                {examples.map((example) => (
                  <button key={example} type="button" className="pg-example" onClick={() => void send(example)}>
                    {example}
                  </button>
                ))}
              </div>
              {modelsError && (
                <p className="pg-warn">
                  <CircleAlert size={14} /> {modelsError}
                </p>
              )}
            </div>
          )}

          {messages.map((message, index) =>
            message.role === "user" ? (
              <div className="pg-row user" key={`u-${index}`}>
                <div className="pg-bubble">
                  {message.content && <p>{message.content}</p>}
                  {!!message.attachments?.length && (
                    <div className="pg-bubble-atts">
                      {message.attachments.map((attachment) =>
                        attachment.kind === "image" ? (
                          <img key={attachment.id} src={attachment.thumb || attachment.dataUrl} alt={attachment.name} />
                        ) : (
                          <span key={attachment.id} className="pg-doc-chip">
                            <FileText size={12} /> {attachment.name}
                            {attachment.pages ? ` · ${attachment.pages}p` : ""}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="pg-row bot" key={`b-${index}`}>
                <div className="pg-avatar">
                  <Sparkles size={13} />
                </div>
                <div className="pg-answer">
                  <div className="pg-answer-meta">
                    <span className="pg-model-chip">{message.model || activeModel?.label || "model"}</span>
                    {message.seconds ? <span className="pg-meta-dim">{message.seconds}s</span> : null}
                    {!message.error && !message.imageUrl && message.content.trim().length > 8 ? (
                      <button
                        type="button"
                        className={`pg-speak ${speaking === index ? "live" : ""}`}
                        onClick={() => void readAloud(message.content, index)}
                        title={speaking === index ? "Stop reading" : "Read this answer aloud (Gnani Timbre)"}
                        aria-label="Read answer aloud"
                      >
                        <Volume2 size={14} />
                      </button>
                    ) : null}
                  </div>
                  {message.reasoning && (
                    <details className="pg-reasoning">
                      <summary>
                        <BrainCircuit size={13} /> Reasoning
                      </summary>
                      <div className="pg-reasoning-body">{message.reasoning}</div>
                    </details>
                  )}
                  {message.error ? (
                    <p className="pg-warn">
                      <CircleAlert size={14} /> {message.error}
                    </p>
                  ) : message.imageUrl ? (
                    <figure className="pg-image">
                      <img src={message.imageUrl} alt={messages[index - 1]?.content || "Generated image"} loading="lazy" />
                      <figcaption>
                        <a href={message.imageUrl} target="_blank" rel="noopener noreferrer">
                          Open full size <ArrowUpRight size={12} />
                        </a>
                        <span className="pg-meta-dim">{activeModel?.family || "image"} · 1024 × 1024</span>
                      </figcaption>
                    </figure>
                  ) : (
                    <div className="pg-prose">
                      <Streamdown>{message.content}</Streamdown>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {(busy || live) && (
            <div className="pg-row bot">
              <div className="pg-avatar">
                <Loader2 size={13} className="spin" />
              </div>
              <div className="pg-answer">
                <div className="pg-answer-meta">
                  <span className="pg-model-chip">{activeModel?.label}</span>
                  {!live && <span className="pg-meta-dim">{activeModel?.image ? "rendering…" : "thinking…"}</span>}
                </div>
                {liveReasoning && (
                  <details className="pg-reasoning" open>
                    <summary>
                      <BrainCircuit size={13} /> Reasoning
                    </summary>
                    <div className="pg-reasoning-body">{liveReasoning}</div>
                  </details>
                )}
                {live && <div className="pg-prose">{live}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pg-composer-wrap">
        <form
          className="pg-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files || []);
            void addImages(files);
            void addDocs(files.filter((file) => !file.type.startsWith("image/")));
          }}
        >
          {!!attachments.length && (
            <div className="pg-tray">
              {attachments.map((attachment) => (
                <div className="pg-chip" key={attachment.id}>
                  {attachment.kind === "image" ? (
                    <img src={attachment.thumb || attachment.dataUrl} alt={attachment.name} />
                  ) : (
                    <span className="pg-chip-icon">{attachment.pages ? "PDF" : "DOC"}</span>
                  )}
                  <span className="pg-chip-body">
                    <strong>{attachment.name}</strong>
                    <small>
                      {attachment.kind === "doc"
                        ? `${attachment.pages ? `${attachment.pages} pages · ` : ""}${attachment.chars ? `${Math.round(attachment.chars / 1000) || 1}k chars` : ""}`
                        : formatBytes(attachment.bytes)}
                    </small>
                  </span>
                  <button type="button" className="pg-chip-x" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={grow}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              activeModel?.image
                ? "Describe the image you want — style, subject, lighting…"
                : activeModel?.vision
                  ? "Message a model, or attach a photo or PDF…"
                  : "Message a model…"
            }
            aria-label="Message"
          />

          <div className="pg-composer-row">
            {!activeModel?.image && (
            <button type="button" className="pg-tool" onClick={() => photoInputRef.current?.click()} title="Attach photos">
              <ImagePlus size={15} /> <span>Photo</span>
            </button>
            )}
            {!activeModel?.image && (
            <button type="button" className="pg-tool" onClick={() => docInputRef.current?.click()} title="Attach a document">
              <FileText size={15} /> <span>Doc</span>
            </button>
            )}
            {!activeModel?.image && (
            <button type="button" className="pg-tool" onClick={() => setCameraOpen(true)} title="Take a photo">
              <CameraIcon size={15} /> <span>Camera</span>
            </button>
            )}
            {!activeModel?.image && (
            <button
              type="button"
              className={`pg-tool pg-mic ${recording ? "live" : ""}`}
              onClick={() => void toggleMic()}
              title={recording ? "Stop and transcribe" : "Speak instead of typing"}
              aria-pressed={recording}
            >
              {transcribing ? <Loader2 size={15} className="pg-spin" /> : <Mic size={15} />}
              <span>{recording ? "Listening…" : transcribing ? "Transcribing…" : "Voice"}</span>
            </button>
            )}
            <span className="pg-composer-hint">
              {activeModel?.image ? `${activeModel.family} · text-to-image` : activeModel ? `${settings.temperature.toFixed(2)} temp · ${settings.maxTokens} tokens` : ""}
            </span>
            {busy ? (
              <button type="button" className="pg-send stop" onClick={stop}>
                <Square size={13} /> Stop
              </button>
            ) : (
              <button type="submit" className="pg-send" disabled={!input.trim() && !attachments.length}>
                Run <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        </form>
        {notice && (
          <p className="pg-notice">
            <Check size={13} /> {notice}
          </p>
        )}
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void addImages(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.txt,.md,.markdown,.csv,.json,.log,.yml,.yaml,.js,.ts,.tsx,.jsx,.py,.html,.css"
        hidden
        onChange={(event) => {
          void addDocs(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onPickImage={() => {
            setCameraOpen(false);
            photoInputRef.current?.click();
          }}
          onCapture={(file) => {
            setCameraOpen(false);
            void addImages([file]);
          }}
        />
      )}
    </div>
  );
}
