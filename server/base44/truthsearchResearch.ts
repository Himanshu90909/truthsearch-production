// TruthSearch research API — the production search + synthesis engine,
// deployed on Base44 so the Vercel frontend has a live backend.
//
// Pipeline (identical to the truthsearch-production backend):
//   1. Plan search queries (base + latest evidence + limitations)
//   2. Search public knowledge APIs (Wikipedia, arXiv, Europe PMC) in parallel
//   3. Build numbered evidence passages from snippets + Wikipedia extracts
//   4. Synthesize via Hugging Face router with intent-based model routing:
//        vision  -> zai-org/GLM-5.3-Flash, meta-models/Muse-Glimmer-30B
//        code    -> deepseek-ai/DeepSeek-V4-Flash-0731, zai-org/GLM-5.3
//        general -> zai-org/GLM-5.3, deepseek-ai/DeepSeek-V4-Flash-0731
//      with automatic failover between the two.
//   5. Return a Perplexity-style answer with the mandatory causal sections:
//      Direct answer, Why it happens, Evidence and sources, Conflicting
//      evidence, Limitations, Conclusion, Suggested follow-up questions —
//      with [n] citations and "model knowledge" provenance labels.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SYNTHESIS_ENDPOINT = "https://router.huggingface.co/v1/chat/completions";
const MODEL_CHAIN: Record<string, string[]> = {
  vision: ["zai-org/GLM-5.3-Flash", "meta-models/Muse-Glimmer-30B"],
  code: ["deepseek-ai/DeepSeek-V4-Flash-0731", "zai-org/GLM-5.3"],
  general: ["zai-org/GLM-5.3", "deepseek-ai/DeepSeek-V4-Flash-0731"],
};

const TECHNICAL_PATTERN = /\b(code|coding|python|javascript|typescript|java|c\+\+|rust|golang|sql|api|function|class|algorithm|binary search|data structure|regex|bug|error|debug|compile|framework|library|docker|git|css|html|node\.?js|react)\b/i;

function env(key: string): string | undefined {
  return (globalThis as Record<string, unknown>)[`Deno`]
    ? undefined
    : undefined;
}

function apiKey(): string {
  // Secrets live in the app environment (HF_API_KEY), never in code.
  return (Deno.env.get("HF_API_KEY") as string) || "";
}

async function requestJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", ...(init?.headers || {}) } });
    if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function requestText(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/atom+xml,text/plain" } });
    if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  published?: string;
  author?: string;
};

async function searchWikipedia(query: string): Promise<SearchHit[]> {
  const data = await requestJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`
  );
  const search = (data.query as Record<string, unknown> | undefined)?.search;
  return (Array.isArray(search) ? search : []).slice(0, 5).map((x: Record<string, unknown>) => ({
    title: String(x.title || ""),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(x.title || "").replace(/ /g, "_"))}`,
    snippet: String(x.snippet || "").replace(/<[^>]+>/g, ""),
    provider: "wikipedia",
  }));
}

async function fetchWikipediaExtract(title: string): Promise<string> {
  try {
    const data = await requestJson(
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(title)}&format=json&origin=*`
    );
    const pages = (data.query as Record<string, unknown>)?.pages as Record<string, Record<string, unknown>> | undefined;
    if (!pages) return "";
    for (const page of Object.values(pages)) {
      const text = String(page.extract || "");
      if (text.length > 0) return text.slice(0, 1400);
    }
  } catch {
    // ignore — snippet is still usable
  }
  return "";
}

async function searchArxiv(query: string): Promise<SearchHit[]> {
  try {
    const xml = await requestText(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=4`
    );
    const entries = xml.split("<entry>").slice(1, 5);
    const between = (input: string, start: string, end: string) => {
      const a = input.indexOf(start);
      if (a < 0) return "";
      const b = input.indexOf(end, a + start.length);
      if (b < 0) return "";
      return input.slice(a + start.length, b).trim();
    };
    return entries
      .map((entry) => ({
        title: between(entry, "<title>", "</title>"),
        url: between(entry, "<id>", "</id>"),
        snippet: between(entry, "<summary>", "</summary>"),
        provider: "arxiv",
        published: between(entry, "<published>", "</published>"),
      }))
      .filter((hit) => hit.title && hit.url);
  } catch {
    return [];
  }
}

async function searchEuropePmc(query: string): Promise<SearchHit[]> {
  try {
    const data = await requestJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=4&resultType=core`
    );
    const resultList = (data.resultList as Record<string, unknown> | undefined)?.result;
    return (Array.isArray(resultList) ? resultList : []).slice(0, 4).map((x: Record<string, unknown>) => ({
      title: String(x.title || "Europe PMC article"),
      url: String(x.doi ? `https://doi.org/${x.doi}` : `https://europepmc.org/article/${x.source}/${x.id}`),
      snippet: String(x.abstractText || ""),
      provider: "europepmc",
      published: x.firstPublicationDate ? String(x.firstPublicationDate) : undefined,
      author: x.authorString ? String(x.authorString) : undefined,
    }));
  } catch {
    return [];
  }
}

function scoreSource(hit: SearchHit): number {
  let score = 30;
  if (hit.provider === "arxiv" || hit.provider === "europepmc") score += 20;
  if (/\.gov$|\.edu$|\.org$|docs\.|developer\./.test(new URL(hit.url).hostname || "")) score += 8;
  if (hit.author) score += 3;
  if (hit.published) score += 2;
  return Math.max(5, Math.min(score, 98));
}

async function callSynthesisLLM(
  messages: Record<string, unknown>[],
  intent: keyof typeof MODEL_CHAIN,
  imageParts: Record<string, string | Record<string, string>[]>[]
): Promise<{ answer: string; model: string }> {
  const errors: string[] = [];
  // --- Gemini 2.5 Flash (free tier) primary provider ---
  const geminiKey = ((Deno.env.get("GEMINI_API_KEY") as string) || "").trim();
  if (geminiKey) {
    try {
      return await geminiSynthesize(geminiKey, messages, imageParts);
    } catch (err) {
      errors.push(`gemini-2.5-flash: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // --- Groq fallback (free daily tier; GPT-OSS models, sub-second latency) ---
  const groqKey = ((Deno.env.get("GROK_API_KEY") as string) || "").trim();
  if (groqKey) {
    for (const gmodel of ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]) {
      try {
        return await groqSynthesize(groqKey, gmodel, messages);
      } catch (err) {
        errors.push(`groq/${gmodel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  // --- HF router last resort (works while credits remain) ---
  const key = apiKey();
  if (!key) {
    throw new Error(`All synthesis providers failed: ${errors.join(" | ") || "no API key configured (set GEMINI_API_KEY or HF_API_KEY)"}`);
  }
  const chain = MODEL_CHAIN[intent];
  for (const model of chain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const content = [...messages];
      if (imageParts.length > 0 && model === chain[0]) {
        // First vision-capable attempt carries the images; the fallback model
        // may only support text, so images are dropped there rather than failing.
        const lastUser = content[content.length - 1];
        lastUser.content = [...(Array.isArray(lastUser.content) ? lastUser.content : [{ type: "text", text: String(lastUser.content) }]), ...imageParts];
      }
      const res = await fetch(SYNTHESIS_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: content, max_tokens: 1600, temperature: 0.3 }),
      });
      if (!res.ok) {
        let detail = await res.text().catch(() => "");
        if (res.status === 402) {
          // identify which HF account the configured key belongs to (name only, never the key)
          try {
            const who = await fetch("https://huggingface.co/api/whoami-v2", { headers: { Authorization: `Bearer ${key}` } });
            if (who.ok) {
              const w = (await who.json()) as Record<string, unknown>;
              detail += ` [key account: ${String(w.name)}]`;
            }
          } catch { /* diagnostic only */ }
        }
        errors.push(`${model}: HTTP ${res.status} ${detail.slice(0, 260)}`);
        continue;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const choices = data.choices as Record<string, unknown>[] | undefined;
      const answer = String(choices?.[0]?.message?.content ?? "").trim();
      if (!answer) {
        errors.push(`${model}: empty response`);
        continue;
      }
      return { answer, model };
    } catch (err) {
      errors.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`All synthesis models failed: ${errors.join(" | ")}`);
}

function controllerSignal(): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), 20000);
  return c.signal;
}

// Gemini REST synthesis — messages -> systemInstruction + user parts (text + inline images)
async function geminiSynthesize(
  key: string,
  messages: Record<string, unknown>[],
  imageParts: Record<string, string | Record<string, string>[]>[]
): Promise<{ answer: string; model: string }> {
  const sys = messages.find((m) => m.role === "system");
  const userText = messages.filter((m) => m.role === "user").map((m) => String(m.content ?? "")).join("\n\n");
  const parts: Record<string, unknown>[] = [{ text: userText }];
  for (const ip of imageParts) {
    let url = String((ip as Record<string, Record<string, string>>).image_url?.url || "");
    const dataMatch = url.match(/^data:([^;]+);base64,(.*)$/s);
    if (dataMatch) {
      parts.push({ inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } });
      continue;
    }
    // fetch remote image and inline it as base64
    if (/^https?:\/\//.test(url)) {
      try {
        const r = await fetch(url, { signal: controllerSignal() });
        if (r.ok) {
          const buf = new Uint8Array(await r.arrayBuffer());
          let bin = "";
          const CH = 8192;
          for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
          parts.push({ inlineData: { mimeType: r.headers.get("content-type") || "image/png", data: btoa(bin) } });
        }
      } catch { /* skip broken image */ }
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: String(sys?.content ?? "You are TruthSearch, a rigorous research engine.") }] },
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${bodyText.slice(0, 220)}`);
    const data = JSON.parse(bodyText) as Record<string, any>;
    const cands = (data.candidates || []) as Record<string, any>[];
    const text = ((cands[0]?.content?.parts) || []).map((p: Record<string, any>) => String(p.text || "")).join("").trim();
    if (!text) throw new Error(`empty response (finish: ${String(cands[0]?.finishReason ?? "unknown")})`);
    return { answer: text, model: "google/gemini-2.5-flash (free tier)" };
  } finally {
    clearTimeout(timer);
  }
}

// Groq synthesis — OpenAI-compatible endpoint, ultra-low latency
async function groqSynthesize(
  key: string,
  model: string,
  messages: Record<string, unknown>[]
): Promise<{ answer: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: 1600, temperature: 0.3 }),
    });
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${bodyText.slice(0, 220)}`);
    const data = JSON.parse(bodyText) as Record<string, any>;
    const answer = String(data.choices?.[0]?.message?.content ?? "").trim();
    if (!answer) throw new Error("empty response");
    return { answer, model: `groq/${model} (free tier)` };
  } finally {
    clearTimeout(timer);
  }
}

function classifyIntent(question: string, hasImages: boolean): "vision" | "code" | "general" {
  if (hasImages) return "vision";
  if (TECHNICAL_PATTERN.test(question)) return "code";
  return "general";
}

const SYSTEM_PROMPT =
  "You are a research analyst. You write answers that research like a search engine and explain like a teacher: direct, then causal — what happens, why it happens, and what it means. Every factual sentence that comes from the retrieved evidence must cite [n]. If the retrieved evidence does not answer part of the question, fill the gap from your own knowledge and mark those sentences inline with 'model knowledge' so the reader can tell what is sourced and what is not. If evidence conflicts, explicitly say evidence is mixed. Never invent URLs, sources, citations, or fake [n] references, and never present model-knowledge claims as cited facts. Do not reveal private reasoning.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST with {question}" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  try {
    const body = (await req.json()) as {
      question?: string;
      contextText?: string;
      imageUrls?: string[];
    };
    const question = (body.question || "").trim();
    if (question.length < 8) {
      return new Response(JSON.stringify({ error: "Question must be at least 8 characters." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const imageUrls = (body.imageUrls || []).filter((u) => /^https?:\/\//.test(u)).slice(0, 4);
    const contextText = (body.contextText || "").slice(0, 30000);

    // 1. Plan queries (like the backend: base + evidence facets).
    const base = question.replace(/\?+$/, "");
    const plannedQueries = Array.from(
      new Set([base, `${base} latest evidence`, `${base} limitations and disagreement`])
    ).slice(0, 3);

    // 2. Search knowledge providers in parallel.
    const searchResults = await Promise.allSettled([
      searchWikipedia(plannedQueries[0]),
      searchWikipedia(plannedQueries[1] || plannedQueries[0]),
      searchArxiv(plannedQueries[0]),
      searchEuropePmc(plannedQueries[0]),
    ]);
    const hits: SearchHit[] = searchResults
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((hit) => hit.title && hit.url && hit.snippet);

    // De-duplicate by URL, keep best-scoring first.
    const seen = new Set<string>();
    const unique = hits
      .filter((hit) => {
        if (seen.has(hit.url)) return false;
        seen.add(hit.url);
        return true;
      })
      .sort((a, b) => scoreSource(b) - scoreSource(a))
      .slice(0, 10);

    // 3. Enrich top Wikipedia hits with full-text extracts.
    const wikiTop = unique.filter((h) => h.provider === "wikipedia").slice(0, 3);
    const extracts = await Promise.allSettled(wikiTop.map((h) => fetchWikipediaExtract(h.title)));
    extracts.forEach((res, i) => {
      if (res.status === "fulfilled" && res.value.length > 400) {
        wikiTop[i].snippet = res.value.slice(0, 1200);
      }
    });

    // 4. Build the numbered evidence context.
    const evidence = unique.slice(0, 8).map((hit, index) => ({
      n: index + 1,
      title: hit.title,
      url: hit.url,
      text: hit.snippet.slice(0, 1200),
      provider: hit.provider,
    }));
    const context = evidence
      .map((e) => `[${e.n}] ${e.title} — ${e.url} (${e.provider})\n${e.text}`)
      .join("\n\n");

    // 5. Synthesis with intent-based model routing.
    const intent = classifyIntent(question, imageUrls.length > 0);
    const technicalQuestion = intent === "code";
    const fromKnowledgeOnly = evidence.length === 0;

    const attachmentBlock = contextText ? `\n\nAttached document context:\n${contextText.slice(0, 12000)}` : "";
    const instruction = `Question: ${question}${attachmentBlock}

Verified evidence:
${context || "(no retrieved evidence)"}

${technicalQuestion ? "This is a technical question. Answer it directly, completely, and practically from your own expertise: explain the concept, give concrete examples, and where useful include correct, runnable code. Use the retrieved evidence only where it genuinely helps, citing it with [n]; otherwise answer without citations.\n\n" : ""}${fromKnowledgeOnly ? "The retrieved web evidence is empty, so answer entirely from your own knowledge. Do NOT use [n] citations at all — there are no sources to cite.\n\n" : ""}Write a research answer with exactly these sections, in this order:

## Direct answer
2-4 sentences that directly answer the question${evidence.length ? ", with inline [n] citations" : ""}.

## Why it happens — analysis
Explain the underlying causes, mechanisms, and context behind the answer, the way a knowledgeable person would explain it to a curious reader: what drives the phenomenon, how the pieces connect, and what it means in practice. Reason across the evidence instead of only restating quotes. Every factual statement from web research must cite [n].

## Evidence and sources
The strongest retrieved evidence that supports the analysis, cited inline.

## Conflicting evidence
Only if the retrieved sources disagree or the evidence is mixed; otherwise state that retrieved sources are consistent.

## Limitations
What the retrieved evidence cannot answer, and how current or complete it is.

## Conclusion
2-3 closing sentences with citations.

## Suggested follow-up questions
Exactly three questions a reader would naturally ask next, one per line, each on its own as a list item.${imageUrls.length ? " The user attached image(s) as visual context; describe what is relevant to the question and clearly separate what comes from the images versus the cited web evidence." : ""}`;

    const userMessage: Record<string, unknown> = { role: "user", content: instruction };
    const imageParts = imageUrls.map((url) => ({ type: "image_url", image_url: { url } }));

    let answer = "";
    let model = "";
    let error: string | null = null;
    try {
      const result = await callSynthesisLLM(
        [{ role: "system", content: SYSTEM_PROMPT }, userMessage],
        intent,
        imageParts
      );
      answer = result.answer;
      model = result.model;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const now = new Date().toISOString();
    const sources = evidence.map((e, i) => ({
      id: i + 1,
      sessionId: 1,
      url: e.url,
      canonicalUrl: e.url,
      title: e.title,
      domain: (() => {
        try {
          return new URL(e.url).hostname;
        } catch {
          return "";
        }
      })(),
      author: null,
      publicationDate: null,
      sourceType: e.provider,
      qualityScore: scoreSource(unique.find((h) => h.url === e.url) || ({ title: e.title, url: e.url, snippet: e.text, provider: e.provider } as SearchHit)),
      content: e.text,
    }));

    const payload = {
      session: {
        id: 1,
        title: question.slice(0, 120),
        question,
        userId: null,
        status: answer ? "completed" : "failed",
        answer: answer || null,
        plan: { intent, models: MODEL_CHAIN[intent], queries: plannedQueries },
        error,
        model,
        provenance: evidence.length ? "web_sources" : "model_knowledge",
        createdAt: now,
        updatedAt: now,
      },
      sources,
      claims: [],
      queries: plannedQueries.map((q, i) => ({ id: i + 1, query: q, provider: "multi", status: "searched", resultCount: hits.length })),
      messages: [{ id: 1, role: "user", content: question, createdAt: now }],
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Research failed" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
