import { relations } from "drizzle-orm";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { commentUpvoteTable, postTable, userTable } from ".";

export const commentTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  postId: integer("post_id").notNull(),
  parentCommentId: integer("parent_comment_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  depth: integer("depth").default(0).notNull(),
  commentCount: integer("comment_count").default(0).notNull(),
  points: integer("points").default(0).notNull()
});

export const commentRelations = relations(commentTable, ({ one, many }) => ({
  author: one(userTable, {
    fields: [commentTable.userId],
    references: [userTable.id],
    relationName: "author"
  }),
  parentComment: one(commentTable, {
    fields: [commentTable.parentCommentId],
    references: [commentTable.id],
    relationName: "parentComment"
  }),
  childComment: many(commentTable, {
    relationName: "childComment"
  }),
  post: one(postTable, {
    fields: [commentTable.postId],
    references: [postTable.id]
  }),
  commentUpvotes: many(commentUpvoteTable, { relationName: "commentUpvotes" })
}));
