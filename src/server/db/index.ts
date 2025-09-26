import { drizzle } from "drizzle-orm/node-postgres";

import { Pool } from "pg";

import {
  commentRelations,
  commentTable,
  commentUpvoteRelations,
  commentUpvoteTable,
  postsRelations,
  postTable,
  postUpvoteRelations,
  postUpvoteTable,
  sessionTable,
  userRelations,
  userTable
} from "./tables";

const client = new Pool({
  connectionString: process.env.DATABASE_URL as string
});

export const db = drizzle({
  client,
  schema: {
    user: userTable,
    session: sessionTable,
    post: postTable,
    comment: commentTable,
    postUpvote: postUpvoteTable,
    commentUpvote: commentUpvoteTable,
    postsRelations,
    commentUpvoteRelations,
    postUpvoteRelations,
    userRelations,
    commentRelations
  }
});
