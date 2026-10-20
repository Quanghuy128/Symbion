/** Shared fixtures for the run-image-paste web tests. */
export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngFile(name = "shot.png", size = 64, type = "image/png"): File {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_SIG, 0);
  for (let i = PNG_SIG.length; i < size; i++) bytes[i] = i & 0xff;
  return new File([bytes], name, { type });
}

export function svgFileNamedPng(): File {
  return new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "x.png", { type: "image/png" });
}

export function installObjectUrlStubs() {
  let n = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = (() => {
    const u = `blob:test/${++n}`;
    created.push(u);
    return u;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string) => {
    revoked.push(u);
  }) as typeof URL.revokeObjectURL;
  return { created, revoked };
}
