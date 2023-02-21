/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Hono } from 'hono'
import { cache } from 'hono/cache'
import { sha256 } from 'hono/utils/crypto'
import { basicAuth } from 'hono/basic-auth'
import { serveStatic } from 'hono/cloudflare-workers'
import { detectType } from './utils'


type Bindings = {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
  BUCKET: R2Bucket
  USERNAME: string
  PASSWORD: string
}

interface Data {
	body: string
}

const maxAge = 60 * 60 * 24 * 30

const app = new Hono<{ Bindings: Bindings }>()

app.put('/upload', async (c, next) => {
	const auth = basicAuth({ username: c.env.USERNAME, password: c.env.PASSWORD })
	await auth(c, next)
})

app.put('/upload', async (c) => {
	const data = await c.req.json<Data>()
	const base64 = data.body
	if (!base64) return c.notFound()

	const type = detectType(base64)
	if (!type) return c.notFound()

	const body = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

	const key = (await sha256(body)) + '.' + type?.suffix
	await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: type.mimeType } })

	return c.text(key)
})

app.get(
	'*',
	cache({
		cacheName: 'r2-image-worker',
	})
)

app.get('/:key', async (c) => {
	const key = c.req.param('key')

	const object = await c.env.BUCKET.get(key)
	if (!object) return c.notFound()
	const data = await object.arrayBuffer()
	const contentType = object.httpMetadata?.contentType || ''

	return c.body(data, 200, {
		'Cache-Control': `public, max-age=${maxAge}`,
		'Content-Type': contentType,
	})
})

app.put('/upload/:key', async (c, next) => {
  const key = c.req.param('key')
  await c.env.BUCKET.put(key, c.req.body)
  return c.json({ code: 1, msg: 'Success', data: null })
})

app.get('/static/*', serveStatic({ root: './' }))

export default app
