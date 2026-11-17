/** True when this browser can create a WebGL context. Used to decide between the 3D farm and the 2D fallback. */
export function webglAvailable(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return false;
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/** The 3D farm is used unless the page asks for ?farm=2d or WebGL is unavailable. */
export function prefers3d() {
  try {
    return new URLSearchParams(window.location.search).get('farm') !== '2d' && webglAvailable();
  } catch {
    return false;
  }
}
