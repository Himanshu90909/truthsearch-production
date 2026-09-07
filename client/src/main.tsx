import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { startLogin } from "./const";
import { getResearchApiUrl } from "./lib/apiOrigin";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// ---------------------------------------------------------------------------
// Research API routing: the research pipeline runs on the Base44 backend
// (public function), so research.start/followUp/get are served directly from
// it instead of the tRPC origin. The function performs the whole pipeline
// synchronously (search + causal synthesis); results are cached in-memory
// and returned to the tRPC layer in its response envelope, so every other
// component keeps using the typed tRPC client unchanged.
const RESEARCH_FUNCTION_URL = "https://solene-7c76de54.base44.app/functions/truthsearchResearch";
const researchCache = new Map<number, Record<string, unknown>>();
let researchNextId = 900001;

type ResearchInput = { id?: number; question?: string; contextText?: string; imageUrls?: string[] };

async function runResearch(question: string, contextText?: string, imageUrls?: string[]): Promise<number> {
  const res = await globalThis.fetch(RESEARCH_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, contextText, imageUrls }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Research failed (HTTP ${res.status}) ${detail.slice(0, 160)}`);
  }
  const payload = (await res.json()) as { session?: { status?: string; error?: string | null; answer?: string | null } };
  if (!payload?.session || payload.session.status === "failed" || !payload.session.answer) {
    throw new Error(payload?.session?.error || "Research failed — no answer was produced.");
  }
  const id = researchNextId++;
  researchCache.set(id, payload as Record<string, unknown>);
  return id;
}

function researchTrpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const method = (init?.method || "GET").toUpperCase();

  if (method === "POST" && /\/research\.(start|followUp)(\?|$)/.test(url)) {
    const isFollowUp = url.includes("research.followUp");
    return (async () => {
      const raw = init?.body ? JSON.parse(String(init.body)) : {};
      // tRPC v11 httpBatchLink sends batched ops as arrayToDict: {"0":{"json":{...}}}
      const rawOps = Array.isArray(raw) ? raw : [raw["0"] ?? raw];
      const first = rawOps[0];
      const parsedInput = ((first?.json ?? first ?? {}) as ResearchInput);
      let question = parsedInput.question || "";
      let contextText = parsedInput.contextText;
      if (isFollowUp && parsedInput.id) {
        const previous = researchCache.get(parsedInput.id) as { session?: { question?: string; answer?: string | null } } | undefined;
        question = `${previous?.session?.question ?? ""}\nFollow-up: ${question}`.trim();
        if (previous?.session?.answer) {
          contextText = `Previous verified answer:\n${previous.session.answer.slice(0, 12000)}`;
        }
      }
      const id = await runResearch(question, contextText, parsedInput.imageUrls);
      return new Response(JSON.stringify([{ result: { data: { json: { id } } } }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })();
  }

  if (method === "GET" && url.includes("research.get")) {
    return (async () => {
      const parsedUrl = new URL(url);
      const rawInput = parsedUrl.searchParams.get("input");
      const decoded = rawInput ? JSON.parse(rawInput) : {};
      // Batched query inputs arrive as {"0":{"json":{"id":...}}}
      const first = Array.isArray(decoded) ? decoded[0] : (decoded["0"] ?? decoded);
      const id = (first?.json ?? first)?.id as number | undefined;
      const payload = researchCache.get(id as number);
      if (!payload) {
        return new Response(JSON.stringify([{ error: { message: "Research session not found." } }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ result: { data: { json: payload } } }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })();
  }

  return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
}

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: getResearchApiUrl(window.location.hostname, import.meta.env.VITE_API_ORIGIN),
      transformer: superjson,
      headers() {
        // Preview auto-login fallback: when the browser blocks iframe cookies
        // (Safari ITP / private browsing / WebView), the runtime mirrors the
        // session into sessionStorage so we can forward it as a Bearer token.
        // The regular OAuth cookie flow keeps working and takes priority server-side.
        try {
          const raw = sessionStorage.getItem("manus-cookie");
          if (raw) {
            const prefix = `${COOKIE_NAME}=`;
            const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
            const token = pair?.trim().slice(prefix.length);
            if (token) {
              return { Authorization: `Bearer ${token}` };
            }
          }
        } catch {
          // sessionStorage unavailable
        }
        return {};
      },
      fetch(input, init) {
        return researchTrpcFetch(input, init);
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
