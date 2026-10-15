import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BlueskyClient } from '../dist/blueskyClient.js';
import { resolveImages } from '../dist/imageResolver.js';

function createFakeAgent() {
  return {
    session: { did: 'did:plc:test-user' },
    async login() {},
    async getProfile(args) {
      return { args, data: { handle: 'rob.example' } };
    },
    async getTimeline(args) {
      return { args, data: { feed: [] } };
    },
    async getPostThread(args) {
      return { args, data: { thread: {} } };
    },
    async getPosts(args) {
      return { args, data: { posts: [] } };
    },
    async uploadBlob(data, options) {
      return { success: true, data: { blob: { ref: data.toString(), options } } };
    },
    async post(record) {
      return { uri: 'at://did:plc:test-user/app.bsky.feed.post/1', cid: 'cid-1', record };
    },
  };
}

async function authenticatedClient() {
  const client = new BlueskyClient();
  const agent = createFakeAgent();
  client.agent = agent;
  await client.login('rob.example', 'app-password');
  return { client, agent };
}

test('rejects API calls before authentication', async () => {
  const client = new BlueskyClient();

  await assert.rejects(
    () => client.getTimeline(),
    /Not authenticated\. Please login first\./,
  );
  assert.equal(client.isLoggedIn(), false);
});

test('login authenticates the client and reports logged-in state', async () => {
  const { client } = await authenticatedClient();

  assert.equal(client.isLoggedIn(), true);
});

test('forwards timeline limits to the Bluesky agent', async () => {
  const { client } = await authenticatedClient();

  const result = await client.getTimeline(7);

  assert.deepEqual(result, { args: { limit: 7 }, data: { feed: [] } });
});

test('creates a post with uploaded image alt text', async () => {
  const { client } = await authenticatedClient();

  const result = await client.createPost('Hello Bluesky', [
    { data: Buffer.from('image-bytes'), encoding: 'image/png', alt: 'A test image' },
  ]);

  assert.equal(result.uri, 'at://did:plc:test-user/app.bsky.feed.post/1');
  assert.equal(result.record.embed.images[0].alt, 'A test image');
  assert.equal(result.record.embed.images[0].image.ref, 'image-bytes');
});

test('uses a default image alt text when none is supplied', async () => {
  const { client } = await authenticatedClient();

  const result = await client.createPost('Hello Bluesky', [
    { data: Buffer.from('image-bytes'), encoding: 'image/png' },
  ]);

  assert.equal(result.record.embed.images[0].alt, 'Image');
});

test('downloads an HTTPS image URL and resolves it for Bluesky upload', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    assert.ok(options.signal);
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg; charset=binary' },
    });
  };

  try {
    const [image] = await resolveImages([
      { url: 'https://cdn.example.test/photo.jpg', alt: 'A remote photo' },
    ]);

    assert.equal(requestedUrl, 'https://cdn.example.test/photo.jpg');
    assert.deepEqual(image, {
      data: Buffer.from([1, 2, 3]),
      encoding: 'image/jpeg',
      alt: 'A remote photo',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a downloaded URL that does not return an image', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not an image', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });

  try {
    await assert.rejects(
      () => resolveImages([{ url: 'https://cdn.example.test/not-image' }]),
      /URL did not return an image: text\/plain/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects downloaded images larger than Bluesky allows', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array(2_000_001), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });

  try {
    await assert.rejects(
      () => resolveImages([{ url: 'https://cdn.example.test/large.png' }]),
      /Image exceeds Bluesky's 2000000-byte limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
