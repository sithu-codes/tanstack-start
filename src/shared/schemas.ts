import { createInsertSchema } from "drizzle-zod";
import z from "zod";

import { commentTable, postTable } from "@/server/db/tables";

export const loginSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(31)
    .regex(/^[a-zA-z0-9_]+$/),
  password: z.string().min(3).max(255)
});

export const sortBySchema = z.enum(["points", "recent"]);
export const orderBySchema = z.enum(["asc", "desc"]);

export const paginationSchema = z.object({
  limit: z.number().optional().default(10),
  page: z.number().optional().default(1),
  sortBy: sortBySchema.optional().default("recent"),
  orderBy: orderBySchema.optional().default("desc"),
  author: z.string().optional(),
  site: z.string().optional()
});

export const insertPostSchema = createInsertSchema(postTable, {
  title: z.string().min(3, { message: "Title must be at least 3 characters." }),
  url: z
    .url({ message: "URL must be a valid url" })
    .optional()
    .or(z.literal("")),
  content: z.string().optional()
});

export const createPostSchema = insertPostSchema
  .pick({ title: true, url: true, content: true })
  .refine((data) => data.url || data.content, {
    message: "Either URL or Content must be provided",
    path: ["url", "content"]
  });

export const insertCommentSchema = createInsertSchema(commentTable, {
  content: z
    .string()
    .min(3, { message: "Comment must be at least 3 characters" })
});

export const createCommentSchema = insertCommentSchema.pick({ content: true });
