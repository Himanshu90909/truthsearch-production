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

// tRPC routing: httpBatchLink batches several procedures into ONE request
// (comma-separated paths like /research.providers,research.plan?batch=1),
// so every local response must contain one result entry per procedure, in
// the same order as the request paths.
const LOCAL_GET_PROC = /$^/; // no GET procedures are handled client-side
const LOCAL_POST_PROC = /^research\.(attachImage|extractDocument)$/;

const trpcResponse = (results: unknown[]) =>
  new Response(JSON.stringify(results), { status: 200, headers: { "Content-Type": "application/json" } });

function researchTrpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const method = (init?.method || "GET").toUpperCase();

  let procedures: string[] = [];
  let inputList: unknown[] = [];
  try {
    const parsedUrl = new URL(url, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    const trpcSegment = parsedUrl.pathname.indexOf("/api/trpc/") >= 0 ? "/api/trpc/" : "/trpc/";
    const procPath = parsedUrl.pathname.split(trpcSegment)[1] ?? "";
    procedures = procPath.split(",").map((p) => p.trim()).filter(Boolean);
    let decodedInput: unknown = {};
    if (method === "GET") {
      const raw = parsedUrl.searchParams.get("input");
      decodedInput = raw ? JSON.parse(raw) : {};
    } else if (init?.body) {
      decodedInput = JSON.parse(String(init.body));
    }
    if (Array.isArray(decodedInput)) {
      inputList = decodedInput;
    } else if (decodedInput && typeof decodedInput === "object" && Object.keys(decodedInput as Record<string, unknown>).length > 0) {
      // arrayToDict: {"0":{"json":...},"1":{...}} — or a single {"json":...}
      const dict = decodedInput as Record<string, unknown>;
      inputList = procedures.map((_, i) => dict[String(i)] ?? (dict as Record<string, unknown>)[i as unknown as string] ?? (i === 0 ? dict : {}));
    } else {
      inputList = procedures.map(() => ({}));
    }
  } catch {
    return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
  }

  const opInput = (i: number): Record<string, unknown> => {
    const first = inputList[i] as Record<string, unknown> | undefined;
    return ((first?.json as Record<string, unknown>) ?? first ?? {}) as Record<string, unknown>;
  };

  const needsLocal =
    (method === "GET" && procedures.some((p) => LOCAL_GET_PROC.test(p))) ||
    (method === "POST" && procedures.some((p) => LOCAL_POST_PROC.test(p)));

  if (!needsLocal || procedures.length === 0) {
    return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
  }

  return (async () => {
    const results: unknown[] = [];
    for (let i = 0; i < procedures.length; i++) {
      const proc = procedures[i];
      const parsed = opInput(i) as { filename?: string; dataUrl?: string };
      try {
        if (method === "POST" && proc === "research.attachImage") {
          const dataUrl = parsed.dataUrl || "";
          const valid =
            /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) && dataUrl.length <= 7_500_000;
          if (!valid) {
            results.push({ error: { message: "Image could not be read. Try a JPG, PNG, or WebP under 5 MB." } });
          } else {
            // The research pipeline accepts data URIs directly — no server upload needed.
            results.push({ result: { data: { json: { url: dataUrl } } } });
          }
          continue;
        }

        if (method === "POST" && proc === "research.extractDocument") {
          // Documents are parsed entirely in the browser — no server needed.
          const dataUrl = String(parsed.dataUrl || "");
          const filename = String(parsed.filename || "").toLowerCase();
          const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
          if (!m) {
            results.push({ error: { message: "Document could not be read — try re-uploading the file." } });
            continue;
          }
          const bin = atob(m[2]);
          const bytes = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
          let text = "";
          try {
            if (filename.endsWith(".pdf")) {
              const { extractText, getDocumentProxy } = await import("unpdf");
              const pdf = await getDocumentProxy(bytes);
              const extracted = await extractText(pdf, { mergePages: true });
              text = extracted.text || "";
            } else if (filename.endsWith(".docx")) {
              const mammothMod = await import("mammoth");
              const mammoth = (mammothMod as unknown as { default?: typeof mammothMod }).default ?? mammothMod;
              const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
              const extracted = await mammoth.extractRawText({ arrayBuffer });
              text = extracted.value || "";
            } else if (filename.endsWith(".xlsx")) {
              const xlsx = await import("xlsx");
              const workbook = xlsx.read(bytes, { type: "array" });
              text = workbook.SheetNames.map(
                (sheetName) => `--- Sheet: ${sheetName} ---\n${xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName])}`
              ).join("\n\n");
            } else if (filename.endsWith(".txt") || filename.endsWith(".csv") || filename.endsWith(".md")) {
              text = new TextDecoder().decode(bytes);
            } else if (filename.endsWith(".doc")) {
              results.push({ error: { message: "Legacy .doc files are not supported — please upload the .docx version." } });
              continue;
            } else {
              results.push({ error: { message: "That document type is not supported. Use PDF, DOCX, XLSX, TXT, CSV, or MD." } });
              continue;
            }
          } catch {
            results.push({ error: { message: "Document processing failed — try another file." } });
            continue;
          }
          const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
          if (clean.length < 60) {
            results.push({ error: { message: "No readable text could be extracted from this document." } });
            continue;
          }
          results.push({ result: { data: { json: { text: clean.slice(0, 60000), characters: clean.length } } } });
          continue;
        }

        // Non-local procedure inside a mixed batch.
        results.push({ error: { message: `Procedure ${proc} is not available in local mode.` } });
      } catch (err) {
        results.push({ error: { message: err instanceof Error ? err.message : "Request failed." } });
      }
    }
    return trpcResponse(results);
  })();
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
