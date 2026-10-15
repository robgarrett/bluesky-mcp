import { BskyAgent, BlobRef, RichText } from '@atproto/api';

export class BlueskyClient {
  private agent: BskyAgent;
  private isAuthenticated: boolean = false;

  constructor() {
    const service = process.env.BLUESKY_SERVICE || 'https://bsky.social';
    this.agent = new BskyAgent({ service });
  }

  async autoLogin(): Promise<void> {
    const identifier = process.env.BLUESKY_IDENTIFIER;
    const password = process.env.BLUESKY_PASSWORD;

    if (!identifier || !password) {
      throw new Error('BLUESKY_IDENTIFIER and BLUESKY_PASSWORD must be set in Claude\'s config environment variables');
    }

    await this.login(identifier, password);
  }

  async login(identifier: string, password: string): Promise<void> {
    try {
      await this.agent.login({ identifier, password });
      this.isAuthenticated = true;
      console.error('Successfully logged in to Bluesky');
    } catch (error) {
      console.error('Failed to login:', error);
      throw error;
    }
  }

  async createPost(text: string, images?: { data: Buffer; encoding: string; alt?: string; }[]): Promise<{ uri: string; cid: string }> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const rt = new RichText({ text });
      await rt.detectFacets(this.agent);

      const postRecord: any = {
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      };

      if (images && images.length > 0) {
        const uploadedImages: BlobRef[] = [];
        for (const image of images) {
          const response = await this.agent.uploadBlob(image.data, {
            encoding: image.encoding,
          });
          if (response.success) {
            uploadedImages.push(response.data.blob);
          }
        }

        if (uploadedImages.length > 0) {
          postRecord.embed = {
            $type: 'app.bsky.embed.images',
            images: uploadedImages.map((blob, index) => ({
              alt: images?.[index]?.alt || 'Image',
              image: blob,
            })),
          };
        }
      }

      const response = await this.agent.post(postRecord);
      console.error('Successfully created post:', response.uri);
      return response;
    } catch (error) {
      console.error('Failed to create post:', error);
      throw error;
    }
  }

  async getProfile(): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const profile = await this.agent.getProfile({
        actor: this.agent.session?.did as string,
      });
      return profile;
    } catch (error) {
      console.error('Failed to get profile:', error);
      throw error;
    }
  }

  async getTimeline(limit: number = 20): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const timeline = await this.agent.getTimeline({ limit });
      return timeline;
    } catch (error) {
      console.error('Failed to get timeline:', error);
      throw error;
    }
  }

  async getPost(postUri: string): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const post = await this.agent.getPostThread({ uri: postUri });
      return post;
    } catch (error) {
      console.error('Failed to get post:', error);
      throw error;
    }
  }

  async getPosts(uris: string[]): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const posts = await this.agent.getPosts({ uris });
      return posts;
    } catch (error) {
      console.error('Failed to get posts:', error);
      throw error;
    }
  }

  async deletePost(postUri: string): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      await this.agent.deletePost(postUri);
      console.error('Successfully deleted post');
    } catch (error) {
      console.error('Failed to delete post:', error);
      throw error;
    }
  }

  async likePost(uri: string, cid: string): Promise<{ uri: string; cid: string }> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const response = await this.agent.like(uri, cid);
      console.error('Successfully liked post');
      return response;
    } catch (error) {
      console.error('Failed to like post:', error);
      throw error;
    }
  }

  async unlikePost(likeUri: string): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      await this.agent.deleteLike(likeUri);
      console.error('Successfully unliked post');
    } catch (error) {
      console.error('Failed to unlike post:', error);
      throw error;
    }
  }

  async repostPost(uri: string, cid: string): Promise<{ uri: string; cid: string }> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const response = await this.agent.repost(uri, cid);
      console.error('Successfully reposted');
      return response;
    } catch (error) {
      console.error('Failed to repost:', error);
      throw error;
    }
  }

  async unrepostPost(repostUri: string): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      await this.agent.deleteRepost(repostUri);
      console.error('Successfully removed repost');
    } catch (error) {
      console.error('Failed to remove repost:', error);
      throw error;
    }
  }

  isLoggedIn(): boolean {
    return this.isAuthenticated;
  }
} 