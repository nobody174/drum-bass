/** Read a Blob into bytes (works in browsers and in jsdom test envs lacking Blob.arrayBuffer). */
export async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsArrayBuffer(blob);
  });
}

export async function readText(blob: Blob): Promise<string> {
  const bytes = await readBytes(blob);
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}
