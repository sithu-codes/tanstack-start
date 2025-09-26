import { relations } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { commentTable } from "./comment";
import { postTable } from "./post";
import { commentUpvoteTable, postUpvoteTable } from "./upvote";

export const userTable = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull()
});

export const userRelations = relations(userTable, ({ many }) => ({
  posts: many(postTable, { relationName: "author" }),
  comments: many(commentTable, { relationName: "author" }),
  postUpvotes: many(postUpvoteTable, {
    relationName: "postUpvotes"
  }),
  commentUpvotes: many(commentUpvoteTable, {
    relationName: "commentUpvotes"
  })
}));

export const sessionTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date"
  }).notNull()
});
