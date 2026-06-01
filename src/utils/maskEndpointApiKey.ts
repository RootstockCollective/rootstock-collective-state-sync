/**
 * Masks the API key in a subgraph endpoint URL for safe logging.
 * Returns '[invalid-endpoint]' when the input is not a parseable URL.
 */
export function maskEndpointApiKey(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const segments = url.pathname.split('/').filter(Boolean);

    if (segments.length >= 3 && segments[0] === 'api' && looksLikeApiKey(segments[1])) {
      segments[1] = '***';
      url.pathname = '/' + segments.join('/');
      return url.toString();
    }

    if (segments[0] === 'subgraphs') {
      return url.toString();
    }

    if (segments.length >= 2 && looksLikeApiKey(segments[0])) {
      segments[0] = '***';
      url.pathname = '/' + segments.join('/');
      return url.toString();
    }

    return url.toString();
  } catch {
    return '[invalid-endpoint]';
  }
}

function looksLikeApiKey(segment: string): boolean {
  return segment.length >= 20 && /^[a-zA-Z0-9]+$/.test(segment);
}
