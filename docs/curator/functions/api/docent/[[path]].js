const UPSTREAM = 'https://the-curator-archivist.lucidknight.chatgpt.site/api/docent';

export const onRequestGet = async ({ params }) => {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (path !== 'manifest.json' && !/^shards\/[0-9a-f]{2}\.json$/i.test(path)) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = await fetch(`${UPSTREAM}/${path}`, {
    headers: { Accept: 'application/json' },
    cf: { cacheEverything: true, cacheTtl: 60 }
  });
  if (!upstream.ok) return new Response('Public corpus unavailable', { status: upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate'
    }
  });
};
