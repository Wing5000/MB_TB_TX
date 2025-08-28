export const config = { runtime: 'edge' };

export default async function handler(req) {
  const urlParam = req.nextUrl.searchParams.get('url');
  const url = new URL(urlParam);
  const apiKey = process.env.MOONSCAN_KEY;
  if (apiKey && url.hostname.includes('moonscan')) {
    url.searchParams.set('apikey', apiKey);
  }
  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
