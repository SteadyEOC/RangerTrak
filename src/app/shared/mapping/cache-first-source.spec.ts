import { CacheFirstSource } from './cache-first-source';

describe('CacheFirstSource', () => {
  const CACHE = 'rt-spec-cache-first-source';
  const URL = '/spec-only/archive.pmtiles';
  const bytes = new Uint8Array(100).map((_, i) => i);

  afterEach(async () => {
    await caches.delete(CACHE);
  });

  it('keys on the exact URL string it was given (Protocol.add() depends on it)', () => {
    expect(new CacheFirstSource(URL, CACHE).getKey()).toBe(URL);
  });

  it('serves a range from the warmed Cache Storage copy without touching the network', async () => {
    await (await caches.open(CACHE)).put(URL, new Response(bytes));
    const fetchSpy = spyOn(window, 'fetch').and.callThrough();

    const res = await new CacheFirstSource(URL, CACHE).getBytes(10, 5);

    expect(Array.from(new Uint8Array(res.data))).toEqual([10, 11, 12, 13, 14]);
    expect(res.etag).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to a network Range request when nothing is warmed', async () => {
    const fetchSpy = spyOn(window, 'fetch').and.callFake(async () =>
      new Response(bytes.slice(10, 15), { status: 206, headers: { 'Content-Length': '5' } }));

    const res = await new CacheFirstSource(URL, CACHE).getBytes(10, 5);

    expect(Array.from(new Uint8Array(res.data))).toEqual([10, 11, 12, 13, 14]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
    expect(new Headers(init.headers).get('range')).toBe('bytes=10-14');
  });

  it('goes to the network for a range past the end of the cached copy', async () => {
    await (await caches.open(CACHE)).put(URL, new Response(bytes));
    const fetchSpy = spyOn(window, 'fetch').and.callFake(async () =>
      new Response(new Uint8Array(5), { status: 206, headers: { 'Content-Length': '5' } }));

    await new CacheFirstSource(URL, CACHE).getBytes(98, 5);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
