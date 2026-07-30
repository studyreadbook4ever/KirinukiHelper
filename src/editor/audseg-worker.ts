import { segmentAudSegPcm } from "./audseg.js";

interface AudSegWorkerRequest {
  requestId?: unknown;
  samples: Float32Array;
  sampleRateHz: unknown;
}

function errorDetails(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

self.addEventListener("message", (event: MessageEvent<AudSegWorkerRequest>) => {
  const requestId = String(event.data?.requestId || "");
  if (!requestId) {
    return;
  }
  try {
    const result = segmentAudSegPcm(event.data.samples, {
      sampleRateHz: Number(event.data.sampleRateHz)
    });
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    const details = errorDetails(error);
    self.postMessage({
      requestId,
      ok: false,
      error: {
        name: String(details.name || "Error").slice(0, 80),
        message: String(details.message || "AudSeg 분석에 실패했습니다.")
          .slice(0, 1_000)
      }
    });
  }
});
