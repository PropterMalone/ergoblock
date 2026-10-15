import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFetchQuotePosters, cancelPostAudienceFetch } from './quote-sweep.js';
import { bgApiRequestPublic, getAuthToken } from './api-client.js';
import { fetchProfiles } from './graph-ops.js';
import type { ProfileWithViewer } from '../types.js';

vi.mock('./api-client.js', () => ({ bgApiRequestPublic: vi.fn(), getAuthToken: vi.fn() }));
vi.mock('./graph-ops.js', () => ({ fetchProfiles: vi.fn() }));
vi.mock('./user-actions.js', () => ({ handleCreateTempAction: vi.fn() }));

const uri = 'at://did:plc:author/app.bsky.feed.post/key';
const profile = (did: string): ProfileWithViewer => ({ did, handle: did, viewer: {} });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthToken).mockResolvedValue({
    did: 'did:plc:self',
    accessJwt: 'jwt',
    pdsUrl: 'https://pds.example',
  });
  vi.mocked(fetchProfiles).mockImplementation(async (dids) => dids.map(profile));
});

describe('post audiences', () => {
  it.each(['likes', 'reposts'] as const)(
    'paginates %s using the official response shape and deduplicates DIDs',
    async (audience) => {
      const page = (dids: string[], cursor?: string) =>
        audience === 'likes'
          ? { likes: dids.map((did) => ({ actor: profile(did) })), cursor }
          : { repostedBy: dids.map(profile), cursor };
      vi.mocked(bgApiRequestPublic)
        .mockResolvedValueOnce(page(['did:plc:a'], 'next'))
        .mockResolvedValueOnce(page(['did:plc:a', 'did:plc:b']));
      const result = await handleFetchQuotePosters(uri, audience);
      expect(result.quoters?.map((p) => p.did)).toEqual(['did:plc:a', 'did:plc:b']);
      const endpoint = audience === 'likes' ? 'getLikes' : 'getRepostedBy';
      for (const [request] of vi.mocked(bgApiRequestPublic).mock.calls) {
        const [path, query] = request.split('?');
        expect(path).toBe(`app.bsky.feed.${endpoint}`);
        expect(new URLSearchParams(query).get('uri')).toBe(uri);
        expect(new URLSearchParams(query).get('limit')).toBe('100');
      }
      expect(vi.mocked(bgApiRequestPublic).mock.calls[1][0]).toContain('cursor=next');
      expect(fetchProfiles).toHaveBeenCalledWith(
        ['did:plc:a', 'did:plc:b'],
        'jwt',
        'https://pds.example'
      );
    }
  );

  it('excludes self and exposes followed-account protection from authenticated hydration', async () => {
    vi.mocked(bgApiRequestPublic).mockResolvedValueOnce({
      likes: [{ actor: profile('did:plc:self') }, { actor: profile('did:plc:friend') }],
    });
    vi.mocked(fetchProfiles).mockResolvedValueOnce([
      { ...profile('did:plc:friend'), viewer: { following: 'at://follow' } },
    ]);
    const result = await handleFetchQuotePosters(uri, 'likes');
    expect(result.quoters).toHaveLength(1);
    expect(result.quoters?.[0]).toMatchObject({ did: 'did:plc:friend', followed: true });
    expect(result.viewerStateUnavailable).toBe(false);
  });

  it('stops a repeated cursor and marks results incomplete', async () => {
    vi.mocked(bgApiRequestPublic).mockResolvedValue({
      likes: [{ actor: profile('did:plc:a') }],
      cursor: 'same',
    });
    const result = await handleFetchQuotePosters(uri, 'likes');
    expect(bgApiRequestPublic).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(true);
  });

  it('caps distinct cursors at 50 pages', async () => {
    let page = 0;
    vi.mocked(bgApiRequestPublic).mockImplementation(async () => ({
      repostedBy: [profile(`did:plc:${page}`)],
      cursor: String(++page),
    }));
    const result = await handleFetchQuotePosters(uri, 'reposts');
    expect(bgApiRequestPublic).toHaveBeenCalledTimes(50);
    expect(result.truncated).toBe(true);
  });

  it('marks a failed later page incomplete instead of claiming a complete list', async () => {
    vi.mocked(bgApiRequestPublic)
      .mockResolvedValueOnce({ likes: [{ actor: profile('did:plc:a') }], cursor: 'next' })
      .mockResolvedValueOnce(null);
    const result = await handleFetchQuotePosters(uri, 'likes');
    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('does not trust profile count when hydration omits one requested DID', async () => {
    vi.mocked(bgApiRequestPublic).mockResolvedValueOnce({
      repostedBy: [profile('did:plc:a'), profile('did:plc:b')],
    });
    vi.mocked(fetchProfiles).mockResolvedValueOnce([profile('did:plc:a'), profile('did:plc:a')]);
    expect((await handleFetchQuotePosters(uri, 'reposts')).viewerStateUnavailable).toBe(true);
  });

  it('cancels after an in-flight page without fetching another or hydrating', async () => {
    let finish: (value: { likes: never[]; cursor: string }) => void = () => {
      throw new Error('not started');
    };
    vi.mocked(bgApiRequestPublic).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const pending = handleFetchQuotePosters(uri, 'likes', 'cancel-test');
    await vi.waitFor(() => expect(bgApiRequestPublic).toHaveBeenCalledOnce());
    cancelPostAudienceFetch('cancel-test');
    finish({ likes: [], cursor: 'next' });
    expect(await pending).toMatchObject({ success: false, error: 'Fetch cancelled' });
    expect(bgApiRequestPublic).toHaveBeenCalledOnce();
    expect(fetchProfiles).not.toHaveBeenCalled();
  });

  it('rejects unsupported audiences without network calls', async () => {
    const result = await handleFetchQuotePosters(uri, 'followers' as 'likes');
    expect(result.success).toBe(false);
    expect(bgApiRequestPublic).not.toHaveBeenCalled();
  });
});
