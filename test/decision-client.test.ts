import { describe, expect, it, vi } from 'vitest'
import { DecisionError, HttpDecisionClient } from '../src/decision/client.js'

describe('HttpDecisionClient', () => {
  it('posts to the Liquid endpoint with model d1', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ model: 'd1', answers: { q: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 42, output_tokens: 0 } }), { status: 200 }),
    )
    const client = new HttpDecisionClient({ provider: 'liquid', apiKey: 'k', fetchImpl: fetchImpl as never })
    const res = await client.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } })
    expect(res.answers.q).toEqual({ type: 'noul', noul: 0.7 })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://api.liquid.ai/decisions/v1/systemone')
    expect(JSON.parse(String(init?.body)).model).toBe('d1')
    expect((init?.headers as Record<string, string>).Authorization ?? (init?.headers as Record<string, string>).authorization).toBe('Bearer k')
  })

  it('uses liquid/d1 on OpenRouter and maps 401 to auth', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }))
    const client = new HttpDecisionClient({ provider: 'openrouter', apiKey: 'k', fetchImpl: fetchImpl as never, maxRetries: 0 })
    await expect(client.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } })).rejects.toMatchObject({ code: 'auth' })
    const [url, init] = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])
    expect(url).toBe('https://openrouter.ai/api/v1/systemone')
    expect(JSON.parse(String(init.body)).model).toBe('liquid/d1')
    expect(DecisionError).toBeTypeOf('function')
  })

  it('supports typesafe and requires url+model for custom', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }))
    const ts = new HttpDecisionClient({ provider: 'typesafe', apiKey: 'k', fetchImpl: fetchImpl as never })
    expect(ts.model).toBe('jev-1.14.0')
    await ts.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } })
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.typesafe.ai/v1/systemone')
    expect(() => new HttpDecisionClient({ provider: 'custom', apiKey: 'k' })).toThrow(DecisionError)
    const c = new HttpDecisionClient({ provider: 'custom', apiKey: 'k', url: 'https://x.example/v1/systemone', model: 'm1' })
    expect(c.model).toBe('m1')
  })
})
