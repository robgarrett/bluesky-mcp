#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BlueskyClient } from './blueskyClient.js';
import { resolveImages } from './imageResolver.js';

const client = new BlueskyClient();

const server = new McpServer({
  name: "bluesky-mcp",
  version: "1.0.7",
  capabilities: {
    resources: {},
    tools: {},
  },
});

interface User {
  displayName?: string;
  handle: string;
}

interface PostEmbed {
  $type: string;
  external?: {
    title: string;
    description: string;
  };
  alt?: string;
}

export const ConfigSchema = z.object({
  identifier: z.string().min(1, "Bluesky handle or email is required"),
  password: z.string().min(1, "Bluesky app password is required"),
});
export type Config = z.infer<typeof ConfigSchema>;

export const CreatePostSchema = z.object({
  text: z.string().min(1, "Post text cannot be empty"),
  images: z
    .array(
      z.object({
        data: z.string().optional().describe("Base64 encoded image data"),
        encoding: z.string().optional().describe("Image MIME type (e.g., image/jpeg)"),
        url: z.string().url().refine((value) => value.startsWith('https://'), "Image URL must use HTTPS").optional().describe("Public HTTPS image URL; downloaded by the MCP server"),
        path: z.string().optional().describe("Local image path readable by the MCP server"),
        alt: z.string().max(1000).optional().describe("Accessible alt text"),
      })
        .refine((image) => Number(Boolean(image.data)) + Number(Boolean(image.url)) + Number(Boolean(image.path)) === 1,
          "Provide exactly one of data, url, or path")
    )
    .optional(),
});

export const GetTimelineSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export type CreatePostArgs = z.infer<typeof CreatePostSchema>;

export type GetTimelineArgs = z.infer<typeof GetTimelineSchema>;
export interface BlueskyPost {
  uri: string;
  cid: string;
  author: User;
  text: string;
  createdAt: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
  embed?: any;
}

export interface FormattedPost {
  position: number;
  author: {
    handle: string;
    displayName?: string;
  };
  content: string;
  stats: {
    replies: number;
    reposts: number;
    likes: number;
  };
  createdAt: string;
  url: string;
}

export interface TimelineResponse {
  count: number;
  posts: FormattedPost[];
}

export function formatTimeline(
  posts: BlueskyPost[],
  baseUrl: string = "https://bsky.app/profile"
): TimelineResponse {
  return {
    count: posts.length,
    posts: posts
      .filter(post => post.author && post.author.handle)
      .map((post, i) => ({
        position: i + 1,
        author: {
          handle: post.author?.handle || "unknown",
          displayName: post.author?.displayName,
        },
        content: post.text,
        stats: {
          replies: post.replyCount,
          reposts: post.repostCount,
          likes: post.likeCount,
        },
        createdAt: post.createdAt,
        url: `${baseUrl}/${post.author.handle}/post/${post.uri.split("/").pop()}`,
      })),
  };
}

server.tool(
  "login",
  "Login to Bluesky using credentials from .env file or provided parameters",
  {
    identifier: z.string().optional().describe("Your Bluesky handle or email (optional if set in .env)"),
    password: z.string().optional().describe("Your Bluesky app password (optional if set in .env)"),
  },
  async ({ identifier, password }) => {
    try {
      if (identifier && password) {
        await client.login(identifier, password);
      } else {
        await client.autoLogin();
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Successfully logged in to Bluesky"
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to login: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "create-post",
  "Create a new post on Bluesky",
  {
    text: z.string().describe("The text content of your post"),
    images: z
    .array(
    z.object({
      data: z.string().optional().describe("Base64 encoded image data"),
      encoding: z.string().optional().describe("Image MIME type (e.g., image/jpeg)"),
      url: z.string().url().refine((value) => value.startsWith('https://'), "Image URL must use HTTPS").optional().describe("Public HTTPS image URL; downloaded by the MCP server"),
      path: z.string().optional().describe("Local image path readable by the MCP server"),
      alt: z.string().max(1000).optional().describe("Accessible alt text"),
    })
      .refine((image) => Number(Boolean(image.data)) + Number(Boolean(image.url)) + Number(Boolean(image.path)) === 1,
        "Provide exactly one of data, url, or path")
      )
      .optional()
      .describe("Optional array of images to attach to the post"),
  },
  async ({ text, images }) => {
    try {
      const processedImages = await resolveImages(images);

      const result = await client.createPost(text, processedImages);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Post created successfully",
              uri: result.uri,
              cid: result.cid
            })
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to create post: ${error}`
            })
          }
        ]
      };
    }
  }
);

server.tool(
  "get-profile",
  "Get your Bluesky profile",
  {},
  async () => {
    try {
      const profile = await client.getProfile();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(profile, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to get profile: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "get-timeline",
  "Get Bluesky timeline",
  {
    limit: GetTimelineSchema.shape.limit,
  },
  async ({ limit }) => {
    try {
      const timeline = await client.getTimeline(limit);
      const formatted = formatTimeline(
        (timeline.data.feed || [])
          .map((item: any) => item.post)
          .filter(Boolean)
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to get timeline: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "get-post",
  "Get a specific post by URI",
  {
    uri: z.string().describe("The URI of the post to fetch"),
  },
  async ({ uri }) => {
    try {
      const post = await client.getPost(uri);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(post, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to get post: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "get-posts",
  "Get multiple posts by their URIs",
  {
    uris: z.array(z.string()).describe("Array of post URIs to fetch"),
  },
  async ({ uris }) => {
    try {
      const posts = await client.getPosts(uris);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(posts, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to get posts: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "delete-post",
  "Delete one of your posts",
  {
    uri: z.string().describe("The URI of the post to delete"),
  },
  async ({ uri }) => {
    try {
      await client.deletePost(uri);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Post deleted successfully"
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to delete post: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "like-post",
  "Like a post",
  {
    uri: z.string().describe("The URI of the post to like"),
    cid: z.string().describe("The CID of the post to like"),
  },
  async ({ uri, cid }) => {
    try {
      const result = await client.likePost(uri, cid);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: `Successfully liked post. Like URI: ${result.uri}`,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to like post: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "unlike-post",
  "Remove your like from a post",
  {
    likeUri: z.string().describe("The URI of the like to remove"),
  },
  async ({ likeUri }) => {
    try {
      await client.unlikePost(likeUri);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Successfully removed like",
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to remove like: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "repost",
  "Repost someone's post",
  {
    uri: z.string().describe("The URI of the post to repost"),
    cid: z.string().describe("The CID of the post to repost"),
  },
  async ({ uri, cid }) => {
    try {
      const result = await client.repostPost(uri, cid);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: `Successfully reposted. Repost URI: ${result.uri}`,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to repost: ${error}`
            }),
          },
        ],
      };
    }
  }
);

server.tool(
  "unrepost",
  "Remove your repost",
  {
    repostUri: z.string().describe("The URI of the repost to remove"),
  },
  async ({ repostUri }) => {
    try {
      await client.unrepostPost(repostUri);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Successfully removed repost",
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to remove repost: ${error}`
            }),
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  try {
    await client.autoLogin();
    console.error("Auto-logged in to Bluesky using .env credentials");
  } catch (error) {
    console.error("Note: Auto-login failed. Use the login tool with credentials to authenticate.");
  }
  
  console.error("Bluesky MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
}); 