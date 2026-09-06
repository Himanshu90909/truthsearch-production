import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RefreshCw, X, Check } from "lucide-react";

/**
 * Real browser camera capture (getUserMedia — no fake popups).
 * Flow: permission → live preview → capture → Retake / Use Photo → onCapture(File).
 * Handles: denied, no camera, in-use, unsupported — always with an upload fallback.
 */
export default function CameraCapture({
  onCapture,
  onClose,
  onPickImage,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  onPickImage: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"starting" | "live" | "denied" | "unavailable" | "in-use" | "error">("starting");
  const [shot, setShot] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async (mode: "user" | "environment") => {
    stopStream();
    if (videoRef.current?.srcObject) videoRef.current.srcObject = null;
    setShot(null);
    setStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("unavailable"); return; }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      setStatus("live");
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setStatus("unavailable");
      else if (name === "NotReadableError" || name === "AbortError") setStatus("in-use");
      else setStatus("error");
    }
  }, [stopStream]);

  useEffect(() => {
    void startStream(facing);
    return stopStream;
  }, [facing, startStream, stopStream]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !shot) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, shot]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setStatus("error"); return; }
    if (facing === "user") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setShot(canvas.toDataURL("image/jpeg", 0.92));
  };

  const usePhoto = () => {
    if (!shot) return;
    canvasToFile(shot, `photo-${Date.now()}.jpg`).then((file) => { stopStream(); onCapture(file); });
  };

  return (
    <div className="camera-backdrop" role="dialog" aria-modal="true" aria-label="Camera capture" onClick={() => !shot && onClose()}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <header className="camera-head">
          <span className="camera-title"><Camera size={16} /> {shot ? "Review photo" : status === "live" ? "Camera ready" : "Camera"}</span>
          <button type="button" className="icon-button" onClick={() => { stopStream(); onClose(); }} aria-label="Close camera">
            <X size={18} />
          </button>
        </header>

        <div className="camera-stage">
          {shot ? (
            <img src={shot} alt="Captured preview" className={facing === "user" ? "camera-shot mirrored" : "camera-shot"} />
          ) : (
            <video ref={videoRef} playsInline muted autoPlay className={facing === "user" ? "camera-feed mirrored" : "camera-feed"} aria-label="Live camera preview" />
          )}

          {status !== "live" && !shot && (
            <div className="camera-error" role="alert">
              {status === "starting" && <><RefreshCw className="spin" size={22} /><strong>Starting camera…</strong><p>If nothing happens, check the permission prompt in your browser.</p></>}
              {status === "denied" && <><Camera size={22} /><strong>Camera access denied</strong><p>Allow camera access in your browser settings, or add an image from your device instead.</p></>}
              {status === "unavailable" && <><Camera size={22} /><strong>No camera found</strong><p>This device or browser has no usable camera.</p></>}
              {status === "in-use" && <><Camera size={22} /><strong>Camera is in use</strong><p>Another app is using the camera. Close it, or add an image instead.</p></>}
              {status === "error" && <><Camera size={22} /><strong>Camera unavailable</strong><p>Your browser could not start the camera.</p></>}
              {status !== "starting" && <button type="button" className="camera-fallback" onClick={onPickImage}><ImagePlus size={15} /> Choose an image instead</button>}
            </div>
          )}
        </div>

        <footer className="camera-actions">
          {shot ? (
            <>
              <button type="button" className="camera-btn secondary" onClick={() => { setShot(null); void startStream(facing); }}><RefreshCw size={15} /> Retake</button>
              <button type="button" className="camera-btn primary" onClick={usePhoto}><Check size={16} /> Use photo</button>
            </>
          ) : status === "live" ? (
            <>
              <button type="button" className="camera-btn secondary" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} aria-label="Switch camera"><RefreshCw size={15} /> Flip</button>
              <button type="button" className="camera-shutter" onClick={capture} aria-label="Take photo" />
            </>
          ) : (
            <button type="button" className="camera-btn secondary" onClick={() => void startStream(facing)}><RefreshCw size={15} /> Try again</button>
          )}
        </footer>
      </div>
    </div>
  );
}

function canvasToFile(dataUrl: string, filename: string): Promise<File> {
  return fetch(dataUrl).then((r) => r.blob()).then((blob) => new File([blob], filename, { type: "image/jpeg" }));
}
