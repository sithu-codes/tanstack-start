import { relations } from "drizzle-orm";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { commentTable, postTable, userTable } from ".";

export const postUpvoteTable = pgTable("post_upvotes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const postUpvoteRelations = relations(postUpvoteTable, ({ one }) => ({
  post: one(postTable, {
    fields: [postUpvoteTable.postId],
    references: [postTable.id],
    relationName: "postUpvotes"
  }),
  user: one(userTable, {
    fields: [postUpvoteTable.userId],
    references: [userTable.id],
    relationName: "user"
  })
}));

export const commentUpvoteTable = pgTable("comment_upvotes", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const commentUpvoteRelations = relations(
  commentUpvoteTable,
  ({ one }) => ({
    post: one(commentTable, {
      fields: [commentUpvoteTable.commentId],
      references: [commentTable.id],
      relationName: "commentUpvotes"
    }),
    user: one(userTable, {
      fields: [commentUpvoteTable.userId],
      references: [userTable.id],
      relationName: "user"
    })
  })
);
