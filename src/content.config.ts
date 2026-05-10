import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const postBase = z.object({
  title: z.string(),
  description: z.string().optional(),
  pubDate: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: postBase,
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: postBase.extend({
    repo: z.string().url().optional(),
    demo: z.string().url().optional(),
    cover: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

const research = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/research' }),
  schema: postBase.extend({
    venue: z.string().optional(),
    authors: z.array(z.string()).default([]),
    pdf: z.string().optional(),
    bibtex: z.string().optional(),
  }),
});

export const collections = { blog, projects, research };
