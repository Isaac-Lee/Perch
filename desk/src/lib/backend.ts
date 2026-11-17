export const isTauri = "__TAURI_INTERNALS__" in window;

/** Tauri: 네이티브 폴더 선택창. 브라우저: null (호출 측이 입력칸을 보여준다). */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ directory: true, multiple: false });
  return typeof p === "string" ? p : null;
}
